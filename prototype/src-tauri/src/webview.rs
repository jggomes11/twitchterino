use crate::{
    model::{self, AccountId, Platform},
    windows::{self, Runtime},
};
use ::windows::core::{Interface, PCWSTR, PWSTR};
use ::windows::Win32::UI::WindowsAndMessaging::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR,
    DevToolsProtocolEventReceivedEventHandler, Microsoft::Web::WebView2::Win32::*,
    PermissionRequestedEventHandler, ProcessFailedEventHandler,
};

pub async fn cdp(w: &WebviewWindow, method: &str, params: Value) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let method = method.to_string();
    let timeout = if method == "Runtime.evaluate" && params["awaitPromise"] == true {
        45
    } else {
        20
    };
    let params = params.to_string();
    w.with_webview(move |view| unsafe {
        let response =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, result| {
                let value = if hr.is_ok() {
                    serde_json::from_str(&result).map_err(|_| "Resposta CDP inválida".to_string())
                } else {
                    Err("Operação WebView2 recusada".into())
                };
                let _ = tx.send(value);
                Ok(())
            }));
        if let Ok(core) = view.controller().CoreWebView2() {
            let m: Vec<u16> = method.encode_utf16().chain(Some(0)).collect();
            let p: Vec<u16> = params.encode_utf16().chain(Some(0)).collect();
            let _ =
                core.CallDevToolsProtocolMethod(PCWSTR(m.as_ptr()), PCWSTR(p.as_ptr()), &response);
        }
    })
    .map_err(|_| "Página indisponível")?;
    tokio::time::timeout(Duration::from_secs(timeout), rx)
        .await
        .map_err(|_| "Timeout WebView2")?
        .map_err(|_| "Página encerrada")?
}
pub fn visibility(w: &WebviewWindow, visible: bool) {
    let window = w.clone();
    let app = w.app_handle().clone();
    let _ = app.run_on_main_thread(move || {
        let _ = window.eval(if visible {
            "document.querySelectorAll('video,audio').forEach(v=>v.muted=false)"
        } else {
            "document.querySelectorAll('video,audio').forEach(v=>v.muted=true)"
        });
        let _ = window.set_skip_taskbar(!visible);
        let _ = window.set_focusable(visible);
        let _ = window.set_ignore_cursor_events(!visible);
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED.0 as isize);
                let _ = SetLayeredWindowAttributes(
                    hwnd,
                    ::windows::Win32::Foundation::COLORREF(0),
                    if visible { 255 } else { 0 },
                    LWA_ALPHA,
                );
                let _ = ShowWindow(hwnd, if visible { SW_SHOW } else { SW_SHOWNOACTIVATE });
            }
        }
        let _ = window.set_size(tauri::LogicalSize::new(
            if visible { 1100. } else { 480. },
            if visible { 800. } else { 270. },
        ));
        if visible {
            let _ = window.set_focus();
        } else {
            let _ = window.set_position(tauri::LogicalPosition::new(0., 0.));
        }
        let _ = window.with_webview(move |view| unsafe {
            let _ = view.controller().SetIsVisible(true);
            if let Ok(core) = view.controller().CoreWebView2() {
                if let Ok(v) = core.cast::<ICoreWebView2_8>() {
                    let _ = v.SetIsMuted(!visible);
                }
            }
        });
    });
}

pub fn keep_awake(app: &AppHandle, active: bool) {
    let _ = app.run_on_main_thread(move || unsafe {
        use ::windows::Win32::System::Power::*;
        SetThreadExecutionState(if active {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        });
    });
}
fn receiver(
    w: &WebviewWindow,
    event: &str,
    f: impl Fn(Value) + Send + Sync + 'static,
) -> Result<(), String> {
    let event = event.to_string();
    let f = Arc::new(f);
    w.with_webview(move |view| unsafe {
        if let Ok(core) = view.controller().CoreWebView2() {
            let event: Vec<u16> = event.encode_utf16().chain(Some(0)).collect();
            if let Ok(r) = core.GetDevToolsProtocolEventReceiver(PCWSTR(event.as_ptr())) {
                let handler =
                    DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let mut p = PWSTR::null();
                            args.ParameterObjectAsJson(&mut p)?;
                            let p = CoTaskMemPWSTR::from(p);
                            if let Ok(v) = serde_json::from_str(&p.to_string()) {
                                f(v);
                            }
                        }
                        Ok(())
                    }));
                let mut token = Default::default();
                let _ = r.add_DevToolsProtocolEventReceived(&handler, &mut token);
            }
        }
    })
    .map_err(|_| "Eventos WebView2 indisponíveis".into())
}
pub fn instrument(
    w: &WebviewWindow,
    app: &AppHandle,
    id: &AccountId,
    kind: &str,
    slug: Option<&str>,
    ticket: u64,
    target_url: String,
) -> Result<(), String> {
    secure_remote(w, app);
    if kind == "auth" {
        w.navigate(target_url.parse().unwrap())
            .map_err(|_| "Falha ao abrir login")?;
        return Ok(());
    }
    let slug = slug.unwrap().to_string();
    if app.state::<Runtime>().platform == Platform::Twitch {
        observe_redemptions(w, app, id, &slug, ticket)?;
    }
    let fail_app = app.clone();
    let fail_id = id.clone();
    let fail_slug = slug.clone();
    let _ = w.with_webview(move |view| unsafe {
        if let Ok(core) = view.controller().CoreWebView2() {
            let handler =
                webview2_com::NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut success = ::windows::Win32::Foundation::BOOL::default();
                        args.IsSuccess(&mut success)?;
                        if !success.as_bool() {
                            let rt = fail_app.state::<Runtime>();
                            rt.apply_current(&fail_id, ticket, |a| {
                                if let Some(c) = a.status.get_mut(&fail_slug) {
                                    c.error = Some("Falha ao carregar a página oficial".into());
                                }
                            });
                            windows::emit_state(&fail_app);
                        }
                    }
                    Ok(())
                }));
            let mut token = Default::default();
            let _ = core.add_NavigationCompleted(&handler, &mut token);
        }
    });
    let app_event = app.clone();
    let id_event = id.clone();
    let window = w.clone();
    let s = slug.clone();
    if kind == "player" {
        let seen = Arc::new(Mutex::new(HashSet::<String>::new()));
        receiver(w, "Network.webSocketFrameReceived", move |v| {
            let rt = app_event.state::<Runtime>();
            if rt.platform != Platform::Kick
                || !rt.current(&id_event, ticket)
                || window.url().is_err()
            {
                return;
            }
            if let Some(text) = v.pointer("/response/payloadData").and_then(Value::as_str) {
                for line in text.lines() {
                    let Ok(frame) = serde_json::from_str::<Value>(line) else {
                        continue;
                    };
                    let Some(data) = frame.pointer("/push/pub/data") else {
                        continue;
                    };
                    let Some(event) = data["event"].as_str() else {
                        continue;
                    };
                    let Some(raw) = data["data"].as_str() else {
                        continue;
                    };
                    let Ok(payload) = serde_json::from_str::<Value>(raw) else {
                        continue;
                    };
                    let kind = if event == "App\\Events\\ChatMessageEvent" {
                        "message"
                    } else if event == "RewardRedeemedEvent" {
                        "reward"
                    } else {
                        continue;
                    };
                    if kind == "message" {
                        let key = payload["id"].as_str().unwrap_or("").to_string();
                        if !key.is_empty() {
                            let mut seen = seen.lock().unwrap();
                            if seen.contains(&key) {
                                continue;
                            }
                            if seen.len() >= 2000 {
                                seen.clear();
                            }
                            seen.insert(key);
                        }
                    }
                    let _=app_event.emit_to("main","chat",json!({"accountId":id_event.0,"payload":{"slug":s,"kind":kind,"data":payload}}));
                }
            }
        })?;
        let app_event = app.clone();
        let id_event = id.clone();
        let window = w.clone();
        let s = slug.clone();
        receiver(w, "Fetch.requestPaused", move |p| {
            let app = app_event.clone();
            let id = id_event.clone();
            let w = window.clone();
            let slug = s.clone();
            tauri::async_runtime::spawn(async move {
                let rt = app.state::<Runtime>();
                let request = p["requestId"].clone();
                let active = rt.current(&id, ticket)
                    && rt.account(&id, |a| {
                        a.low_quality && a.status.get(&slug).is_some_and(|c| !c.shown)
                    });
                let mut fulfilled = false;
                if active && matches!(p["resourceType"].as_str(), Some("Image" | "Font")) {
                    let _ = cdp(
                        &w,
                        "Fetch.failRequest",
                        json!({"requestId":request,"errorReason":"BlockedByClient"}),
                    )
                    .await;
                    return;
                }
                if active && p.get("responseStatusCode").is_some() {
                    if let Ok(body) =
                        cdp(&w, "Fetch.getResponseBody", json!({"requestId":request})).await
                    {
                        let raw = body["body"].as_str().unwrap_or("");
                        let text = if body["base64Encoded"] == true {
                            STANDARD
                                .decode(raw)
                                .ok()
                                .and_then(|v| String::from_utf8(v).ok())
                        } else {
                            Some(raw.into())
                        };
                        if let Some(low) =
                            text.and_then(|s| crate::platform::lowest_playlist_for(rt.platform, &s))
                        {
                            let headers = p["responseHeaders"]
                                .as_array()
                                .map(|h| {
                                    h.iter()
                                        .filter(|h| {
                                            !matches!(
                                                h["name"]
                                                    .as_str()
                                                    .unwrap_or("")
                                                    .to_ascii_lowercase()
                                                    .as_str(),
                                                "content-length" | "content-encoding"
                                            )
                                        })
                                        .cloned()
                                        .collect::<Vec<_>>()
                                })
                                .unwrap_or_default();
                            fulfilled=cdp(&w,"Fetch.fulfillRequest",json!({"requestId":request,"responseCode":p["responseStatusCode"],"responseHeaders":headers,"body":STANDARD.encode(low)})).await.is_ok();
                        }
                    }
                }
                if !fulfilled {
                    let _ = cdp(&w, "Fetch.continueRequest", json!({"requestId":request})).await;
                }
            });
        })?;
        let app_fail = app.clone();
        let id_fail = id.clone();
        let s = slug.clone();
        let win = w.clone();
        let _ = w.with_webview(move |view| unsafe {
            if let Ok(core) = view.controller().CoreWebView2() {
                let handler = ProcessFailedEventHandler::create(Box::new(move |_, _| {
                    let rt = app_fail.state::<Runtime>();
                    if rt.current(&id_fail, ticket) {
                        rt.account(&id_fail, |a| {
                            if let Some(c) = a.status.get_mut(&s) {
                                c.error = Some("Player reiniciado após falha".into());
                                c.watching_since = None;
                            }
                        });
                        rt.next_poll[id_fail.index()].store(0, Ordering::SeqCst);
                        let _ = win.destroy();
                        windows::emit_state(&app_fail);
                    }
                    Ok(())
                }));
                let mut token = Default::default();
                let _ = core.add_ProcessFailed(&handler, &mut token);
            }
        });
    }
    let window = w.clone();
    let is_player = kind == "player";
    let owner_app = app.clone();
    let owner_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let _ = cdp(&window, "Network.enable", json!({})).await;
        if is_player {
            let _=cdp(&window,"Fetch.enable",json!({"patterns":[{"urlPattern":"*.m3u8*","requestStage":"Response"},{"resourceType":"Image","requestStage":"Request"},{"resourceType":"Font","requestStage":"Request"}]})).await;
        }
        if owner_app.state::<Runtime>().current(&owner_id, ticket) {
            let _ = window.navigate(target_url.parse().unwrap());
        } else {
            let _ = window.destroy();
        }
    });
    Ok(())
}
pub fn smoke(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let outcome=async{
        let main=app.get_webview_window("main").ok_or("UI ausente")?;
        let mut ready=false;for _ in 0..40{if let Ok(v)=cdp(&main,"Runtime.evaluate",json!({"expression":"document.querySelectorAll('#accounts button').length === 4","returnByValue":true})).await{if v.pointer("/result/value")==Some(&json!(true)){ready=true;break}}tokio::time::sleep(Duration::from_millis(500)).await;}if !ready{return Err("UI não criou as quatro contas".into())}
        if let Ok(v)=cdp(&main,"Page.captureScreenshot",json!({"format":"png","captureBeyondViewport":false})).await{if let Some(data)=v["data"].as_str(){if let Ok(bytes)=STANDARD.decode(data){if let Some(out)=std::env::var_os("TERINO_SMOKE_OUTPUT"){let _=std::fs::write(PathBuf::from(out).with_extension("png"),bytes);}}}}
        let mut windows=vec![];
        for n in 1..=4{let id=AccountId::parse(&format!("account-{n}"))?;let w=windows::open_remote(&app,&id,"auth",None,false)?;let cookie=tauri::webview::Cookie::build(("terino-prototype-fixture",format!("slot-{n}"))).domain(app.state::<Runtime>().platform.origin().parse::<url::Url>().unwrap().host_str().unwrap().to_string()).path("/").secure(true).expires(tauri::webview::cookie::time::OffsetDateTime::now_utc()+tauri::webview::cookie::time::Duration::days(1)).build();if std::env::var("TERINO_SMOKE_PHASE").unwrap_or_default()!="read"{w.set_cookie(cookie).map_err(|_|"Falha ao definir cookie fictício")?;}windows.push(w);}
        visibility(&windows[0],false);
        let background=cdp(&windows[0],"Runtime.evaluate",json!({"expression":"document.visibilityState","returnByValue":true})).await?;
        if background.pointer("/result/value")!=Some(&json!("visible")){return Err("WebView de coleta permaneceu oculto para a página".into())}
        cdp(&windows[0],"Fetch.enable",json!({"patterns":[{"urlPattern":"*.m3u8*","requestStage":"Response"}]})).await?;
        cdp(&windows[0],"Fetch.disable",json!({})).await?;
        for (i,w) in windows.iter().enumerate(){let cookies=w.cookies().map_err(|_|"Falha ao ler cookies")?;let values:Vec<_>=cookies.iter().filter(|c|c.name()=="terino-prototype-fixture").map(|c|c.value().to_string()).collect();if values!=vec![format!("slot-{}",i+1)]{return Err("Cookies misturados entre contas".into())}
            let denied=cdp(w,"Runtime.evaluate",json!({"expression":"globalThis.__TAURI_INTERNALS__ ? globalThis.__TAURI_INTERNALS__.invoke('snapshot').then(()=>false,()=>true) : true","awaitPromise":true,"returnByValue":true})).await?;
            if denied.pointer("/result/value")!=Some(&json!(true)){return Err("Página remota acessou comando nativo".into())}
        }
        for w in windows{w.destroy().map_err(|_|"Falha ao encerrar perfil")?;}
        Ok::<_,String>(json!({"passed":true,"accounts":4,"cookieIsolation":true,"remoteIpcDenied":true,"backgroundVisible":true,"fetchAvailable":true,"realMediaValidated":false,"persistenceRead":std::env::var("TERINO_SMOKE_PHASE").unwrap_or_default()=="read","realLogin":false,"realPointsMeasured":false}))
    }.await;
        let output = std::env::var_os("TERINO_SMOKE_OUTPUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("terino-prototype-smoke.json"));
        let ok = outcome.is_ok();
        let value = outcome.unwrap_or_else(|e| json!({"passed":false,"error":e}));
        let _ = std::fs::write(output, serde_json::to_vec_pretty(&value).unwrap());
        app.exit(if ok { 0 } else { 1 });
    });
}
use std::path::PathBuf;

pub async fn inspect_players(app: &AppHandle, id: &AccountId, ticket: u64) {
    let rt = app.state::<Runtime>();
    let items = rt.account(id, |a| {
        a.status
            .iter()
            .filter_map(|(s, c)| Some((s.clone(), c.watching_since?, c.shown)))
            .collect::<Vec<_>>()
    });
    for (slug, started, shown) in items {
        if !rt.current(id, ticket) {
            return;
        }
        if model::now().saturating_sub(started) < 15_000 {
            continue;
        }
        let Some(w) = app.get_webview_window(&windows::label(id, "player", Some(&slug))) else {
            continue;
        };
        let script = r#"(()=>{const v=document.querySelector('video');return {gate:!!document.querySelector('[data-testid="mature"],[data-a-target="content-classification-gate-overlay-start-watching-button"],[data-a-target="player-overlay-mature-accept"]'),visibility:document.visibilityState,video:v?{paused:v.paused,time:Math.round(v.currentTime),width:v.videoWidth,height:v.videoHeight,ready:v.readyState}:null};})()"#;
        let result = cdp(
            &w,
            "Runtime.evaluate",
            json!({"expression":script,"returnByValue":true}),
        )
        .await
        .and_then(|v| {
            v.pointer("/result/value")
                .cloned()
                .filter(Value::is_object)
                .ok_or("Inspeção de mídia indisponível".into())
        });
        let mut restart = false;
        rt.apply_current(id, ticket, |a| {
            if let Some(c) = a
                .status
                .get_mut(&slug)
                .filter(|c| c.watching_since == Some(started))
            {
                match result {
                    Ok(info) => {
                        c.inspection_failures = 0;
                        c.age_gate = info["gate"] == true;
                        c.video = info;
                    }
                    Err(_) => {
                        c.inspection_failures = c.inspection_failures.saturating_add(1);
                        restart = !shown
                            && (rt.platform == Platform::Kick
                                || (c.inspection_failures >= 3
                                    && model::now().saturating_sub(started) > 180_000));
                        if restart {
                            c.error = Some("Player sem resposta; será reaberto".into());
                            c.watching_since = None;
                        }
                    }
                }
            }
        });
        if restart {
            let _ = w.destroy();
            rt.next_poll[id.index()].store(0, Ordering::SeqCst);
        }
    }
    windows::emit_state(app);
}

pub fn secure_remote(w: &WebviewWindow, app: &AppHandle) {
    let app = app.clone();
    let _ = w.with_webview(move |view| unsafe {
        if let Ok(core) = view.controller().CoreWebView2() {
            let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
                Ok(())
            }));
            let mut token = Default::default();
            let _ = core.add_PermissionRequested(&handler, &mut token);
            let mut version = PWSTR::null();
            let mut agent = PWSTR::null();
            let version = if view
                .environment()
                .BrowserVersionString(&mut version)
                .is_ok()
            {
                CoTaskMemPWSTR::from(version).to_string()
            } else {
                String::new()
            };
            let agent = if let Ok(settings) = core
                .Settings()
                .and_then(|s| s.cast::<ICoreWebView2Settings2>())
            {
                if settings.UserAgent(&mut agent).is_ok() {
                    CoTaskMemPWSTR::from(agent).to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            *app.state::<Runtime>().engine.lock().unwrap() =
                Some(json!({"browserVersion":version,"userAgent":agent}));
        }
    });
}
fn observe_redemptions(
    w: &WebviewWindow,
    app: &AppHandle,
    id: &AccountId,
    slug: &str,
    ticket: u64,
) -> Result<(), String> {
    let pending = Arc::new(Mutex::new(
        std::collections::BTreeMap::<String, String>::new(),
    ));
    let requests = pending.clone();
    let request_app = app.clone();
    let request_id = id.clone();
    receiver(w, "Network.requestWillBeSent", move |p| {
        if !request_app.state::<Runtime>().current(&request_id, ticket)
            || p.pointer("/request/url").and_then(Value::as_str)
                != Some("https://gql.twitch.tv/gql")
        {
            return;
        }
        let Some(body) = p.pointer("/request/postData").and_then(Value::as_str) else {
            return;
        };
        let Ok(v) = serde_json::from_str::<Value>(body) else {
            return;
        };
        let ops = match v {
            Value::Array(a) => a,
            v => vec![v],
        };
        for op in ops {
            if op["operationName"] == "RedeemCustomReward" {
                if let (Some(request), Some(reward)) = (
                    p["requestId"].as_str(),
                    op.pointer("/variables/input/rewardID")
                        .and_then(Value::as_str),
                ) {
                    let mut map = requests.lock().unwrap();
                    if map.len() >= 100 {
                        map.clear();
                    }
                    map.insert(request.into(), reward.into());
                }
            }
        }
    })?;
    let app = app.clone();
    let id = id.clone();
    let slug = slug.to_string();
    let w = w.clone();
    let listener = w.clone();
    receiver(&listener, "Network.loadingFinished", move |p| {
        let Some(request) = p["requestId"].as_str() else {
            return;
        };
        let Some(reward) = pending.lock().unwrap().remove(request) else {
            return;
        };
        let request = request.to_string();
        let app = app.clone();
        let id = id.clone();
        let slug = slug.clone();
        let w = w.clone();
        tauri::async_runtime::spawn(async move {
            let rt = app.state::<Runtime>();
            if !rt.current(&id, ticket) {
                return;
            }
            if let Ok(v) = cdp(&w, "Network.getResponseBody", json!({"requestId":request})).await {
                let raw = v["body"].as_str().unwrap_or("");
                let bytes = if v["base64Encoded"] == true {
                    STANDARD.decode(raw).ok()
                } else {
                    Some(raw.as_bytes().to_vec())
                };
                let Some(bytes) = bytes else { return };
                let Ok(v) = serde_json::from_slice::<Value>(&bytes) else {
                    return;
                };
                let ops = match v {
                    Value::Array(a) => a,
                    v => vec![v],
                };
                let confirmed = ops.iter().any(|v| {
                    v.get("errors")
                        .is_none_or(|e| e.as_array().is_some_and(|a| a.is_empty()))
                        && v.pointer("/data/redeemCustomReward").is_some_and(|r| {
                            !r.is_null() && r.get("error").is_none_or(|e| e.is_null())
                        })
                });
                if confirmed && rt.current(&id, ticket) {
                    rt.observe(
                        &id,
                        "reward-confirmed",
                        json!({"slug":slug,"rewardId":reward,"bonusHistoryImplemented":false}),
                    );
                }
            }
        });
    })
}

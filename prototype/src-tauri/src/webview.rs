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
    let _ = w.eval(if visible {
        "document.querySelectorAll('video,audio').forEach(v=>v.muted=false)"
    } else {
        "document.querySelectorAll('video,audio').forEach(v=>v.muted=true)"
    });
    let _ = w.set_skip_taskbar(!visible);
    let _ = w.set_focusable(visible);
    let _ = w.set_ignore_cursor_events(!visible);
    if let Ok(hwnd) = w.hwnd() {
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
    let _ = w.set_size(tauri::LogicalSize::new(
        if visible { 1100. } else { 480. },
        if visible { 800. } else { 270. },
    ));
    if visible {
        let _ = w.set_focus();
    } else {
        let _ = w.set_position(tauri::LogicalPosition::new(0., 0.));
    }
    let _ = w.with_webview(move |view| unsafe {
        if let Ok(core) = view.controller().CoreWebView2() {
            if let Ok(v) = core.cast::<ICoreWebView2_8>() {
                let _ = v.SetIsMuted(!visible);
            }
        }
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
    let _ = w.with_webview(|view| unsafe {
        if let Ok(core) = view.controller().CoreWebView2() {
            let deny = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
                Ok(())
            }));
            let mut token = Default::default();
            let _ = core.add_PermissionRequested(&deny, &mut token);
        }
    });
    if kind == "auth" {
        w.navigate(target_url.parse().unwrap())
            .map_err(|_| "Falha ao abrir login")?;
        return Ok(());
    }
    let slug = slug.unwrap().to_string();
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
                        if let Some(low) = text.and_then(|s| crate::platform::lowest_playlist(&s)) {
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
        let mut windows=vec![];
        for n in 1..=4{let id=AccountId::parse(&format!("account-{n}"))?;let w=windows::open_remote(&app,&id,"auth",None,false)?;let cookie=tauri::webview::Cookie::build(("terino-prototype-fixture",format!("slot-{n}"))).domain(app.state::<Runtime>().platform.origin().parse::<url::Url>().unwrap().host_str().unwrap().to_string()).path("/").secure(true).build();w.set_cookie(cookie).map_err(|_|"Falha ao definir cookie fictício")?;windows.push(w);}
        for (i,w) in windows.iter().enumerate(){let cookies=w.cookies().map_err(|_|"Falha ao ler cookies")?;let values:Vec<_>=cookies.iter().filter(|c|c.name()=="terino-prototype-fixture").map(|c|c.value().to_string()).collect();if values!=vec![format!("slot-{}",i+1)]{return Err("Cookies misturados entre contas".into())}
            let denied=cdp(w,"Runtime.evaluate",json!({"expression":"globalThis.__TAURI_INTERNALS__ ? globalThis.__TAURI_INTERNALS__.invoke('snapshot').then(()=>false,()=>true) : true","awaitPromise":true,"returnByValue":true})).await?;
            if denied.pointer("/result/value")!=Some(&json!(true)){return Err("Página remota acessou comando nativo".into())}
        }
        for w in windows{w.destroy().map_err(|_|"Falha ao encerrar perfil")?;}
        Ok::<_,String>(json!({"passed":true,"accounts":4,"cookieIsolation":true,"remoteIpcDenied":true,"realLogin":false,"realPointsMeasured":false}))
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

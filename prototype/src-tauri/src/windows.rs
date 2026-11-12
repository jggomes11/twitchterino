pub const BROWSER_ARGS:&str="--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-media-suspend --disable-features=CalculateNativeWinOcclusion,BackgroundVideoTrackOptimization,IntensiveWakeUpThrottling";
use crate::{
    model::{self, Account, AccountId, Platform},
    platform::{self, Credentials},
    webview,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::sync::watch;

#[derive(Serialize, Deserialize)]
struct Store {
    selected: usize,
    accounts: Vec<Account>,
    #[serde(skip)]
    ui: model::Selection,
}
pub struct Runtime {
    store: Mutex<Store>,
    save_lock: Mutex<()>,
    observe_lock: Mutex<()>,
    pub observation: AtomicU64,
    pub engine: Mutex<Option<Value>>,
    pub root: PathBuf,
    pub platform: Platform,
    pub stopping: AtomicBool,
    pub cancel: [watch::Sender<u64>; 4],
    polling: [AtomicBool; 4],
    pub suspended: [AtomicBool; 4],
    pub next_poll: [AtomicU64; 4],
    pub digests: Mutex<[Option<String>; 4]>,
    pub chest_busy: [AtomicBool; 4],
    pub chest_retry: Mutex<BTreeMap<String, u64>>,
    pub confirmed: Mutex<[Vec<String>; 4]>,
}
impl Runtime {
    fn new(root: PathBuf) -> Self {
        let defaults: Value = serde_json::from_str(include_str!("../defaults.json")).unwrap();
        let mut accounts: Vec<_> = (1..=4)
            .map(|n| {
                let mut a = Account::new(AccountId(format!("account-{n}")));
                a.channels = defaults["channels"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect();
                a
            })
            .collect();
        let mut selected = 0;
        if let Ok(bytes) = std::fs::read(root.join("prototype-config.json")) {
            if let Ok(saved) = serde_json::from_slice::<Store>(&bytes) {
                selected = saved.selected.min(3);
                for (i, mut a) in saved.accounts.into_iter().take(4).enumerate() {
                    a.id = AccountId(format!("account-{}", i + 1));
                    a.max_watchers = a.max_watchers.clamp(1, 2);
                    if a.logout_pending {
                        a.used = false;
                    }
                    a.channels
                        .retain(|s| model::valid_slug(s, Platform::current()));
                    a.channels.truncate(60);
                    accounts[i] = a;
                }
            } else {
                let _ = std::fs::write(
                    root.join(format!("prototype-config-corrupt-{}.json", model::now())),
                    bytes,
                );
            }
        }
        Self {
            store: Mutex::new(Store {
                selected,
                accounts,
                ui: Default::default(),
            }),
            save_lock: Mutex::new(()),
            observe_lock: Mutex::new(()),
            observation: AtomicU64::new(1),
            engine: Mutex::new(None),
            root,
            platform: Platform::current(),
            stopping: AtomicBool::new(false),
            cancel: std::array::from_fn(|_| watch::channel(0).0),
            polling: std::array::from_fn(|_| AtomicBool::new(false)),
            suspended: std::array::from_fn(|_| AtomicBool::new(false)),
            next_poll: std::array::from_fn(|_| AtomicU64::new(0)),
            digests: Mutex::new(std::array::from_fn(|_| None)),
            chest_busy: std::array::from_fn(|_| AtomicBool::new(false)),
            chest_retry: Mutex::new(BTreeMap::new()),
            confirmed: Mutex::new(std::array::from_fn(|_| vec![])),
        }
    }
    pub fn account<R>(&self, id: &AccountId, f: impl FnOnce(&mut Account) -> R) -> R {
        let mut s = self.store.lock().unwrap();
        f(&mut s.accounts[id.index()])
    }
    pub fn current(&self, id: &AccountId, t: u64) -> bool {
        !self.stopping.load(Ordering::SeqCst)
            && !self.suspended[id.index()].load(Ordering::SeqCst)
            && self.account(id, |a| a.current(t))
    }
    pub fn apply_current<R>(
        &self,
        id: &AccountId,
        t: u64,
        f: impl FnOnce(&mut Account) -> R,
    ) -> Option<R> {
        self.account(id, |a| {
            if !self.stopping.load(Ordering::SeqCst)
                && !self.suspended[id.index()].load(Ordering::SeqCst)
                && a.current(t)
                && a.used
                && !a.logout_pending
            {
                Some(f(a))
            } else {
                None
            }
        })
    }
    pub fn invalidate(&self, id: &AccountId) {
        let t = self.account(id, |a| {
            a.invalidate();
            a.ticket()
        });
        self.cancel[id.index()].send_replace(t);
    }
    pub fn is_selected(&self, id: &AccountId) -> bool {
        self.store.lock().unwrap().selected == id.index()
    }
    pub fn snapshot(&self) -> Value {
        let selected = self.store.lock().unwrap().selected;
        self.snapshot_for(selected)
    }
    pub fn snapshot_for(&self, selected: usize) -> Value {
        let s = self.store.lock().unwrap();
        let mut v = s.accounts[selected].snapshot(self.platform, model::now());
        v["accounts"]=json!(s.accounts.iter().enumerate().map(|(i,a)|json!({"id":a.id.0,"label":format!("Conta {}",i+1),"username":if a.logged_in{a.identity.as_ref().map(|i|i.username.clone())}else{None},"loggedIn":a.logged_in,"sessionChecking":a.session_checking,"farming":a.farming,"watching":a.status.values().filter(|c|c.watching_since.is_some()).count(),"today":if a.logged_in{a.today}else{0}})).collect::<Vec<_>>());
        v["uiGeneration"] = json!(s.ui.generation);
        v
    }
    pub fn observe(&self, id: &AccountId, kind: &str, data: Value) {
        use std::io::Write;
        let _guard = self.observe_lock.lock().unwrap();
        let dir = self.root.join(&id.0);
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("observations.jsonl");
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > 5 * 1024 * 1024) {
            let old = dir.join("observations.old.jsonl");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&path, old);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(
                f,
                "{}",
                json!({"utc":chrono::Utc::now().to_rfc3339(),"accountId":id.0,"kind":kind,"engine":self.engine.lock().unwrap().clone(),"data":data})
            );
        }
    }
    pub fn save(&self) -> Result<(), String> {
        let _save = self.save_lock.lock().unwrap();
        std::fs::create_dir_all(&self.root).map_err(|_| "Falha ao criar perfil de teste")?;
        let bytes = serde_json::to_vec_pretty(&*self.store.lock().unwrap())
            .map_err(|_| "Falha ao salvar configuração")?;
        let temp = self.root.join("prototype-config.tmp");
        std::fs::write(&temp, bytes).map_err(|_| "Falha ao salvar configuração")?;
        std::fs::rename(temp, self.root.join("prototype-config.json"))
            .map_err(|_| "Falha ao substituir configuração".into())
    }
}
pub fn emit_state(app: &AppHandle) {
    let rt = app.state::<Runtime>();
    let _ = app.emit_to("main", "status", rt.snapshot());
}
pub fn toast(app: &AppHandle, id: &AccountId, message: &str) {
    let _ = app.emit_to(
        "main",
        "toast",
        json!({"accountId":id.0,"payload":{"title":"Protótipo","body":message}}),
    );
}
fn authorize(w: &WebviewWindow) -> Result<(), String> {
    let u = w.url().map_err(|_| "Origem inválida")?;
    if w.label() == "main"
        && ((u.scheme() == "tauri" && u.host_str() == Some("localhost"))
            || (matches!(u.scheme(), "http" | "https") && u.host_str() == Some("tauri.localhost")))
        && u.port().is_none()
        && u.username().is_empty()
        && u.password().is_none()
        && u.query().is_none()
        && matches!(u.path(), "/" | "/index.html")
    {
        Ok(())
    } else {
        Err("Origem não autorizada".into())
    }
}
#[tauri::command]
async fn snapshot(window: WebviewWindow, state: State<'_, Runtime>) -> Result<Value, String> {
    authorize(&window)?;
    Ok(state.snapshot())
}
#[tauri::command]
async fn select_account(
    window: WebviewWindow,
    state: State<'_, Runtime>,
    id: String,
    revision: u64,
    ui_generation: u64,
) -> Result<Value, String> {
    authorize(&window)?;
    let id = AccountId::parse(&id)?;
    {
        let mut store = state.store.lock().unwrap();
        if !store.ui.select(id.index(), ui_generation, revision) {
            return Err("Seleção antiga".into());
        }
        store.selected = id.index();
    }
    state.save()?;
    Ok(state.snapshot_for(id.index()))
}

fn argument<'a>(args: &'a [Value], n: usize) -> Result<&'a Value, String> {
    args.get(n).ok_or_else(|| "Argumento inválido".into())
}
fn flag(args: &[Value]) -> Result<bool, String> {
    argument(args, 0)?
        .as_bool()
        .ok_or_else(|| "Valor booleano obrigatório".into())
}
pub fn verified_credentials(
    app: &AppHandle,
    id: &AccountId,
    ticket: u64,
) -> Result<Credentials, String> {
    let rt = app.state::<Runtime>();
    if !rt.current(id, ticket) || !rt.account(id, |a| a.logged_in) {
        return Err("Aguarde a confirmação da conta".into());
    }
    let c = credentials(app, id)?;
    let matches = rt.digests.lock().unwrap()[id.index()].as_ref() == Some(&c.fingerprint());
    if !matches {
        let changed = rt.account(id, |a| {
            if a.current(ticket) {
                a.invalidate();
                Some(a.ticket())
            } else {
                None
            }
        });
        if let Some(next) = changed {
            rt.cancel[id.index()].send_replace(next);
            close_for_ticket(app, id, next);
            rt.next_poll[id.index()].store(0, Ordering::SeqCst);
            emit_state(app);
        }
        return Err("Sessão alterada. Aguarde a confirmação da conta.".into());
    }
    Ok(c)
}
fn channel_arg(rt: &Runtime, id: &AccountId, args: &[Value]) -> Result<String, String> {
    let s = argument(args, 0)?
        .as_str()
        .ok_or("Canal inválido")?
        .to_lowercase();
    if !model::valid_slug(&s, rt.platform) || !rt.account(id, |a| a.channels.contains(&s)) {
        return Err("Canal desconhecido".into());
    }
    Ok(s)
}
#[tauri::command]
async fn account_command(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    command: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    authorize(&window)?;
    let id = AccountId::parse(&id)?;
    let rt = app.state::<Runtime>();
    if args.len() > 2 {
        return Err("Argumentos inválidos".into());
    }
    if rt.suspended[id.index()].load(Ordering::SeqCst) {
        return Err("Aguarde a saída da conta".into());
    }
    let mut result = None;
    match command.as_str() {
        "app:quit" => {
            shutdown(&app);
            app.exit(0);
            result = Some(json!({"ok":true}));
        }
        "login:show" => {
            if rt.account(&id, |a| a.logout_pending) {
                logout(&app, &id).await?;
            }
            rt.account(&id, |a| a.used = true);
            open_remote(&app, &id, "auth", None, true)?;
            rt.next_poll[id.index()].store(0, Ordering::SeqCst);
            result = Some(json!({"ok":true}));
        }
        "logout" => {
            logout(&app, &id).await?;
        }
        "channels:add" => {
            let slug = argument(&args, 0)?
                .as_str()
                .ok_or("Canal inválido")?
                .trim()
                .to_lowercase();
            if !model::valid_slug(&slug, rt.platform) {
                return Err("Canal inválido".into());
            }
            rt.account(&id, |a| {
                if !a.channels.contains(&slug) && a.channels.len() < 60 {
                    a.channels.push(slug);
                }
            });
        }
        "channels:remove" => {
            let slug = channel_arg(&rt, &id, &args)?;
            rt.account(&id, |a| {
                a.channels.retain(|s| s != &slug);
                a.status.remove(&slug);
            });
            if let Some(w) = app.get_webview_window(&label(&id, "player", Some(&slug))) {
                let _ = w.destroy();
            }
        }
        "farming:set" => {
            let on = flag(&args)?;
            rt.account(&id, |a| a.farming = on);
        }
        "rotation:set" => {
            let on = flag(&args)?;
            rt.account(&id, |a| a.rotation = on);
        }
        "lowQuality:set" => {
            let on = flag(&args)?;
            rt.account(&id, |a| a.low_quality = on);
            let slugs = rt.account(&id, |a| {
                a.status
                    .iter()
                    .filter(|(_, c)| c.watching_since.is_some() && !c.shown)
                    .map(|(s, _)| s.clone())
                    .collect::<Vec<_>>()
            });
            for slug in slugs {
                if let Some(w) = app.get_webview_window(&label(&id, "player", Some(&slug))) {
                    let _ = w.navigate(
                        format!("{}/{}", rt.platform.origin(), slug)
                            .parse()
                            .unwrap(),
                    );
                }
            }
        }
        "autoChest:set" => {
            if rt.platform != Platform::Twitch {
                return Err("Sem baú nesta plataforma".into());
            }
            let on = flag(&args)?;
            rt.account(&id, |a| a.auto_chest = on);
            if !on {
                for (l, w) in app.webview_windows() {
                    if l.starts_with(&format!("{}-chest-", id.0)) {
                        let _ = w.destroy();
                    }
                }
            }
        }
        "maxWatchers:set" => {
            let n = argument(&args, 0)?
                .as_u64()
                .filter(|n| (1..=2).contains(n))
                .ok_or("O protótipo usa uma ou duas lives")?;
            rt.account(&id, |a| a.max_watchers = n as usize);
        }
        "bonusTarget:set" => {
            let v = argument(&args, 0)?.clone();
            let valid = if rt.platform == Platform::Twitch {
                v.as_str().is_some_and(|s| {
                    s.is_empty()
                        || regex::Regex::new(r"^(xp|capture|lure)(:(1|3|5|10))?$")
                            .unwrap()
                            .is_match(s)
                })
            } else {
                v.as_u64().is_some_and(|n| [0, 300, 500, 1000].contains(&n))
            };
            if !valid {
                return Err("Bônus inválido".into());
            }
            rt.account(&id, |a| a.bonus_target = v);
        }
        "favorite:toggle" => {
            let s = channel_arg(&rt, &id, &args)?;
            rt.account(&id, |a| {
                if a.favorites.contains(&s) {
                    a.favorites.retain(|v| v != &s)
                } else {
                    a.favorites.push(s)
                }
            });
        }
        "channel:show" | "store:open" => {
            let s = channel_arg(&rt, &id, &args)?;
            if !rt.account(&id, |a| a.logged_in) {
                return Err("Faça login antes de abrir a página".into());
            }
            let ticket = rt.account(&id, |a| a.ticket());
            let _ = verified_credentials(&app, &id, ticket)?;
            let kind = if command == "channel:show" {
                "player"
            } else {
                "store"
            };
            open_remote(&app, &id, kind, Some(&s), true)?;
        }
        "chat:send" => {
            let data = argument(&args, 0)?;
            let content = data["content"].as_str().ok_or("Mensagem inválida")?;
            let room = data
                .get("chatroomId")
                .and_then(|v| {
                    v.as_str()
                        .map(String::from)
                        .or_else(|| v.as_u64().map(|n| n.to_string()))
                })
                .ok_or("Canal inválido")?;
            let ticket = rt.account(&id, |a| a.ticket());
            let mut cancel = rt.cancel[id.index()].subscribe();
            let c = verified_credentials(&app, &id, ticket)?;
            if !rt.current(&id, ticket) {
                return Err("Sessão alterada".into());
            }
            let sent = tokio::select! {v=crate::chat::send(&app,&id,&room,content,&c)=>v,_=cancel.changed()=>Err("Sessão alterada".into())};
            if !rt.current(&id, ticket) {
                return Err("Sessão alterada".into());
            }
            sent?;
            result = Some(json!({"ok":true}));
        }
        "refresh" => {}
        _ => return Err("Função fora do escopo do protótipo".into()),
    }
    rt.save()?;
    rt.next_poll[id.index()].store(0, Ordering::SeqCst);
    reconcile(&app, &id)?;
    emit_state(&app);
    let value = result.unwrap_or_else(|| rt.snapshot_for(id.index()));
    Ok(json!({"accountId":id.0,"result":value}))
}
pub fn label(id: &AccountId, kind: &str, slug: Option<&str>) -> String {
    format!(
        "{}-{kind}{}",
        id.0,
        slug.map(|s| format!("-{s}")).unwrap_or_default()
    )
}
fn slot_window(app: &AppHandle, id: &AccountId) -> Option<WebviewWindow> {
    let prefix = format!("{}-", id.0);
    app.get_webview_window(&label(id, "auth", None))
        .or_else(|| {
            app.webview_windows()
                .into_iter()
                .find(|(l, _)| l.starts_with(&prefix))
                .map(|(_, w)| w)
        })
}
pub fn credentials(app: &AppHandle, id: &AccountId) -> Result<Credentials, String> {
    let rt = app.state::<Runtime>();
    let w = slot_window(app, id).ok_or("Perfil ainda não aberto")?;
    let cookies = w
        .cookies_for_url(rt.platform.origin().parse().unwrap())
        .map_err(|_| "Cookies indisponíveis")?;
    let read = |name: &str| -> Result<String, String> {
        cookies
            .iter()
            .find(|c| c.name() == name)
            .map(|c| {
                percent_encoding::percent_decode_str(c.value())
                    .decode_utf8()
                    .map(|s| s.into_owned())
                    .map_err(|_| "Cookie inválido".into())
            })
            .unwrap_or_else(|| Ok(String::new()))
    };
    let agent = {
        rt.engine
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|v| v["userAgent"].as_str())
            .unwrap_or("")
            .to_string()
    };
    Ok(Credentials {
        token: read(if rt.platform == Platform::Twitch {
            "auth-token"
        } else {
            "session_token"
        })?,
        device: read("unique_id")?,
        xsrf: read("XSRF-TOKEN")?,
        agent,
        cookies: cookies
            .iter()
            .map(|c| format!("{}={}", c.name(), c.value()))
            .collect::<Vec<_>>()
            .join("; "),
    })
}
fn owned_popup(
    app: &AppHandle,
    id: &AccountId,
    dir: &std::path::Path,
    url: url::Url,
    features: tauri::webview::NewWindowFeatures,
) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    use tauri::webview::NewWindowResponse;
    let rt = app.state::<Runtime>();
    let ticket = rt.account(id, |a| a.ticket());
    if url.scheme() != "https"
        || !rt.current(id, ticket)
        || !rt.account(id, |a| a.used && !a.logout_pending)
    {
        return NewWindowResponse::Deny;
    }
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let name = format!("{}-popup-{}", id.0, SEQUENCE.fetch_add(1, Ordering::SeqCst));
    let owner_app = app.clone();
    let owner_id = id.clone();
    let owner_dir = dir.to_path_buf();
    let result = WebviewWindowBuilder::new(
        app,
        name,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(format!("{} — {} — Login", rt.platform.name(), id.0))
    .data_directory(dir.to_path_buf())
    .window_features(features)
    .on_navigation(|u| u.scheme() == "https" || u.as_str() == "about:blank")
    .on_new_window(move |u, f| owned_popup(&owner_app, &owner_id, &owner_dir, u, f))
    .build();
    match result {
        Ok(window) => {
            if !rt.current(id, ticket) || !rt.account(id, |a| a.used && !a.logout_pending) {
                let _ = window.destroy();
                NewWindowResponse::Deny
            } else {
                webview::secure_remote(&window, app);
                NewWindowResponse::Create { window }
            }
        }
        Err(_) => NewWindowResponse::Deny,
    }
}
pub fn open_remote(
    app: &AppHandle,
    id: &AccountId,
    kind: &str,
    slug: Option<&str>,
    visible: bool,
) -> Result<WebviewWindow, String> {
    let rt = app.state::<Runtime>();
    let owner_ticket = rt.account(id, |a| a.ticket());
    if kind == "auth" && visible && rt.suspended[id.index()].load(Ordering::SeqCst) {
        return Err("Saída da conta em andamento".into());
    }
    if kind != "auth"
        && !rt.account(id, |a| {
            a.current(owner_ticket) && a.logged_in && a.used && !a.logout_pending
        })
    {
        return Err("Sessão indisponível".into());
    }
    let name = label(id, kind, slug);
    if let Some(w) = app.get_webview_window(&name) {
        if visible {
            if kind == "auth" {
                w.navigate(
                    format!(
                        "{}/{}",
                        rt.platform.origin(),
                        if rt.platform == Platform::Twitch {
                            "login"
                        } else {
                            ""
                        }
                    )
                    .parse()
                    .unwrap(),
                )
                .map_err(|_| "Falha ao abrir login")?;
            }
            webview::visibility(&w, true);
            if kind == "player" {
                rt.account(id, |a| {
                    if let Some(c) = a.status.get_mut(slug.unwrap()) {
                        c.shown = true;
                    }
                });
                w.navigate(
                    format!("{}/{}", rt.platform.origin(), slug.unwrap())
                        .parse()
                        .unwrap(),
                )
                .map_err(|_| "Falha ao mostrar player")?;
            }
        }
        return Ok(w);
    }
    let url = if kind == "auth" {
        if visible {
            format!(
                "{}/{}",
                rt.platform.origin(),
                if rt.platform == Platform::Twitch {
                    "login"
                } else {
                    ""
                }
            )
        } else {
            format!("{}/robots.txt", rt.platform.origin())
        }
    } else if kind == "player" {
        format!("{}/{}", rt.platform.origin(), slug.unwrap())
    } else {
        format!(
            "{}/popout/{}/chat{}",
            rt.platform.origin(),
            slug.unwrap(),
            if rt.platform == Platform::Twitch {
                "?popout="
            } else {
                ""
            }
        )
    };
    let dir = rt.root.join("webview").join(&id.0);
    let app_popup = app.clone();
    let id_popup = id.clone();
    let popup_dir = dir.clone();
    let builder = WebviewWindowBuilder::new(
        app,
        &name,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(format!(
        "{} — {} — {}",
        rt.platform.name(),
        id.0,
        slug.unwrap_or("Login")
    ))
    .data_directory(dir)
    .additional_browser_args(BROWSER_ARGS)
    .inner_size(
        if kind == "player" { 480. } else { 1000. },
        if kind == "player" { 270. } else { 800. },
    )
    .visible(false)
    .on_navigation(|u| u.scheme() == "https" || u.as_str() == "about:blank")
    .on_new_window(move |url, features| {
        owned_popup(&app_popup, &id_popup, &popup_dir, url, features)
    });
    let w = builder
        .build()
        .map_err(|_| "Falha ao criar página oficial")?;
    let ticket = owner_ticket;
    if (kind != "auth" || visible)
        && (!rt.current(id, ticket) || !rt.account(id, |a| a.used && !a.logout_pending))
    {
        let _ = w.destroy();
        return Err("Sessão alterada".into());
    }
    webview::instrument(&w, app, id, kind, slug, ticket, url)?;
    if kind == "player" {
        rt.account(id, |a| {
            let c = a.status.entry(slug.unwrap().into()).or_default();
            c.watching_since = Some(model::now());
            c.shown = visible;
        });
    }
    let app_close = app.clone();
    let id_close = id.clone();
    let k = kind.to_owned();
    let s = slug.map(String::from);
    let win = w.clone();
    let started = rt.account(id, |a| {
        slug.and_then(|s| a.status.get(s))
            .and_then(|c| c.watching_since)
    });
    w.on_window_event(move |event| {
        let rt = app_close.state::<Runtime>();
        if let WindowEvent::CloseRequested { api, .. } = event {
            if !rt.stopping.load(Ordering::SeqCst)
                && !rt.suspended[id_close.index()].load(Ordering::SeqCst)
            {
                if k == "auth" {
                    api.prevent_close();
                    let _ = win.hide();
                    let _ = win.navigate(
                        format!("{}/robots.txt", rt.platform.origin())
                            .parse()
                            .unwrap(),
                    );
                    rt.next_poll[id_close.index()].store(0, Ordering::SeqCst);
                } else if k == "player" && rt.account(&id_close, |a| a.farming && a.logged_in) {
                    api.prevent_close();
                    rt.account(&id_close, |a| {
                        if let Some(c) = a.status.get_mut(s.as_ref().unwrap()) {
                            c.shown = false;
                        }
                    });
                    webview::visibility(&win, false);
                    if rt.account(&id_close, |a| a.low_quality) {
                        let _ = win.navigate(
                            format!("{}/{}", rt.platform.origin(), s.as_ref().unwrap())
                                .parse()
                                .unwrap(),
                        );
                    }
                }
            }
        }
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(s) = s.as_ref() {
                if k == "player" {
                    rt.account(&id_close, |a| {
                        if !a.current(ticket) {
                            return;
                        }
                        if let Some(c) = a.status.get_mut(s).filter(|c| c.watching_since == started)
                        {
                            c.watched_ms += c
                                .watching_since
                                .take()
                                .map(|t| model::now().saturating_sub(t))
                                .unwrap_or(0);
                            c.shown = false;
                        }
                    });
                }
            }
            rt.next_poll[id_close.index()].store(0, Ordering::SeqCst);
            emit_state(&app_close);
        }
    });
    if kind == "player" || kind == "chest" {
        webview::visibility(&w, visible);
    } else if visible {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(w)
}
pub fn close_for_ticket(app: &AppHandle, id: &AccountId, ticket: u64) {
    let windows = app
        .webview_windows()
        .into_iter()
        .filter(|(l, _)| l.starts_with(&format!("{}-", id.0)) && !l.ends_with("-auth"))
        .map(|(_, w)| w)
        .collect::<Vec<_>>();
    let rt = app.state::<Runtime>();
    if rt
        .apply_current(id, ticket, |a| {
            for c in a.status.values_mut() {
                c.watched_ms += c
                    .watching_since
                    .take()
                    .map(|t| model::now().saturating_sub(t))
                    .unwrap_or(0);
                c.shown = false;
            }
        })
        .is_some()
    {
        for w in windows {
            let _ = w.destroy();
        }
    }
}
pub fn close_players(app: &AppHandle, id: &AccountId) {
    let rt = app.state::<Runtime>();
    rt.account(id, |a| {
        for c in a.status.values_mut() {
            c.watched_ms += c
                .watching_since
                .take()
                .map(|t| model::now().saturating_sub(t))
                .unwrap_or(0);
            c.shown = false;
        }
    });
    for (l, w) in app.webview_windows() {
        if l.starts_with(&format!("{}-", id.0)) && !l.ends_with("-auth") {
            let _ = w.destroy();
        }
    }
    let active =
        rt.store.lock().unwrap().accounts.iter().any(|a| {
            a.logged_in && a.farming && a.status.values().any(|c| c.watching_since.is_some())
        });
    webview::keep_awake(app, active);
}
async fn logout(app: &AppHandle, id: &AccountId) -> Result<(), String> {
    let rt = app.state::<Runtime>();
    if rt.suspended[id.index()].swap(true, Ordering::SeqCst) {
        return Err("Saída da conta em andamento".into());
    }
    rt.invalidate(id);
    rt.account(id, |a| {
        a.used = false;
        a.logout_pending = true;
        a.identity = None;
        a.today = 0;
        a.chests = 0;
    });
    close_players(app, id);
    let _ = rt.save();
    emit_state(app);
    let cleanup = async {
        let w = if let Some(w) = slot_window(app, id) {
            w
        } else {
            open_remote(app, id, "auth", None, false)?
        };
        webview::cdp(&w, "Network.clearBrowserCookies", json!({})).await?;
        for origin in [
            rt.platform.origin(),
            if rt.platform == Platform::Twitch {
                "https://id.twitch.tv"
            } else {
                "https://www.kick.com"
            },
            "https://passport.twitch.tv",
        ] {
            webview::cdp(
                &w,
                "Storage.clearDataForOrigin",
                json!({"origin":origin,"storageTypes":"all"}),
            )
            .await?;
        }
        Ok::<(), String>(())
    }
    .await;
    for (l, w) in app.webview_windows() {
        if l.starts_with(&format!("{}-", id.0)) {
            let _ = w.destroy();
        }
    }
    rt.account(id,|a|{a.status.clear();a.session_checking=false;a.logout_pending=cleanup.is_err();a.error=cleanup.as_ref().err().map(|_|"Saída incompleta. Ao entrar novamente, o app tentará limpar o perfil antes do login.".into());});
    rt.digests.lock().unwrap()[id.index()] = None;
    let _ = rt.save();
    rt.suspended[id.index()].store(false, Ordering::SeqCst);
    emit_state(app);
    cleanup
}
pub fn reconcile(app: &AppHandle, id: &AccountId) -> Result<(), String> {
    let rt = app.state::<Runtime>();
    let now = model::now();
    let recycle = rt.account(id, |a| {
        a.status
            .iter()
            .filter(|(_, c)| {
                !c.shown
                    && c.watching_since.is_some_and(|t| {
                        now.saturating_sub(t) >= 6 * 3600_000 || c.earning(now) == "idle"
                    })
            })
            .map(|(s, _)| s.clone())
            .collect::<Vec<_>>()
    });
    for s in recycle {
        rt.account(id, |a| {
            if let Some(c) = a.status.get_mut(&s) {
                if c.earning(now) == "idle" {
                    c.cooldown_until = now + 30 * 60_000;
                }
                c.watched_ms += c
                    .watching_since
                    .take()
                    .map(|t| now.saturating_sub(t))
                    .unwrap_or(0);
            }
        });
        if let Some(w) = app.get_webview_window(&label(id, "player", Some(&s))) {
            let _ = w.destroy();
        }
    }
    let desired = rt.account(id, |a| a.desired(rt.platform, now));
    let prefix = format!("{}-player-", id.0);
    for (l, w) in app.webview_windows() {
        if let Some(s) = l.strip_prefix(&prefix) {
            if !desired.iter().any(|v| v == s) {
                rt.account(id, |a| {
                    if let Some(c) = a.status.get_mut(s) {
                        c.watched_ms += c
                            .watching_since
                            .take()
                            .map(|t| now.saturating_sub(t))
                            .unwrap_or(0);
                    }
                });
                let _ = w.destroy();
            }
        }
    }
    for s in desired {
        if app
            .get_webview_window(&label(id, "player", Some(&s)))
            .is_none()
        {
            open_remote(app, id, "player", Some(&s), false)?;
        }
    }
    let active =
        rt.store.lock().unwrap().accounts.iter().any(|a| {
            a.logged_in && a.farming && a.status.values().any(|c| c.watching_since.is_some())
        });
    webview::keep_awake(app, active);
    Ok(())
}
struct PollGuard<'a>(&'a AtomicBool);
impl Drop for PollGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
async fn poll_account(app: AppHandle, id: AccountId, c: Credentials, ticket: u64) {
    let rt = app.state::<Runtime>();
    if rt.polling[id.index()].swap(true, Ordering::SeqCst) {
        rt.next_poll[id.index()].fetch_min(model::now() + 1000, Ordering::SeqCst);
        return;
    }
    let _guard = PollGuard(&rt.polling[id.index()]);
    let mut cancel = rt.cancel[id.index()].subscribe();
    if !rt.current(&id, ticket) || !rt.account(&id, |a| a.used) {
        return;
    }
    let fingerprint = c.fingerprint();
    let work = async {
        let identity = match platform::identity(rt.platform, &c).await {
            Ok(i) => i,
            Err(e) => {
                if rt.current(&id, ticket) {
                    rt.apply_current(&id, ticket, |a| a.logged_in = false);
                    close_for_ticket(&app, &id, ticket);
                }
                return Err(e);
            }
        };
        if !rt.current(&id, ticket)
            || credentials(&app, &id)
                .map(|v| v.fingerprint())
                .ok()
                .as_ref()
                != Some(&fingerprint)
        {
            return Err("Sessão alterada".into());
        }
        let changed = rt
            .apply_current(&id, ticket, |a| {
                let changed = a.identity.as_ref().is_some_and(|old| old.id != identity.id);
                a.adopt_identity(identity);
                changed
            })
            .ok_or("Sessão alterada")?;
        if changed {
            rt.confirmed.lock().unwrap()[id.index()].clear();
            rt.chest_retry
                .lock()
                .unwrap()
                .retain(|k, _| !k.starts_with(&format!("{}:", id.0)));
            close_for_ticket(&app, &id, ticket);
        }
        let slugs = rt.account(&id, |a| a.channels.clone());
        let observation = rt.observation.fetch_add(1, Ordering::SeqCst);
        let rows = platform::channels(rt.platform, &c, &slugs).await?;
        if !rt.current(&id, ticket)
            || credentials(&app, &id)
                .map(|v| v.fingerprint())
                .ok()
                .as_ref()
                != Some(&fingerprint)
        {
            return Err("Sessão alterada".into());
        }
        rt.apply_current(&id, ticket, |a| {
            for (s, mut ch) in rows {
                if !a.channels.contains(&s) {
                    continue;
                }
                let points = ch.points.take();
                let old = a.status.entry(s.clone()).or_default();
                ch.gained = old.gained;
                ch.points = old.points;
                ch.watching_since = old.watching_since;
                ch.watched_ms = old.watched_ms;
                ch.shown = old.shown;
                ch.last_gain = old.last_gain;
                ch.cooldown_until = old.cooldown_until;
                ch.inspection_failures = old.inspection_failures;
                ch.video = old.video.clone();
                ch.balance_revision = old.balance_revision;
                ch.chest_error = old.chest_error.clone();
                a.status.insert(s.clone(), ch);
                if let Some(p) = points {
                    a.set_balance_observed(&s, p, model::now(), observation);
                }
            }
            a.error = None;
            a.session_checking = false;
        })
        .ok_or("Sessão alterada")?;
        reconcile(&app, &id)?;
        webview::inspect_players(&app, &id, ticket).await;
        rt.observe(
            &id,
            "poll",
            rt.account(&id, |a| a.snapshot(rt.platform, model::now())),
        );
        crate::chest::schedule(&app, &id);
        Ok::<(), String>(())
    };
    let result = tokio::select! {v=tokio::time::timeout(Duration::from_secs(300),work)=>v.unwrap_or_else(|_|Err("Consulta excedeu cinco minutos; será repetida".into())),_=cancel.changed()=>return};
    if rt.current(&id, ticket) {
        if let Err(e) = result {
            rt.apply_current(&id, ticket, |a| {
                a.session_checking = false;
                a.error = Some(e.clone());
                for s in &a.channels {
                    a.status.entry(s.clone()).or_default().error = Some(e.clone());
                }
            });
        }
    }
    emit_state(&app);
}
fn tick_account(app: &AppHandle, id: &AccountId) {
    let rt = app.state::<Runtime>();
    if rt.stopping.load(Ordering::SeqCst) || rt.suspended[id.index()].load(Ordering::SeqCst) {
        return;
    }
    let (used, before) = rt.account(id, |a| (a.used && !a.logout_pending, a.ticket()));
    if !used {
        return;
    }
    if slot_window(app, id).is_none() {
        let _ = open_remote(app, id, "auth", None, false);
    }
    let Ok(c) = credentials(app, id) else { return };
    if !rt.current(id, before) {
        return;
    }
    let fingerprint = c.fingerprint();
    let changed = {
        let mut d = rt.digests.lock().unwrap();
        let changed = d[id.index()].as_ref() != Some(&fingerprint);
        if changed {
            d[id.index()] = Some(fingerprint);
        }
        changed
    };
    let ticket = if changed {
        let next = rt.account(id, |a| {
            if a.current(before) && a.used && !a.logout_pending {
                a.invalidate();
                Some(a.ticket())
            } else {
                None
            }
        });
        let Some(next) = next else { return };
        rt.cancel[id.index()].send_replace(next);
        close_for_ticket(app, id, next);
        rt.next_poll[id.index()].store(0, Ordering::SeqCst);
        next
    } else {
        before
    };
    if !rt.current(id, ticket) || !rt.account(id, |a| a.used) {
        return;
    }
    if c.token.is_empty() {
        rt.account(id, |a| {
            a.logged_in = false;
            a.session_checking = false;
        });
        emit_state(app);
    } else if model::now() >= rt.next_poll[id.index()].load(Ordering::SeqCst) {
        rt.next_poll[id.index()].store(model::now() + 60_000, Ordering::SeqCst);
        let app = app.clone();
        let id = id.clone();
        tauri::async_runtime::spawn(async move {
            poll_account(app, id, c, ticket).await;
        });
    }
}
fn start_tasks(app: &AppHandle) {
    for n in 1..=4 {
        let app = app.clone();
        let id = AccountId(format!("account-{n}"));
        tauri::async_runtime::spawn(async move {
            let a = app.clone();
            let i = id.clone();
            tauri::async_runtime::spawn(async move {
                crate::chat::receive(a, i).await;
            });
            let mut last_tick = model::now();
            loop {
                let current = model::now();
                if current.saturating_sub(last_tick) > 60_000 || current < last_tick {
                    let rt = app.state::<Runtime>();
                    if rt.account(&id, |a| a.used) {
                        rt.invalidate(&id);
                        close_players(&app, &id);
                        rt.digests.lock().unwrap()[id.index()] = None;
                        rt.next_poll[id.index()].store(0, Ordering::SeqCst);
                    }
                }
                last_tick = current;
                if app.state::<Runtime>().stopping.load(Ordering::SeqCst) {
                    break;
                }
                tick_account(&app, &id);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
    }
}
fn shutdown(app: &AppHandle) {
    let rt = app.state::<Runtime>();
    rt.stopping.store(true, Ordering::SeqCst);
    for n in 1..=4 {
        rt.invalidate(&AccountId(format!("account-{n}")));
    }
    let _ = rt.save();
    webview::keep_awake(app, false);
}
pub fn run() {
    if std::env::args().any(|a| a == "--smoke-test") {
        std::panic::set_hook(Box::new(|info| {
            if let Some(path) = std::env::var_os("TERINO_SMOKE_OUTPUT") {
                let _ = std::fs::write(
                    path,
                    serde_json::to_vec_pretty(&json!({"passed":false,"panic":info.to_string()}))
                        .unwrap_or_default(),
                );
            }
        }));
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .on_page_load(|w, p| {
            if w.label() == "main" && matches!(p.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(rt) = w.try_state::<Runtime>() {
                    rt.store.lock().unwrap().ui.new_document();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            select_account,
            account_command
        ])
        .on_window_event(|w, e| {
            if w.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = e {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .setup(|app| {
            let root = if std::env::args().any(|a| a == "--smoke-test") {
                {
                    let path = std::env::var_os("TERINO_SMOKE_PROFILE")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| {
                            std::env::temp_dir()
                                .join(format!("terino-prototype-smoke-{}", std::process::id()))
                        });
                    if !path.starts_with(std::env::temp_dir()) {
                        return Err("O perfil de smoke deve ficar no diretório temporário".into());
                    }
                    path
                }
            } else {
                app.path().app_data_dir()?
            };
            app.manage(Runtime::new(root));
            let show = tauri::menu::MenuItem::with_id(app, "show", "Abrir", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            tauri::tray::TrayIconBuilder::new()
                .icon(icon)
                .tooltip(format!("{} — Protótipo", Platform::current().name()))
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        shutdown(app);
                        app.exit(0)
                    }
                    _ => {}
                })
                .build(app)?;
            if std::env::args().any(|a| a == "--smoke-test") {
                crate::webview::smoke(app.handle().clone());
            } else {
                start_tasks(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Falha ao iniciar o protótipo WebView2");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            shutdown(app);
        }
    });
}

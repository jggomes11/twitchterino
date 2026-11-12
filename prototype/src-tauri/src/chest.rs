use crate::{
    model::{self, AccountId, Platform},
    platform::{self},
    webview,
    windows::{self, Runtime},
};
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Manager};
struct Busy<'a>(&'a std::sync::atomic::AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
pub fn schedule(app: &AppHandle, id: &AccountId) {
    let rt = app.state::<Runtime>();
    if rt.platform != Platform::Twitch || rt.chest_busy[id.index()].swap(true, Ordering::SeqCst) {
        return;
    }
    let ticket = rt.account(id, |a| a.ticket());
    let app = app.clone();
    let id = id.clone();
    tauri::async_runtime::spawn(async move {
        let rt = app.state::<Runtime>();
        let _busy = Busy(&rt.chest_busy[id.index()]);
        let mut cancel = rt.cancel[id.index()].subscribe();
        let work = async {
            let claims = rt.account(&id, |a| {
                if a.logged_in && a.auto_chest {
                    a.status
                        .iter()
                        .filter_map(|(s, c)| Some((s.clone(), c.claim.clone()?, c.points?)))
                        .collect::<Vec<_>>()
                } else {
                    vec![]
                }
            });
            for (slug, claim, before) in claims {
                if !rt.current(&id, ticket) || !rt.account(&id, |a| a.auto_chest) {
                    break;
                }
                if rt.confirmed.lock().unwrap()[id.index()].contains(&claim) {
                    continue;
                }
                let key = format!("{}:{slug}", id.0);
                if rt
                    .chest_retry
                    .lock()
                    .unwrap()
                    .get(&key)
                    .copied()
                    .unwrap_or(0)
                    > model::now()
                {
                    continue;
                }
                rt.chest_retry
                    .lock()
                    .unwrap()
                    .insert(key, model::now() + 90_000);
                let result = claim_one(&app, &id, &slug, &claim, before, ticket).await;
                if let Some(w) = app.get_webview_window(&windows::label(&id, "chest", Some(&slug)))
                {
                    let _ = w.destroy();
                }
                if result.is_err() && rt.current(&id, ticket) {
                    rt.account(&id, |a| {
                        if let Some(c) = a.status.get_mut(&slug) {
                            c.chest_error =
                                Some("Baú não confirmado; nova tentativa depois".into());
                        }
                    });
                }
                windows::emit_state(&app);
            }
        };
        tokio::select! {_=work=>{},_=cancel.changed()=>{}};
    });
}
async fn claim_one(
    app: &AppHandle,
    id: &AccountId,
    slug: &str,
    claim: &str,
    before: u64,
    ticket: u64,
) -> Result<(), String> {
    let rt = app.state::<Runtime>();
    let c = windows::credentials(app, id)?;
    let fingerprint = c.fingerprint();
    let identity = rt
        .account(id, |a| a.identity.clone())
        .ok_or("Sessão indisponível")?;
    let w = windows::open_remote(app, id, "chest", Some(slug), false)?;
    let expected = format!("/popout/{slug}/chat");
    let script = format!(
        r#"new Promise(resolve=>{{const start=Date.now();const t=setInterval(()=>{{if(location.origin!=='https://www.twitch.tv'||location.pathname.replace(/\/$/,'')!=={}){{clearInterval(t);resolve({{clicked:false}});return;}}const icon=document.querySelector('.claimable-bonus__icon');const button=icon&&icon.closest('button');if(button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&!String(button.className).includes('ScCoreButtonDestructive')){{clearInterval(t);button.click();resolve({{clicked:true}});}}else if(Date.now()-start>=40000){{clearInterval(t);resolve({{clicked:false}});}}}},500);}})"#,
        json!(expected)
    );
    // Navigation may still be in progress. Retry only the restricted bonus selector on the fixed page.
    let mut clicked = false;
    for _ in 0..4 {
        if !rt.current(id, ticket) || !rt.account(id, |a| a.auto_chest) {
            return Err("Sessão alterada".into());
        }
        let v = webview::cdp(
            &w,
            "Runtime.evaluate",
            json!({"expression":script,"awaitPromise":true,"returnByValue":true}),
        )
        .await?;
        if v.pointer("/result/value/clicked") == Some(&json!(true)) {
            clicked = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
    if !clicked {
        return Err("Botão de bônus indisponível".into());
    }
    for _ in 0..5 {
        if !rt.current(id, ticket) || windows::credentials(app, id)?.fingerprint() != fingerprint {
            return Err("Sessão alterada".into());
        }
        let query=format!("query{{currentUser{{id login}} channel:user(login:{}){{channel{{self{{communityPoints{{balance availableClaim{{id}}}}}}}}}}}}",json!(slug));
        let observation = rt.observation.fetch_add(1, Ordering::SeqCst);
        let v = platform::request(
            Platform::Twitch,
            "/gql",
            "POST",
            &c,
            Some(json!({"query":query})),
        )
        .await?;
        if let Some((balance, new_claim)) =
            platform::confirmed_claim(&v, &identity.id, before, claim)
        {
            if rt
                .apply_current(id, ticket, |a| {
                    a.set_balance_observed(slug, balance, model::now(), observation);
                    a.chests += 1;
                    if let Some(s) = a.status.get_mut(slug) {
                        s.claim = new_claim;
                        s.chest_error = None;
                    }
                })
                .is_none()
            {
                return Err("Sessão alterada".into());
            }
            let mut ids = rt.confirmed.lock().unwrap();
            let ids = &mut ids[id.index()];
            ids.push(claim.into());
            if ids.len() > 256 {
                ids.remove(0);
            }
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("Baú sem confirmação de saldo".into())
}

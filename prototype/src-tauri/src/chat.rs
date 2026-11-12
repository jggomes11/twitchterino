use crate::{
    model::{AccountId, Platform},
    platform::{self, Credentials},
    windows::Runtime,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::Message};
fn parse(line: &str) -> Option<(String, Value)> {
    let mut rest = line;
    let mut tags = std::collections::BTreeMap::new();
    if rest.starts_with('@') {
        let (a, b) = rest.split_once(' ')?;
        rest = b;
        for t in a[1..].split(';') {
            let (k, v) = t.split_once('=').unwrap_or((t, ""));
            tags.insert(k, v);
        }
    }
    let (prefix, rest) = rest.strip_prefix(':')?.split_once(' ')?;
    let (command, rest) = rest.split_once(' ')?;
    if command != "PRIVMSG" {
        return None;
    }
    let (channel, content) = rest.split_once(" :")?;
    let slug = channel.strip_prefix('#')?;
    let badges = tags
        .get("badges")
        .unwrap_or(&"")
        .split(',')
        .filter_map(|b| b.split_once('/'))
        .map(|(kind, _)| json!({"type":kind,"text":kind}))
        .collect::<Vec<_>>();
    Some((
        slug.into(),
        json!({"id":tags.get("id"),"content":content,"sender":{"username":tags.get("display-name").filter(|s|!s.is_empty()).copied().unwrap_or(prefix.split('!').next().unwrap_or("?")),"identity":{"color":tags.get("color"),"badges":badges}}}),
    ))
}
pub async fn receive(app: AppHandle, id: AccountId) {
    if app.state::<Runtime>().platform != Platform::Twitch {
        return;
    }
    loop {
        if app
            .state::<Runtime>()
            .stopping
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }
        let enabled = {
            let rt = app.state::<Runtime>();
            rt.account(&id, |a| a.used)
        };
        if !enabled {
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }
        if let Ok((mut ws, _)) = connect_async("wss://irc-ws.chat.twitch.tv:443").await {
            let _=ws.send(Message::Text("CAP REQ :twitch.tv/tags twitch.tv/commands\r\nPASS SCHMOOPIIE\r\nNICK justinfan61435\r\n".into())).await;
            let mut joined = std::collections::BTreeSet::<String>::new();
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                tokio::select! {
                    _=interval.tick()=>{let rt=app.state::<Runtime>();let active=rt.account(&id,|a|a.used);if !active||rt.stopping.load(std::sync::atomic::Ordering::SeqCst){break}let want=rt.account(&id,|a|a.channels.iter().cloned().collect::<std::collections::BTreeSet<_>>());for s in want.difference(&joined){let _=ws.send(Message::Text(format!("JOIN #{s}\r\n").into())).await;}for s in joined.difference(&want){let _=ws.send(Message::Text(format!("PART #{s}\r\n").into())).await;}joined=want;},
                    message=ws.next()=>{let Some(Ok(Message::Text(text)))=message else{break};for line in text.split("\r\n"){if let Some(ping)=line.strip_prefix("PING "){let _=ws.send(Message::Text(format!("PONG {ping}\r\n").into())).await;continue}if let Some((slug,data))=parse(line){if joined.contains(&slug){let _=app.emit_to("main","chat",json!({"accountId":id.0,"payload":{"slug":slug,"kind":"message","data":data}}));}}}}
                }
            }
            let _ = ws.close(None).await;
        }
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}
pub async fn send(
    app: &AppHandle,
    id: &AccountId,
    room: &str,
    content: &str,
    c: &Credentials,
) -> Result<(), String> {
    let rt = app.state::<Runtime>();
    let content = content.replace(['\r', '\n'], " ");
    if content.trim().is_empty() || content.encode_utf16().count() > 500 {
        return Err("Mensagem deve ter até 500 caracteres".into());
    }
    let identity = rt
        .account(id, |a| {
            if a.logged_in {
                a.identity.clone()
            } else {
                None
            }
        })
        .ok_or("Faça login antes de enviar")?;
    let slug = rt
        .account(id, |a| {
            a.channels
                .iter()
                .find(|s| {
                    if rt.platform == Platform::Twitch {
                        s.as_str() == room
                    } else {
                        a.status.get(*s).and_then(|c| c.chatroom.as_deref()) == Some(room)
                    }
                })
                .cloned()
        })
        .ok_or("Canal desconhecido")?;
    if rt.platform == Platform::Kick {
        platform::request(
            rt.platform,
            &format!("/api/v2/messages/send/{room}"),
            "POST",
            c,
            Some(json!({"content":content,"type":"message"})),
        )
        .await?;
        return Ok(());
    }
    let operation = async {
        let (mut ws, _) = connect_async("wss://irc-ws.chat.twitch.tv:443")
            .await
            .map_err(|_| "Chat indisponível")?;
        ws.send(Message::Text(
            format!(
                "PASS oauth:{}\r\nNICK {}\r\n",
                c.token,
                identity
                    .login
                    .as_deref()
                    .unwrap_or(&identity.username)
                    .to_lowercase()
            )
            .into(),
        ))
        .await
        .map_err(|_| "Chat indisponível")?;
        while let Some(m) = ws.next().await {
            let m = m.map_err(|_| "Chat interrompido")?;
            if let Message::Text(t) = m {
                if t.contains("Login authentication failed")
                    || t.contains("Improperly formatted auth")
                {
                    return Err("Login recusado pelo chat".into());
                }
                if t.starts_with("PING ") {
                    let _ = ws
                        .send(Message::Text(t.replace("PING ", "PONG ").into()))
                        .await;
                }
                if t.contains(" 001 ") {
                    ws.send(Message::Text(
                        format!("JOIN #{slug}\r\nPRIVMSG #{slug} :{content}\r\n").into(),
                    ))
                    .await
                    .map_err(|_| "Envio interrompido")?;
                    let _ = ws.close(None).await;
                    return Ok(());
                }
            }
        }
        Err("Chat encerrou antes do envio".into())
    };
    tokio::time::timeout(Duration::from_secs(15), operation)
        .await
        .map_err(|_| "Timeout no chat")?
}

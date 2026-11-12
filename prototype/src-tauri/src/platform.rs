use crate::model::{valid_slug, Channel, Identity, Platform, Reward};
use futures_util::StreamExt;
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
#[derive(Clone, Default)]
pub struct Credentials {
    pub token: String,
    pub device: String,
    pub xsrf: String,
    pub cookies: String,
    pub agent: String,
}
impl Credentials {
    pub fn fingerprint(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(format!("{}\0{}\0{}", self.token, self.device, self.xsrf))
        )
    }
}
pub fn valid_endpoint(p: Platform, path: &str, method: &str) -> bool {
    if p == Platform::Twitch {
        return path == "/gql" && method == "POST";
    }
    if ["/api/v1/user", "/api/v2/user"].contains(&path) {
        return method == "GET";
    }
    if let Some(s) = path.strip_prefix("/api/v2/channels/") {
        let mut parts = s.split('/');
        let slug = parts.next().unwrap_or("");
        let suffix = parts.next();
        return method == "GET"
            && valid_slug(slug, p)
            && matches!(suffix, None | Some("me") | Some("points"))
            && parts.next().is_none();
    }
    path.strip_prefix("/api/v2/messages/send/")
        .is_some_and(|n| {
            method == "POST"
                && (1..=20).contains(&n.len())
                && !n.starts_with('0')
                && n.bytes().all(|b| b.is_ascii_digit())
        })
}
pub async fn request(
    p: Platform,
    path: &str,
    method: &str,
    c: &Credentials,
    body: Option<Value>,
) -> Result<Value, String> {
    if !valid_endpoint(p, path, method) {
        return Err("Consulta inválida".into());
    }
    static CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> =
        std::sync::OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "Transporte indisponível".into())
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let url = if p == Platform::Twitch {
        "https://gql.twitch.tv/gql".into()
    } else {
        format!("https://kick.com{path}")
    };
    let mut r = client
        .request(
            if method == "POST" {
                reqwest::Method::POST
            } else {
                reqwest::Method::GET
            },
            url,
        )
        .header("Referer", format!("{}/", p.origin()));
    if !c.agent.is_empty() {
        r = r.header("User-Agent", &c.agent);
    }
    if p == Platform::Twitch {
        r = r
            .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
            .header("Content-Type", "text/plain;charset=UTF-8");
        if !c.token.is_empty() {
            r = r.header("Authorization", format!("OAuth {}", c.token));
        }
        if !c.device.is_empty() {
            r = r.header("X-Device-Id", &c.device);
        }
    } else {
        r = r
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .header("Origin", p.origin());
        if !c.token.is_empty() {
            r = r.bearer_auth(&c.token);
        }
        if !c.xsrf.is_empty() {
            r = r.header("X-XSRF-TOKEN", &c.xsrf);
        }
        if !c.cookies.is_empty() {
            r = r.header("Cookie", &c.cookies);
        }
    }
    if let Some(body) = body {
        r = r.body(body.to_string());
    }
    let response = r.send().await.map_err(|_| "Falha de rede ou timeout")?;
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} — consulte o login oficial",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > 2 * 1024 * 1024)
    {
        return Err("Resposta excede 2 MiB".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Leitura interrompida")?;
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Resposta excede 2 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Resposta JSON inválida".into())
}
pub fn parse_kick_identity(v: &Value) -> Option<Identity> {
    let u = v
        .get("user")
        .or_else(|| v.pointer("/data/user"))
        .or_else(|| v.get("data"))
        .unwrap_or(v);
    let id = match &u["id"] {
        Value::String(s) => s.clone(),
        Value::Number(n) if n.as_u64().is_some() => n.to_string(),
        _ => return None,
    };
    let name = u["username"].as_str()?.trim();
    if id.is_empty()
        || id.len() > 20
        || id.starts_with('0')
        || !id.bytes().all(|c| c.is_ascii_digit())
        || name.is_empty()
        || name.len() > 200
    {
        return None;
    }
    Some(Identity {
        id: format!("id:{id}"),
        username: name.into(),
        login: None,
    })
}
pub async fn identity(p: Platform, c: &Credentials) -> Result<Identity, String> {
    if c.token.is_empty() {
        return Err("Faça login pela página oficial".into());
    }
    if p == Platform::Twitch {
        let v = request(
            p,
            "/gql",
            "POST",
            c,
            Some(json!({"query":"query{currentUser{id login displayName}}"})),
        )
        .await?;
        let u = &v["data"]["currentUser"];
        let login = u["login"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or("Sessão não confirmada")?;
        let id = u["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| format!("id:{s}"))
            .unwrap_or_else(|| format!("login:{}", login.to_lowercase()));
        Ok(Identity {
            id,
            username: u["displayName"].as_str().unwrap_or(login).into(),
            login: Some(login.into()),
        })
    } else {
        let mut err = "Sessão não confirmada".into();
        for path in ["/api/v1/user", "/api/v2/user"] {
            match request(p, path, "GET", c, None).await {
                Ok(v) => {
                    if let Some(i) = parse_kick_identity(&v) {
                        return Ok(i);
                    }
                }
                Err(e) => err = e,
            }
        }
        Err(err)
    }
}
pub fn parse_twitch_channel(u: &Value, slug: &str) -> Channel {
    if u.is_null() {
        return Channel {
            error: Some("Canal não encontrado".into()),
            ..Default::default()
        };
    }
    let settings = &u["channel"]["communityPointsSettings"];
    let cp = &u["channel"]["self"]["communityPoints"];
    let hours = Regex::new(r"\((\d+)\s*h\)").unwrap();
    let mut rewards = vec![];
    for r in settings["customRewards"].as_array().into_iter().flatten() {
        let title = r["title"].as_str().unwrap_or("").to_lowercase();
        if !(title.contains("15%")
            || title.contains("15 %")
            || title.contains("pokeidle")
            || title.contains("bônus")
            || title.contains("bonus"))
        {
            continue;
        }
        let kind = if title.contains("capture") {
            "capture"
        } else if title.contains("lure") {
            "lure"
        } else if title.contains("xp") || title.contains("exp") {
            "xp"
        } else {
            continue;
        };
        rewards.push(Reward {
            id: r["id"].as_str().unwrap_or("").into(),
            kind: kind.into(),
            hours: hours
                .captures(&title)
                .and_then(|c| c[1].parse().ok())
                .unwrap_or(1),
            cost: r["cost"].as_u64().unwrap_or(0),
            available: r["isEnabled"] == true && r["isPaused"] != true && r["isInStock"] != false,
        });
    }
    let tier = u["self"]["subscriptionBenefit"]["tier"]
        .as_str()
        .unwrap_or("");
    Channel {
        display_name: u["displayName"].as_str().unwrap_or(slug).into(),
        avatar: u["profileImageURL"].as_str().map(String::from),
        live: !u["stream"].is_null(),
        viewers: u["stream"]["viewersCount"].as_u64().unwrap_or(0),
        title: u["stream"]["title"].as_str().unwrap_or("").into(),
        chatroom: Some(slug.into()),
        points: cp["balance"].as_u64(),
        claim: cp["availableClaim"]["id"].as_str().map(String::from),
        rewards,
        points_enabled: settings["isEnabled"] != false,
        following: Some(!u["self"]["follower"].is_null()),
        subscribed: !tier.is_empty(),
        multiplier: match tier {
            "1000" => 1.2,
            "2000" => 1.4,
            "3000" => 2.,
            _ => 1.,
        },
        ..Default::default()
    }
}
pub async fn channels(
    p: Platform,
    c: &Credentials,
    slugs: &[String],
) -> Result<Vec<(String, Channel)>, String> {
    let mut result = vec![];
    if p == Platform::Twitch {
        for part in slugs.chunks(10) {
            let fields="id login displayName profileImageURL(width:70) stream{id viewersCount title} self{follower{followedAt} subscriptionBenefit{tier}} channel{self{communityPoints{balance availableClaim{id}}} communityPointsSettings{isEnabled customRewards{id title cost isEnabled isPaused isInStock}}}";
            let query = format!(
                "query{{{}}}",
                part.iter()
                    .enumerate()
                    .map(|(i, s)| format!("c{i}:user(login:{}){{{fields}}}", json!(s)))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            let v = request(p, "/gql", "POST", c, Some(json!({"query":query}))).await?;
            if v["data"].is_null() {
                return Err("Consulta de canais recusada".into());
            }
            for (i, s) in part.iter().enumerate() {
                result.push((
                    s.clone(),
                    parse_twitch_channel(&v["data"][format!("c{i}")], s),
                ));
            }
        }
    } else {
        for s in slugs {
            let v = match request(p, &format!("/api/v2/channels/{s}"), "GET", c, None).await {
                Ok(v) => v,
                Err(e) => {
                    result.push((
                        s.clone(),
                        Channel {
                            error: Some(e),
                            ..Default::default()
                        },
                    ));
                    continue;
                }
            };
            let mut ch = Channel {
                display_name: v["user"]["username"].as_str().unwrap_or(s).into(),
                live: !v["livestream"].is_null(),
                viewers: v["livestream"]["viewer_count"].as_u64().unwrap_or(0),
                title: v["livestream"]["session_title"]
                    .as_str()
                    .unwrap_or("")
                    .into(),
                chatroom: v["chatroom"]["id"].as_u64().map(|v| v.to_string()),
                points_enabled: true,
                ..Default::default()
            };
            if let Ok(v) = request(p, &format!("/api/v2/channels/{s}/me"), "GET", c, None).await {
                ch.following = v["is_following"].as_bool();
                ch.subscribed = !v["subscription"].is_null() && v["subscription"] != false;
            }
            match request(p, &format!("/api/v2/channels/{s}/points"), "GET", c, None).await {
                Ok(v) => {
                    ch.points = v
                        .pointer("/data/points")
                        .or_else(|| v.get("points"))
                        .and_then(Value::as_u64);
                    if ch.points.is_none() {
                        ch.error = Some("Saldo indisponível".into());
                    }
                }
                Err(e) => ch.error = Some(e),
            }
            result.push((s.clone(), ch));
        }
    }
    Ok(result)
}
pub fn lowest_playlist(text: &str) -> Option<String> {
    lowest_playlist_for(Platform::Kick, text)
}
pub fn lowest_playlist_for(p: Platform, text: &str) -> Option<String> {
    let lines: Vec<_> = text.lines().collect();
    let mut head = vec![];
    let mut variants = vec![];
    let re = Regex::new(r"(?:^|,)BANDWIDTH=(\d+)").unwrap();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].starts_with("#EXT-X-STREAM-INF:") {
            if let Some(next) = lines.get(i + 1) {
                let b = re
                    .captures(lines[i].split_once(':').map(|(_, v)| v).unwrap_or(""))
                    .and_then(|c| c[1].parse::<u64>().ok())
                    .unwrap_or(u64::MAX);
                variants.push((b, lines[i], *next));
            }
            i += 2;
        } else {
            head.push(lines[i]);
            i += 1;
        }
    }
    if p == Platform::Twitch || variants.iter().any(|v| v.1.contains("RESOLUTION=")) {
        variants
            .retain(|v| v.1.contains("RESOLUTION=") && !v.1.to_lowercase().contains("audio_only"));
    }
    if variants.len() < 2 {
        return None;
    }
    variants.sort_by_key(|v| v.0);
    let (_, info, url) = variants[0];
    head.push(info);
    head.push(url);
    Some(head.join("\n") + "\n")
}
pub fn chest_confirmed(before: u64, after: u64, old: &str, new: Option<&str>) -> bool {
    after >= before.saturating_add(50) && new != Some(old)
}

pub fn confirmed_claim(
    v: &Value,
    expected: &str,
    before: u64,
    old: &str,
) -> Option<(u64, Option<String>)> {
    if let Some(errors) = v.get("errors") {
        if !errors.as_array().is_some_and(|e| e.is_empty()) {
            return None;
        }
    }
    let user = v.pointer("/data/currentUser")?;
    let id = user["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| format!("id:{s}"))
        .or_else(|| {
            user["login"]
                .as_str()
                .map(|s| format!("login:{}", s.to_lowercase()))
        })?;
    if id != expected {
        return None;
    }
    let cp = v
        .pointer("/data/channel/channel/self/communityPoints")?
        .as_object()?;
    let balance = cp.get("balance")?.as_u64()?;
    let claim = match cp.get("availableClaim")? {
        Value::Null => None,
        Value::Object(o) => Some(o.get("id")?.as_str().filter(|s| !s.is_empty())?.to_string()),
        _ => return None,
    };
    if chest_confirmed(before, balance, old, claim.as_deref()) {
        Some((balance, claim))
    } else {
        None
    }
}

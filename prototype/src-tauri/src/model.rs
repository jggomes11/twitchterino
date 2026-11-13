use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Twitch,
    Kick,
}
impl Platform {
    pub fn current() -> Self {
        if cfg!(feature = "kick") {
            Self::Kick
        } else {
            Self::Twitch
        }
    }
    pub fn origin(self) -> &'static str {
        match self {
            Self::Twitch => "https://www.twitch.tv",
            Self::Kick => "https://kick.com",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Twitch => "Twitchterino",
            Self::Kick => "Kickterino",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct AccountId(pub String);
impl AccountId {
    pub fn parse(s: &str) -> Result<Self, String> {
        if matches!(s, "account-1" | "account-2" | "account-3" | "account-4") {
            Ok(Self(s.into()))
        } else {
            Err("Conta inválida".into())
        }
    }
    pub fn index(&self) -> usize {
        self.0.as_bytes()[8] as usize - b'1' as usize
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Identity {
    pub id: String,
    pub username: String,
    pub login: Option<String>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    pub id: String,
    pub kind: String,
    pub hours: u64,
    pub cost: u64,
    pub available: bool,
}
#[derive(Clone, Default, Debug)]
pub struct Channel {
    pub display_name: String,
    pub avatar: Option<String>,
    pub live: bool,
    pub viewers: u64,
    pub title: String,
    pub chatroom: Option<String>,
    pub points: Option<u64>,
    pub gained: u64,
    pub subscribed: bool,
    pub multiplier: f64,
    pub following: Option<bool>,
    pub rewards: Vec<Reward>,
    pub points_enabled: bool,
    pub claim: Option<String>,
    pub error: Option<String>,
    pub watching_since: Option<u64>,
    pub watched_ms: u64,
    pub shown: bool,
    pub last_gain: Option<u64>,
    pub cooldown_until: u64,
    pub age_gate: bool,
    pub chest_error: Option<String>,
    pub inspection_failures: u8,
    pub video: Value,
    pub balance_revision: u64,
}
impl Channel {
    pub fn costs(&self) -> [u64; 3] {
        let mut c = [300, 500, 1000];
        for (i, k) in ["xp", "capture", "lure"].iter().enumerate() {
            if let Some(r) = self
                .rewards
                .iter()
                .filter(|r| r.available && r.kind == *k && r.hours > 0 && r.cost > 0)
                .min_by_key(|r| r.hours)
            {
                c[i] = (r.cost as f64 / r.hours as f64).round().max(1.) as u64;
            }
        }
        c
    }
    pub fn target_cost(&self, target: &Value) -> Option<u64> {
        let c = self.costs();
        let selected = if let Some(t) = target.as_str().filter(|s| !s.is_empty()) {
            let mut parts = t.split(':');
            let kind = parts.next().unwrap_or("");
            let hours = parts
                .next()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(1);
            ["xp", "capture", "lure"]
                .iter()
                .position(|k| *k == kind)
                .map(|i| {
                    self.rewards
                        .iter()
                        .find(|r| r.available && r.kind == kind && r.hours == hours)
                        .map(|r| r.cost)
                        .unwrap_or(c[i].saturating_mul(hours))
                })
        } else {
            target.as_u64().filter(|v| [300, 500, 1000].contains(v))
        };
        selected.filter(|v| *v > 0)
    }
    pub fn rank(&self, target: &Value) -> (usize, u64, u64) {
        let p = self.points.unwrap_or(0);
        let c = self.costs();
        let selected = self.target_cost(target);
        if let Some(cost) = selected.filter(|v| *v > 0) {
            let tier = p / cost;
            let goal = (tier + 1) * cost;
            return (tier as usize, goal, goal - p);
        }
        let mut costs = c.to_vec();
        costs.sort_unstable();
        costs.dedup();
        let top = *costs.last().unwrap();
        if p >= top {
            let n = p / top;
            let goal = (n + 1) * top;
            (costs.len() - 1 + n as usize, goal, goal - p)
        } else {
            let tier = costs.iter().filter(|v| p >= **v).count();
            let goal = costs[tier];
            (tier, goal, goal - p)
        }
    }
    pub fn earning(&self, now: u64) -> &'static str {
        match self.watching_since {
            None => "",
            Some(start) => {
                if self
                    .last_gain
                    .is_some_and(|t| now.saturating_sub(t) < 13 * 60_000)
                {
                    "earning"
                } else if now.saturating_sub(start) < 13 * 60_000 {
                    "warming"
                } else {
                    "idle"
                }
            }
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: AccountId,
    pub channels: Vec<String>,
    pub farming: bool,
    pub max_watchers: usize,
    pub low_quality: bool,
    pub rotation: bool,
    pub bonus_target: Value,
    pub favorites: Vec<String>,
    pub auto_chest: bool,
    pub used: bool,
    pub logout_pending: bool,
    #[serde(skip)]
    pub identity: Option<Identity>,
    #[serde(skip)]
    pub logged_in: bool,
    #[serde(skip)]
    pub session_checking: bool,
    #[serde(skip)]
    pub generation: u64,
    #[serde(skip)]
    pub status: BTreeMap<String, Channel>,
    #[serde(skip)]
    pub error: Option<String>,
    #[serde(skip)]
    pub today: u64,
    #[serde(skip)]
    pub chests: u64,
}
impl Default for Account {
    fn default() -> Self {
        Self::new(AccountId("account-1".into()))
    }
}
impl Account {
    pub fn new(id: AccountId) -> Self {
        Self {
            id,
            channels: vec![],
            farming: false,
            max_watchers: 2,
            low_quality: true,
            rotation: true,
            bonus_target: Value::Null,
            favorites: vec![],
            auto_chest: true,
            used: false,
            logout_pending: false,
            identity: None,
            logged_in: false,
            session_checking: false,
            generation: 0,
            status: BTreeMap::new(),
            error: None,
            today: 0,
            chests: 0,
        }
    }
    pub fn ticket(&self) -> u64 {
        self.generation
    }
    pub fn current(&self, t: u64) -> bool {
        self.generation == t
    }
    pub fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.logged_in = false;
        self.session_checking = true;
    }
    pub fn adopt_identity(&mut self, i: Identity) {
        if self.identity.as_ref().is_some_and(|old| old.id != i.id) {
            for c in self.status.values_mut() {
                c.points = None;
                c.gained = 0;
                c.last_gain = None;
                c.claim = None;
                c.following = None;
                c.subscribed = false;
                c.multiplier = 1.;
                c.watched_ms = 0;
                c.watching_since = None;
                c.shown = false;
                c.cooldown_until = 0;
                c.chest_error = None;
                c.balance_revision = 0;
                c.video = Value::Null;
            }
            self.today = 0;
            self.chests = 0;
        }
        self.identity = Some(i);
        self.logged_in = true;
        self.session_checking = false;
        self.error = None;
        self.used = true;
    }
    pub fn set_balance_observed(
        &mut self,
        slug: &str,
        points: u64,
        now: u64,
        revision: u64,
    ) -> bool {
        if self
            .status
            .get(slug)
            .is_some_and(|c| revision < c.balance_revision)
        {
            return false;
        }
        self.set_balance(slug, points, now);
        self.status.get_mut(slug).unwrap().balance_revision = revision;
        true
    }
    pub fn set_balance(&mut self, slug: &str, points: u64, now: u64) {
        let c = self.status.entry(slug.into()).or_default();
        if let Some(old) = c.points {
            if points > old {
                let delta = points - old;
                c.gained += delta;
                self.today += delta;
                if c.watching_since.is_some() {
                    c.last_gain = Some(now);
                }
            }
        }
        c.points = Some(points);
    }
    pub fn desired(&self, p: Platform, now: u64) -> Vec<String> {
        let mut chosen: Vec<String> = self
            .channels
            .iter()
            .filter(|s| self.status.get(*s).is_some_and(|c| c.shown))
            .cloned()
            .collect();
        if !self.logged_in {
            return vec![];
        }
        if !self.farming {
            return chosen;
        }
        let mut candidates: Vec<_> = self
            .channels
            .iter()
            .filter(|s| !chosen.contains(s))
            .filter(|s| {
                self.status.get(*s).is_some_and(|c| {
                    c.live && c.error.is_none() && (p != Platform::Twitch || c.points_enabled)
                })
            })
            .cloned()
            .collect();
        let key = |slug: &String| {
            let c = &self.status[slug];
            let cooling = c.cooldown_until > now;
            let (t, _, left) = c.rank(&self.bonus_target);
            (
                cooling,
                !(c.subscribed && !cooling),
                p == Platform::Twitch && !c.rewards.iter().any(|r| r.available),
                t,
                left,
            )
        };
        if self.rotation {
            candidates.sort_by_key(&key);
        }
        let mut current: Vec<_> = candidates
            .iter()
            .filter(|s| self.status[*s].watching_since.is_some())
            .cloned()
            .collect();
        current.sort_by_key(|s| std::cmp::Reverse(self.status[s].watching_since));
        let cap = self.max_watchers.clamp(1, 2).saturating_sub(chosen.len());
        current.truncate(cap);
        let mut waiting: Vec<_> = candidates
            .into_iter()
            .filter(|s| !current.contains(s))
            .collect();
        while current.len() < cap && !waiting.is_empty() {
            current.push(waiting.remove(0));
        }
        if self.rotation {
            current.sort_by_key(|s| std::cmp::Reverse(key(s)));
            for c in &mut current {
                let Some(candidate) = waiting.first() else {
                    break;
                };
                let a = &self.status[candidate];
                let b = &self.status[c];
                let (ta, _, la) = a.rank(&self.bonus_target);
                let (tb, _, lb) = b.rank(&self.bonus_target);
                let ba = p != Platform::Twitch || a.rewards.iter().any(|r| r.available);
                let bb = p != Platform::Twitch || b.rewards.iter().any(|r| r.available);
                let worth = a.cooldown_until <= now
                    && !b.subscribed
                    && (a.subscribed
                        || (ba != bb && ba)
                        || (ba == bb && (ta < tb || (ta == tb && la.saturating_add(50) < lb))));
                if worth {
                    *c = waiting.remove(0);
                }
            }
        }
        chosen.extend(current);
        chosen
    }
    pub fn bonus_options(&self) -> Vec<Value> {
        let mut out = vec![];
        for (kind, default) in [("xp", 300u64), ("capture", 500), ("lure", 1000)] {
            for hours in [1u64, 3, 5, 10] {
                let mut prices = BTreeMap::<u64, usize>::new();
                for ch in self.status.values() {
                    if let Some(r) = ch
                        .rewards
                        .iter()
                        .find(|r| r.available && r.kind == kind && r.hours == hours)
                    {
                        *prices.entry(r.cost).or_default() += 1;
                    }
                }
                let cost = prices
                    .iter()
                    .min_by_key(|(cost, count)| (std::cmp::Reverse(**count), **cost))
                    .map(|(cost, _)| *cost)
                    .unwrap_or(default * hours);
                out.push(json!({"value":format!("{kind}:{hours}"),"kind":kind,"hours":hours,"cost":cost,"channels":prices.values().sum::<usize>(),"varies":prices.len()>1}));
            }
        }
        out
    }
    pub fn snapshot(&self, p: Platform, now: u64) -> Value {
        let channels:Vec<_>=self.channels.iter().map(|s|{
            let c=self.status.get(s).cloned().unwrap_or_default();let known=self.logged_in && c.points.is_some();let(_,goal,left)=c.rank(&self.bonus_target);let costs=c.costs();let earning=c.earning(now);let target_cost=c.target_cost(&self.bonus_target);
            json!({"slug":s,"displayName":if c.display_name.is_empty(){s.clone()}else{c.display_name},"avatar":c.avatar,"live":c.live,"viewers":c.viewers,"title":c.title,"chatroomId":if p==Platform::Twitch {Some(s.clone())}else{c.chatroom},"points":if known{c.points}else{None},"watching":c.watching_since.is_some(),"ageGate":c.age_gate,"video":c.video,"earning":earning,"following":if known{c.following}else{None},"subscribed":known&&c.subscribed,"multiplier":if known&&c.multiplier>0.{c.multiplier}else{1.},"gained":if known{c.gained}else{0},"goal":if known{Some(goal)}else{None},"goalLeft":if known{Some(left)}else{None},"costs":{"xp":costs[0],"capture":costs[1],"lure":costs[2]},"targetCost":target_cost,"hasBonus":c.rewards.iter().any(|r|r.available),"rewardsLoaded":true,"rewards":c.rewards.iter().filter(|r|r.available).collect::<Vec<_>>(),"chest":self.logged_in&&c.claim.is_some(),"chestState":if self.auto_chest&&c.chest_error.is_some(){Some("retry")}else{None},"chestError":c.chest_error,"priceChange":null,"pointsEnabled":c.points_enabled,"watchedMin":if self.logged_in{(c.watched_ms+c.watching_since.map(|t|now.saturating_sub(t)).unwrap_or(0))/60000}else{0},"error":c.error})
        }).collect();
        json!({"accountId":self.id.0,"farming":self.farming,"watchAll":false,"maxWatchers":self.max_watchers,"lowQuality":self.low_quality,"rotation":self.rotation,"bonusTarget":if self.bonus_target.is_null(){if p==Platform::Twitch{json!("")}else{json!(0)}}else{self.bonus_target.clone()},"bonusOptions":if p==Platform::Twitch{self.bonus_options()}else{vec![]},"openAtLogin":false,"platform":"win32","notifyBonus":false,"notifyChat":false,"notifyChest":false,"autoChest":self.auto_chest,"favorites":self.favorites,"username":if self.logged_in{self.identity.as_ref().map(|i|i.username.clone())}else{None},"loggedIn":self.logged_in,"sessionChecking":self.session_checking,"version":"0.1.0-prototype","intro":null,"today":if self.logged_in{self.today}else{0},"chestsToday":if self.logged_in{self.chests}else{0},"bonuses":[],"purchases":[],"storeSequence":null,"channels":channels,"memoryMB":null,"prototype":true,"error":self.error})
    }
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn valid_slug(s: &str, p: Platform) -> bool {
    let max = if p == Platform::Twitch { 25 } else { 30 };
    (2..=max).contains(&s.len())
        && s.bytes().all(|c| {
            c.is_ascii_lowercase()
                || c.is_ascii_digit()
                || c == b'_'
                || (p == Platform::Kick && c == b'-')
        })
}

#[derive(Default)]
pub struct Selection {
    pub index: usize,
    pub generation: u64,
    pub revision: u64,
}
impl Selection {
    pub fn select(&mut self, index: usize, generation: u64, revision: u64) -> bool {
        if index > 3 || generation != self.generation || revision <= self.revision {
            return false;
        }
        self.index = index;
        self.revision = revision;
        true
    }
    pub fn new_document(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.revision = 0;
    }
}

pub fn smoke_directory(base: &std::path::Path, run_id: &str) -> Result<std::path::PathBuf, String> {
    if run_id.is_empty() || run_id.len() > 30 || !run_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Identificador do teste inválido".into());
    }
    Ok(base.join(format!("terino-smoke-{run_id}")))
}

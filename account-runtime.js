'use strict';
// Maintained single-account behavior; every invocation owns a separate closure and session.
const {
  app, BrowserWindow, dialog, session, Notification, powerSaveBlocker, net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { createHash } = require('node:crypto');
const { createPlatformClient } = require('./security/platform');
const { readCookie } = require('./security/requests');
const { selectReportAccount } = require('./security/accounts');
const { chestClickScript } = require('./security/chest');
const { createTimers } = require('./security/timers');
const { pathToFileURL } = require('node:url');
const UI_DOCUMENT = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;

function createAccountRuntime({ id, partition, dataDirectory, emit, onChanged, showMain, quitApp, isOpenAtLogin, setOpenAtLogin }) {
const updateTray = () => onChanged();
const commands = new Map();
const handleIpc = (channel, handler) => commands.set(channel, handler);
const PARTITION = partition;
const apiClient = createPlatformClient('twitch', () => session.fromPartition(PARTITION));
const timers=createTimers({setTimeout,clearTimeout,setInterval,clearInterval});
const later=timers.after;
const withTimeout=timers.withTimeout;
let sessionTransition = false;
let verifiedAccountGeneration = -1;
let verifiedTokenDigest = null;
let sessionChecking = false;
let cookieCheckPending = false;
const tokenDigest = token => token ? createHash('sha256').update(token).digest('hex') : null;
function assertSession(generation) {
  if (sessionTransition || apiClient.generation !== generation) throw new Error('Session changed');
}

function cancelAccountWindows() {
  storeSequence = null;
  const windows = [...storeWindows.values()];
  storeWindows.clear();
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  chestQueue.length = 0;
  lastClaimTry.clear();
  for (const win of chestWindows) if (!win.isDestroyed()) win.destroy();
}

function resetAccountRuntime() {
  cancelAccountWindows();
  for (const slug of [...watchers.keys()]) stopWatcher(slug);
  confirmedChestClaims.clear();
  status.clear();
}

function adoptVerifiedAccount(account) {
  if (selectReportAccount(config, account)) resetAccountRuntime();
  verifiedAccountGeneration = apiClient.generation;
  configDirty = true;
}
const TWITCH = 'https://www.twitch.tv';
const GQL = 'https://gql.twitch.tv/gql';
const POLL_MS = 60 * 1000;
const PLAYER_CHECK_MS = 30 * 1000;
const LOGIN_RE = /^[a-z0-9_]{2,25}$/;

const configPath = () => path.join(dataDirectory, 'config.json');
const DEFAULT_CONFIG = {
  // Canais oficiais do PokeIdle na Twitch (lista do jogo em 04/11/2026).
  channels: [
    'clovaobengala', 'dersin2k', 'mecmeno', 'guaxilol1', 'denissnidertv', 'faturetosl', 'patopapao', 'axtlol',
    'matta', 'rodil', 'biscoitao', 'cogu', 'tftoddy', 'luccatv', 'techzz', 'revolta', 'yetz',
  ],
  farming: true,
  watchAll: false,
  // Coleta com duas lives; a rotação distribui as vagas entre os canais.
  maxWatchers: 2,
  lowQuality: true,
  rotation: true,
  bonusTarget: '', // '' = automático; ou um pacote: 'xp:1', 'xp:3', 'capture:10', 'lure:5'…
  notifyBonus: true,
  autoChest: true,   // baú de bônus da Twitch: o app clica nele sozinho (pode desligar)
  notifyChest: true, // sem o automático: avisa e a pessoa clica
  notifyChat: true,
  sleepMode: false,
  favorites: [],
  purchases: [], // { t, kind, hours, slug, cost }
  daily: {},
};
const freshDefaults = () => JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let config = freshDefaults();
let firstRun = false;

function loadConfig() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  firstRun = !fs.existsSync(configPath());
  try { config = { ...freshDefaults(), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }; } catch {}
  const seen = new Set(config.seenDefaults || config.channels);
  for (const slug of DEFAULT_CONFIG.channels) {
    if (!seen.has(slug) && !config.channels.includes(slug)) config.channels.push(slug);
  }
  config.seenDefaults = [...new Set([...seen, ...DEFAULT_CONFIG.channels])];
  saveConfig();
}
function saveConfig() {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

let mainWin = null;
let apiWin = null;
let apiReady = null;
const watchers = new Map(); // slug -> BrowserWindow
const status = new Map();   // slug -> estado do canal

function send(channel, payload) { if(!disposed)emit(id, channel, payload); }
function notifyState() { if(!disposed)emit(id, 'status'); }

// Anúncios e rastreadores de terceiros: não fazem parte da live e só gastam memória/CPU.
const BLOCKED_HOSTS = [
  'googlesyndication.com', 'doubleclick.net', 'googletagmanager.com', 'google-analytics.com',
  'googleadservices.com', 'adservice.google.com', 'imasdk.googleapis.com', 'amazon-adsystem.com',
  'facebook.net', 'facebook.com/tr', 'quora.com', 'analytics.tiktok.com', 'criteo.com', 'criteo.net',
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'taboola.com', 'hotjar.com', 'clarity.ms', 'scorecardresearch.com',
];

const watcherIds = new Set();
const HIDDEN_SKIP = new Set(['image', 'font']);
function isHiddenWatcher(webContents) {
  if (!webContents || !watcherIds.has(webContents.id)) return false;
  const win = BrowserWindow.fromWebContents(webContents);
  return !!win && !userOpened.has(win);
}

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
let authRefreshTimer = null;
let sessionSetup=false;

function setupSession() {
  if(sessionSetup)return;
  sessionSetup=true;
  const ses = session.fromPartition(PARTITION);
  ses.setSpellCheckerEnabled(false);
  ses.setUserAgent(app.userAgentFallback);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    cb({ cancel: BLOCKED_HOSTS.some((h) => details.url.includes(h)) || (HIDDEN_SKIP.has(details.resourceType) && isHiddenWatcher(details.webContents)) });
  });
  // Cookie events describe storage operations, not whether an account signed out.
  // Check the cookie actually selected by our API before changing the displayed session.
  ses.cookies.on('changed', (_e, changedCookie) => {
    if (disposed || sessionTransition) return;
    if (changedCookie.name !== 'auth-token' || !['twitch.tv', 'www.twitch.tv'].includes(changedCookie.domain.replace(/^\./, ''))) return;
    timers.cancel(authRefreshTimer);
    authRefreshTimer = null;
    apiClient.invalidate();
    verifiedAccountGeneration = -1;
    loggedIn = false;
    sessionChecking = true;
    cookieCheckPending = true;
    if (ircSend) { const socket = ircSend; ircSend = null; try { socket.close(); } catch {} }
    const generation = apiClient.generation;
    authRefreshTimer = later(async () => {
      authRefreshTimer = null;
      try {
        const token = await authToken();
        if (disposed || sessionTransition || generation !== apiClient.generation) return;
        cookieCheckPending = false;
        if (!token) {
          verifiedTokenDigest = null;
          username = null;
          loggedIn = false;
          sessionChecking = false;
          resetAccountRuntime();
          notifyState();
          return;
        }
        if (verifiedTokenDigest && tokenDigest(token) === verifiedTokenDigest && username) {
          verifiedAccountGeneration = generation;
          loggedIn = true;
          sessionChecking = false;
        } else {
          cancelAccountWindows();
        }
        notifyState();
        if (loggedIn) reconcileWatchers();
        await poll();
      } catch {
        if (generation !== apiClient.generation || sessionTransition) return;
        cookieCheckPending = false;
        sessionChecking = false;
        loggedIn = false;
        cancelAccountWindows();
        reconcileWatchers();
        notifyState();
      }
    }, 100);
  });
}

// Deixa só a menor qualidade de vídeo (160p) na lista de qualidades da live — o mesmo que
// escolher 160p no player. Na lista da Twitch cada qualidade tem sua linha #EXT-X-MEDIA, que fica.
function lowestQualityOnly(playlist) {
  const lines = playlist.split('\n');
  const keep = [];
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) { variants.push([lines[i], lines[i + 1]]); i++; } else keep.push(lines[i]);
  }
  const video = variants.filter(([inf]) => /RESOLUTION=/.test(inf) && !/audio_only/i.test(inf));
  if (video.length < 2) return null;
  const bandwidth = (l) => Number((l.match(/BANDWIDTH=(\d+)/) || [0, Infinity])[1]);
  video.sort((a, b) => bandwidth(a[0]) - bandwidth(b[0]));
  return [...keep.filter((l) => l.trim()), ...video[0]].join('\n') + '\n';
}

// The native API uses the Session directly; a renderer is needed only for official login.
function releaseLoginWindow(win=apiWin) {
  if(!win)return;
  if(apiWin===win){apiWin=null;apiReady=null;}
  if(!win.isDestroyed())win.destroy();
}
function createApiWindow() {
  if(disposed || sessionTransition)throw new Error('Session changed');
  if(apiWin && !apiWin.isDestroyed())return apiWin;
  const win=new BrowserWindow({
    width:1000,height:780,show:false,title:'Twitch — login',autoHideMenuBar:true,
    icon:path.join(__dirname,'build','icon.png'),
    webPreferences:{partition:PARTITION,backgroundThrottling:false},
  });
  apiWin=win;apiReady=null;
  win.webContents.setAudioMuted(true);
  win.webContents.on('render-process-gone',()=>releaseLoginWindow(win));
  win.on('closed',()=>{
    if(apiWin===win){apiWin=null;apiReady=null;}
    if(!disposed && !sessionTransition)void poll();
  });
  return win;
}
function loadApi(url,win=apiWin) {
  if(disposed || sessionTransition || !win || win.isDestroyed())return Promise.reject(new Error('Session changed'));
  if(apiReady)return apiReady;
  let onClosed;
  const closed=new Promise((_,reject)=>{onClosed=()=>reject(new Error('Session changed'));win.once('closed',onClosed);});
  const task=withTimeout(Promise.race([Promise.resolve().then(()=>win.loadURL(url)),closed]),45000)
    .catch(()=>{if(!disposed && !sessionTransition && apiWin===win && !win.isDestroyed())throw new Error('Não foi possível abrir o login da Twitch. Tente novamente.');})
    .finally(()=>{win.removeListener('closed',onClosed);if(apiReady===task)apiReady=null;});
  apiReady=task;
  return task;
}

async function cookie(name) {
  return readCookie(session.fromPartition(PARTITION), TWITCH, name);
}
const authToken = () => cookie('auth-token');

// Authenticated queries stay in the main process, independent of the login document.
async function gql(query) {
  return apiClient.request('/gql', { method: 'POST', body: { query } });
}

// ---------- Recompensas do PokeIdle ----------
// Cada canal define o preço e há versões de 1 h, 3 h, 5 h e 10 h. O app lê a loja de cada canal
// em vez de usar preço fixo; sem recompensa ainda ("em breve"), vale o padrão do jogo.
const KINDS = [
  { kind: 'xp', name: '+15% XP', re: /\bXP\b/i, def: 300 },
  { kind: 'capture', name: '+15% Capture Boost', re: /capture/i, def: 500 },
  { kind: 'lure', name: '+15% Secret Lure', re: /secret\s*lure|\blure\b/i, def: 1000 },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]));
// Specific boosts must win over the generic XP word in "Capture XP Boost".
const REWARD_KINDS = [KIND.capture, KIND.lure, KIND.xp];

function parseRewards(list) {
  const out = [];
  for (const r of list || []) {
    const title = String(r.title || '');
    if (!/15\s*%|pokeidle|b[oô]nus|\b(?:capture\s+(?:xp\s+)?|xp\s+)boost\b/i.test(title)) continue;
    const k = REWARD_KINDS.find((x) => x.re.test(title));
    if (!k) continue;
    const hours = Number((title.match(/\((\d+)\s*h\)/i) || [0, 1])[1]) || 1;
    out.push({ id: r.id, kind: k.kind, hours, cost: r.cost, title, available: !!r.isEnabled && !r.isPaused && r.isInStock !== false });
  }
  return out;
}

// Preço de 1 h de cada bônus no canal (padrão do jogo se o canal não tiver a recompensa).
function costsOf(s) {
  const costs = {};
  for (const k of KINDS) {
    const r = (s.rewards || []).filter((x) => x.kind === k.kind && x.available).sort((a, b) => a.hours - b.hours)[0];
    costs[k.kind] = r ? Math.round(r.cost / r.hours) : k.def;
  }
  return costs;
}
const hasBonus = (s) => (s.rewards || []).some((r) => r.available);

const BONUS_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_PURCHASES_MS = 10 * DAY_MS;
let configDirty = false;

const liveNotifications = new Set();
function notify(title, body, onClick) {
  title = `${username || id} · ${title}`;
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') });
  liveNotifications.add(n);
  n.on('click', () => { liveNotifications.delete(n); if (onClick) onClick(); });
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

// Pacote escolhido em "Bônus": 'xp:3' = +15% XP de 3 h. Sem escolha, o app vai no automático.
const HOURS = [1, 3, 5, 10];
function parseTarget(t = config.bonusTarget) {
  const m = /^(xp|capture|lure)(?::(\d+))?$/.exec(String(t || ''));
  return m ? { kind: m[1], hours: Number(m[2] || 1) } : null;
}
// Preço do pacote escolhido neste canal: o da loja dele; se o canal não tiver esse pacote,
// as horas pelo preço de 1 h (é o que a pessoa pagaria comprando de 1 em 1).
function targetCost(s, target = parseTarget()) {
  if (!target) return null;
  const r = (s.rewards || []).find((x) => x.kind === target.kind && x.hours === target.hours && x.available);
  return r ? r.cost : costsOf(s)[target.kind] * target.hours;
}
// Pacotes que existem nas lojas dos canais da lista, com o preço mais comum de cada um.
function bonusOptions() {
  const out = [];
  for (const k of KINDS) for (const hours of HOURS) {
    const prices = {};
    let channels = 0;
    for (const st of status.values()) {
      const r = (st.rewards || []).find((x) => x.kind === k.kind && x.hours === hours && x.available);
      if (r) { channels++; prices[r.cost] = (prices[r.cost] || 0) + 1; }
    }
    const common = Object.entries(prices).sort((a, b) => b[1] - a[1])[0];
    out.push({ value: `${k.kind}:${hours}`, kind: k.kind, hours, cost: common ? Number(common[0]) : k.def * hours, channels, varies: Object.keys(prices).length > 1 });
  }
  return out;
}
const targetName = (target) => `${KIND[target.kind].name}${target.hours > 1 ? ` (${target.hours} h)` : ''}`;

// Avisa quando o saldo alcança um bônus do canal (o saldo ao abrir o app é a referência).
// Com um pacote escolhido, avisa só quando dá para comprar esse pacote.
function checkBonus(slug, s) {
  const target = parseTarget();
  if (target) {
    const cost = targetCost(s, target);
    const n = Math.floor((s.points || 0) / cost);
    if (s.targetTier != null && n > s.targetTier && config.notifyBonus && hasBonus(s)) {
      notify(`${s.displayName || slug}: ${s.points} pontos`, `Já dá para resgatar ${targetName(target)} (${cost} pts). Clique para abrir a loja.`, () => openStore(slug));
    }
    s.targetTier = n;
    s.bonusTier = null;
    return;
  }
  s.targetTier = null;
  const costs = costsOf(s);
  const reach = KINDS.filter((k) => s.points >= costs[k.kind]);
  const tier = reach.length;
  if (s.bonusTier != null && tier > s.bonusTier && config.notifyBonus && hasBonus(s)) {
    const k = reach.sort((a, b) => costs[b.kind] - costs[a.kind])[0];
    notify(`${s.displayName || slug}: ${s.points} pontos`, `Já dá para resgatar ${k.name} (${costs[k.kind]} pts). Clique para abrir a loja.`, () => openStore(slug));
  }
  s.bonusTier = tier;
}

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function addDaily(n) {
  const k = dayKey(Date.now());
  config.daily[k] = (config.daily[k] || 0) + n;
  configDirty = true;
}

function addPurchase(p) {
  const now = Date.now();
  config.purchases.push(p);
  config.purchases = config.purchases.filter((x) => now - x.t < KEEP_PURCHASES_MS);
  configDirty = true;
}

// Compra feita fora do app (celular, outro PC): a queda do saldo é explicada pela menor
// combinação de recompensas de bônus do canal (entre duas leituras o saldo sobe até ~60 pts).
function matchPurchase(drop, rewards) {
  const list = rewards.filter((r) => r.available).sort((a, b) => a.hours - b.hours);
  let best = null;
  let signature = null;
  let ambiguous = false;
  const walk = (start, picked, sum) => {
    if (sum >= drop && sum <= drop + 60) {
      const key = picked.map((r) => `${r.kind}:${r.hours}`).sort().join(',');
      if (!best || picked.length < best.length) {
        best = picked;
        signature = key;
        ambiguous = false;
      } else if (picked.length === best.length && key !== signature) ambiguous = true;
      return;
    }
    if (picked.length >= 4 || sum > drop + 60) return;
    for (let i = start; i < list.length; i++) walk(i, [...picked, list[i]], sum + list[i].cost);
  };
  walk(0, [], 0);
  // A balance alone cannot distinguish equally plausible bonus packages.
  return ambiguous ? [] : best || [];
}

function registerDrop(slug, s, drop) {
  const known = Math.min(drop, s.pendingSpent || 0);
  s.pendingSpent = (s.pendingSpent || 0) - known;
  drop -= known;
  if (drop < 100) return; // restos de arredondamento ou recompensas baratas que não são bônus
  const now = Date.now();
  matchPurchase(drop, s.rewards || []).forEach((r, i) => addPurchase({ t: now + i, kind: r.kind, hours: r.hours, cost: r.cost, slug }));
}

// Compra feita no app: a loja (ou a live aberta) manda o pedido de resgate para a Twitch, e o
// app lê o pedido e a resposta. Assim sabe exatamente qual bônus e quantas horas.
function watchRedemptions(slug, wc) {
  const dbg = wc.debugger;
  if (!dbg.isAttached()) { try { dbg.attach('1.3'); } catch { return; } }
  const pending = new Map();
  dbg.on('message', async (_e, method, p) => {
    if (sessionTransition || wc.isDestroyed()) return;
    const generation = apiClient.generation;
    if (method === 'Network.requestWillBeSent' && p.request.url.startsWith(GQL)) {
      if (verifiedAccountGeneration !== generation) return;
      let body = p.request.postData;
      if (!body && p.request.hasPostData) body = (await dbg.sendCommand('Network.getRequestPostData', { requestId: p.requestId }).catch(() => ({}))).postData;
      if (generation !== apiClient.generation || verifiedAccountGeneration !== generation || sessionTransition || wc.isDestroyed() || !body || !body.includes('RedeemCustomReward')) return;
      try {
        const ops = [].concat(JSON.parse(body));
        const op = ops.find((o) => o.operationName === 'RedeemCustomReward');
        const input = op && op.variables && op.variables.input;
        if (input) pending.set(p.requestId, { input, generation });
      } catch {}
    } else if (method === 'Network.loadingFinished' && pending.has(p.requestId)) {
      const operation = pending.get(p.requestId);
      const input = operation.input;
      pending.delete(p.requestId);
      const res = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId }).catch(() => null);
      if (!res || operation.generation !== apiClient.generation || verifiedAccountGeneration !== apiClient.generation || sessionTransition || wc.isDestroyed()) return;
      let ok = false;
      try {
        const r = [].concat(JSON.parse(res.base64Encoded ? Buffer.from(res.body, 'base64').toString() : res.body))
          .find((x) => x.data && 'redeemCustomReward' in x.data);
        ok = !!r && !!r.data.redeemCustomReward && !r.data.redeemCustomReward.error;
      } catch {}
      if (!ok) return;
      const s = status.get(slug) || {};
      s.pendingSpent = (s.pendingSpent || 0) + (Number(input.cost) || 0);
      // The reward ID is authoritative; request titles can be absent or stale.
      const reward = (s.rewards || []).find((r) => r.id && r.id === input.rewardID)
        || parseRewards([{ title: input.title, cost: input.cost, isEnabled: true }])[0];
      if (reward) addPurchase({ t: Date.now(), kind: reward.kind, hours: reward.hours, cost: reward.cost, slug });
      status.set(slug, s);
      if (configDirty) { configDirty = false; saveConfig(); }
      notifyState();
      updateTray();
    }
  });
  dbg.sendCommand('Network.enable').catch(() => {});
}

// Fim de cada bônus, somando as horas na ordem das compras.
function bonusIntervals(purchases = config.purchases) {
  const byKind = {};
  for (const p of [...purchases].sort((a, b) => a.t - b.t)) {
    const list = byKind[p.kind] || (byKind[p.kind] = []);
    const last = list[list.length - 1];
    const dur = (p.hours || 1) * BONUS_MS;
    if (last && last.end >= p.t) last.end += dur;
    else list.push({ start: p.t, end: p.t + dur });
  }
  return byKind;
}

function activeBonuses(now = Date.now()) {
  const byKind = bonusIntervals();
  return KINDS.map((k) => {
    const cur = (byKind[k.kind] || []).find((i) => i.start <= now && i.end > now);
    return { kind: k.kind, name: k.name, endsAt: cur ? cur.end : null };
  });
}

const warnedEnds = new Set();
function checkBonusEnding() {
  const now = Date.now();
  for (const b of activeBonuses(now)) {
    if (!b.endsAt || b.endsAt - now > 5 * 60 * 1000 || warnedEnds.has(`${b.kind}:${b.endsAt}`)) continue;
    warnedEnds.add(`${b.kind}:${b.endsAt}`);
    if (!config.notifyBonus) continue;
    const rich = config.channels.map((slug) => [slug, status.get(slug) || {}])
      .filter(([, s]) => hasBonus(s) && (s.points || 0) >= costsOf(s)[b.kind]).sort((x, y) => y[1].points - x[1].points)[0];
    notify(`Seu ${b.name} acaba em ${Math.max(1, Math.round((b.endsAt - now) / 60000))} min`,
      rich ? `${rich[1].displayName || rich[0]} tem ${rich[1].points} pts. Clique para abrir a loja.` : 'Nenhum canal tem pontos para renovar agora.',
      () => (rich ? openStore(rich[0]) : showMain()));
  }
}

// Relatório dos últimos 7 dias.
const PERIODS = [['Madrugada', 0, 6], ['Dia', 6, 18], ['Noite', 18, 24]];
function weeklyReport(now = Date.now()) {
  const from = now - 7 * DAY_MS;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const t = now - i * DAY_MS, k = dayKey(t);
    const bought = config.purchases.filter((p) => dayKey(p.t) === k);
    days.push({ day: k, weekday: new Date(t).toLocaleDateString('pt-BR', { weekday: 'short' }), gained: config.daily[k] || 0,
      bought: KINDS.map((b) => bought.filter((p) => p.kind === b.kind).reduce((h, p) => h + (p.hours || 1), 0)) });
  }
  const all = Object.values(bonusIntervals()).flat();
  const isOn = (t) => all.some((i) => i.start <= t && i.end > t);
  const per = PERIODS.map(([name]) => ({ name, on: 0, total: 0 }));
  let on = 0, total = 0;
  for (let t = Math.ceil(from / 60000) * 60000; t < now; t += 60000) {
    const h = new Date(t).getHours();
    const p = per[PERIODS.findIndex(([, a, b]) => h >= a && h < b)];
    const active = isOn(t);
    p.total++; total++;
    if (active) { p.on++; on++; }
  }
  const timeline = [];
  for (let i = 47; i >= 0; i--) timeline.push(isOn(now - i * 30 * 60000 - 15 * 60000));
  const recent = config.purchases.filter((p) => p.t >= from);
  return {
    days, timeline, timelineStart: now - DAY_MS,
    gained: days.reduce((t, d) => t + d.gained, 0),
    bought: KINDS.map((b) => ({ name: b.name, kind: b.kind, count: recent.filter((p) => p.kind === b.kind).reduce((h, p) => h + (p.hours || 1), 0) })),
    bonusHours: Math.round(on / 60),
    coverage: total ? Math.round((on / total) * 100) : 0,
    periods: per.map((p) => ({ name: p.name, pct: p.total ? Math.round((p.on / p.total) * 100) : 0 })),
    channels: new Set(recent.map((p) => p.slug).filter(Boolean)).size,
  };
}

// Lista de parceiros no site: parceiro novo entra para todos sem precisar de versão nova.
const PARTNERS_URL = 'https://viinnisantoos.github.io/twitchterino/parceiros.json';
async function syncPartners() {
  try {
    const res = await net.fetch(PARTNERS_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const list = ((await res.json()).channels || []).map((s) => String(s).toLowerCase()).filter((s) => LOGIN_RE.test(s)).slice(0, 60);
    const seen = new Set(config.seenDefaults || []);
    const fresh = list.filter((slug) => !seen.has(slug) && !config.channels.includes(slug));
    config.seenDefaults = [...new Set([...seen, ...list])];
    if (fresh.length) { config.channels.push(...fresh); syncChat(); poll(); }
    saveConfig();
  } catch {}
}

// ---------- Consulta dos canais ----------
const CHANNEL_FIELDS = `id login displayName profileImageURL(width: 70) stream{ id viewersCount title }
  self{ follower{ followedAt } subscriptionBenefit{ tier } }
  channel{ self{ communityPoints{ balance availableClaim{ id } } }
    communityPointsSettings{ isEnabled customRewards{ id title cost isEnabled isPaused isInStock } } }`;
const SUB_MULT = { 1000: 1.2, 2000: 1.4, 3000: 2 };
let username = null;
let chestNotifiedAt = 0;

async function refreshAll() {
  const generation = apiClient.generation;
  assertSession(generation);
  const slugs = config.channels.filter((s) => LOGIN_RE.test(s));
  const fresh = [];
  // A Twitch aceita no máximo 15 consultas por chamada: vai de 10 em 10.
  for (let i = 0; i < slugs.length; i += 10) {
    const part = slugs.slice(i, i + 10);
    const query = `query{ ${i === 0 ? 'currentUser{ id login displayName }' : ''} ${part.map((slug, j) => `c${j}: user(login: ${JSON.stringify(slug)}){ ${CHANNEL_FIELDS} }`).join(' ')} }`;
    let data = null, err = null;
    try {
      const { status: code, json } = await gql(query);
      if (code !== 200 || !json || !json.data) throw new Error(`HTTP ${code}`);
      data = json.data;
    } catch (e) { err = String(e.message || e); }
    assertSession(generation);
    if (data && i === 0) {
      const user = data.currentUser;
      if (user && user.login) {
        const id = String(user.id || '');
        adoptVerifiedAccount(/^[1-9][0-9]*$/.test(id) ? 'id:' + id : 'login:' + user.login.toLowerCase());
        username = user.displayName || user.login;
      } else {
        username = null;
        verifiedAccountGeneration = -1;
        verifiedTokenDigest = null;
      }
    }
    part.forEach((slug, j) => {
      const s = status.get(slug) || { watchedMs: 0 };
      const u = data && data[`c${j}`];
      if (err) { s.error = err; status.set(slug, s); return; }
      if (!u) { s.error = 'Canal não encontrado na Twitch'; s.live = false; status.set(slug, s); return; }
      const wasLive = s.live;
      s.live = !!u.stream;
      if (wasLive === false && s.live && config.favorites.includes(slug)) {
        notify(`★ ${u.displayName} entrou ao vivo`, u.stream.title || 'Clique para abrir o chat.', () => { showMain(); send('select', slug); });
      }
      s.displayName = u.displayName || slug;
      s.avatar = u.profileImageURL || null;
      s.viewers = u.stream ? u.stream.viewersCount : 0;
      s.title = u.stream ? u.stream.title : '';
      s.error = null;
      s.following = u.self ? !!u.self.follower : null;
      const tier = u.self && u.self.subscriptionBenefit && u.self.subscriptionBenefit.tier;
      s.subscribed = !!tier;
      s.multiplier = SUB_MULT[tier] || 1;
      const settings = (u.channel && u.channel.communityPointsSettings) || {};
      s.pointsEnabled = settings.isEnabled !== false;
      s.rewards = parseRewards(settings.customRewards);
      // Custo mudou desde a última leitura: avisa (a streamer pode ter mudado o preço).
      const costs = costsOf(s);
      if (s.costs && hasBonus(s)) {
        const changed = KINDS.filter((k) => s.costs[k.kind] !== costs[k.kind]);
        if (changed.length) s.priceChange = { at: Date.now(), text: changed.map((k) => `${KIND[k.kind].name}: ${s.costs[k.kind]} → ${costs[k.kind]}`).join(' · ') };
      }
      s.costs = costs;
      const cp = u.channel && u.channel.self && u.channel.self.communityPoints;
      const claim = cp && cp.availableClaim && cp.availableClaim.id;
      if (claim && claim !== s.claim) fresh.push(slug);
      s.claim = claim || null;
      const p = cp ? cp.balance : null;
      if (verifiedAccountGeneration !== generation) { s.points = null; s.bonusTier = null; s.targetTier = null; }
      updateChannelBalance(slug, s, p);
      status.set(slug, s);
    });
  }
  // Baú de bônus: com "Pegar baú sozinho" o app clica nele; sem isso, um aviso só para todos os
  // canais, no máximo a cada 15 min, e a pessoa abre e clica.
  if (!config.autoChest && fresh.length && config.notifyChest && Date.now() - chestNotifiedAt > 15 * 60 * 1000) {
    chestNotifiedAt = Date.now();
    const names = fresh.map((slug) => (status.get(slug) || {}).displayName || slug);
    notify(`🎁 Baú de bônus em ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`, 'Clique para abrir o chat e pegar os pontos extras.', () => openStore(fresh[0]));
  }
}

function updateChannelBalance(slug, s, points) {
  if (typeof points !== 'number' || !Number.isFinite(points)) return;
  if (s.points != null && points > s.points) {
    s.gainedTotal = (s.gainedTotal || 0) + points - s.points;
    if (watchers.has(slug)) s.lastGainAt = Date.now();
    addDaily(points - s.points);
  }
  if (s.points != null && points < s.points) registerDrop(slug, s, s.points - points);
  s.points = points;
  checkBonus(slug, s);
}

// Only the platform's bonus button is clicked; rewards are never selected.
// Account data is checked again through read-only API calls before recording success.
const chestQueue = [];
const chestWindows = new Set();
const confirmedChestClaims = new Set();
let chestBusy = null;
const lastClaimTry = new Map();
const CHEST_RETRY_MS = 90 * 1000;
const FIND_CHEST = slug => chestClickScript(`${TWITCH}/popout/${slug}/chat?popout=`);

function assertChestOwner(owner) {
  if (!config.autoChest || sessionTransition || !loggedIn || sessionChecking
    || verifiedAccountGeneration !== apiClient.generation || config.reportAccount !== owner.account
    || !owner.digest || verifiedTokenDigest !== owner.digest) throw new Error('Session changed');
}

async function waitForChestOwner(owner) {
  // Give the selected-cookie read the same bounded budget as an API request.
  // No account work is accepted while verification is pending.
  for (let elapsed = 0; elapsed < 20000 && sessionChecking && !sessionTransition; elapsed += 25) await timers.sleep(25);
  assertChestOwner(owner);
}

function queueAvailableChests() {
  if (!config.autoChest || !loggedIn || sessionChecking || sessionTransition || verifiedAccountGeneration !== apiClient.generation) return;
  for (const slug of config.channels) if ((status.get(slug) || {}).claim) queueChest(slug);
  void runChestQueue();
}

function queueChest(slug) {
  const claim = (status.get(slug) || {}).claim;
  if (!claim || confirmedChestClaims.has(claim) || chestBusy === slug || chestQueue.includes(slug)
    || Date.now() - (lastClaimTry.get(slug) || 0) < CHEST_RETRY_MS) return;
  chestQueue.push(slug);
  void runChestQueue();
}

async function runChestQueue() {
  if (chestBusy || !config.autoChest || sessionChecking || !loggedIn) return;
  const slug = chestQueue.shift();
  if (!slug) return;
  if (!config.channels.includes(slug) || !(status.get(slug) || {}).claim) { void runChestQueue(); return; }
  chestBusy = slug;
  notifyState();
  try { await claimChest(slug); } catch {}
  chestBusy = null;
  notifyState();
  void runChestQueue();
}

function chestLog(entry) {
  try {
    const file = path.join(dataDirectory, 'chest-log.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

async function confirmChestClaim(slug, claim, before, owner) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitForChestOwner(owner);
    let response;
    try { response = await gql(`query ChestClaimConfirmation{currentUser{id login} channel:user(login:${JSON.stringify(slug)}){channel{self{communityPoints{balance availableClaim{id}}}}}}`); }
    catch (error) {
      await waitForChestOwner(owner);
      if (error.message === 'Session changed' && attempt < 4) continue;
      throw error;
    }
    await waitForChestOwner(owner);
    const { status: code, json } = response;
    const user = json?.data?.currentUser;
    const id = String(user?.id || '');
    const account = /^[1-9][0-9]*$/.test(id) ? 'id:' + id : user?.login ? 'login:' + user.login.toLowerCase() : null;
    if (code !== 200 || !user || account !== owner.account || json.errors?.length) throw new Error('Confirmation failed');
    const points = json.data.channel?.channel?.self?.communityPoints;
    const noLongerAvailable = points && Object.prototype.hasOwnProperty.call(points, 'availableClaim')
      && (points.availableClaim === null || (typeof points.availableClaim?.id === 'string' && points.availableClaim.id !== claim));
    if (noLongerAvailable && typeof points.balance === 'number' && points.balance >= before + 50) return points.balance;
    if (attempt < 4) await timers.sleep(750);
  }
  throw new Error('Claim not confirmed');
}

async function claimChest(slug) {
  const owner = { account: config.reportAccount, digest: verifiedTokenDigest };
  assertChestOwner(owner);
  const initial = status.get(slug);
  const claim = initial?.claim;
  if (!claim || typeof initial.points !== 'number' || confirmedChestClaims.has(claim)) return false;
  const before = initial.points;
  lastClaimTry.set(slug, Date.now());
  initial.chestError = null;
  const started = Date.now();
  const win = new BrowserWindow({
    width: 400, height: 640, x: 0, y: 0, show: false, skipTaskbar: true, focusable: false, type: 'toolbar', opacity: 0,
    webPreferences: { partition: PARTITION, backgroundThrottling: false, spellcheck: false },
  });
  win.webContents.setAudioMuted(true);
  chestWindows.add(win);
  win.setIgnoreMouseEvents(true);
  if (!isLinux) win.showInactive();
  let result = { ok: false };
  try {
    await withTimeout(win.loadURL(`${TWITCH}/popout/${slug}/chat?popout=`), 45 * 1000);
    await waitForChestOwner(owner);
    const clicked = await withTimeout(win.webContents.executeJavaScript(FIND_CHEST(slug), true), 50 * 1000);
    await waitForChestOwner(owner);
    if (!clicked?.clicked) throw new Error(clicked?.reason === 'bonus-button-unavailable' ? 'Bonus unavailable' : 'Bonus button not found');
    await confirmChestClaim(slug, claim, before, owner);
    await waitForChestOwner(owner);
    const current = status.get(slug);
    if (!current) throw new Error('Session changed');
    if (current.claim === claim) current.claim = null;
    current.chestError = null;
    confirmedChestClaims.add(claim);
    if (confirmedChestClaims.size > 256) confirmedChestClaims.delete(confirmedChestClaims.values().next().value);
    config.chestsClaimed = (config.chestsClaimed || 0) + 1;
    config.chestDaily = config.chestDaily || {};
    const key = dayKey(Date.now());
    config.chestDaily[key] = (config.chestDaily[key] || 0) + 1;
    configDirty = false;
    saveConfig();
    send('toast', `🎁 Baú confirmado em ${current.displayName || slug}`);
    result = { ok: true };
    void poll();
  } catch (error) {
    const code = ['Session changed', 'Bonus unavailable', 'Bonus button not found', 'Claim not confirmed', 'Confirmation failed', 'timeout'].includes(error.message) ? error.message : 'Claim failed';
    result = { ok: false, error: code, sameAccount: config.reportAccount === owner.account, sameCachedToken: verifiedTokenDigest === owner.digest, accountVerified: loggedIn && verifiedAccountGeneration === apiClient.generation, sessionChecking };
    const current = status.get(slug);
    if (current && config.reportAccount === owner.account && current.claim === claim && config.autoChest) current.chestError = code;
  } finally {
    chestWindows.delete(win);
    if (!win.isDestroyed()) win.destroy();
  }
  chestLog({ slug, ms: Date.now() - started, ...result });
  return result.ok;
}

// ---------- Chat (IRC da Twitch, só leitura sem login; envio com a sua conta) ----------
let irc = null;
let ircSend = null;
const ircJoined = new Set();

function parseIrc(line) {
  let tags = {}, rest = line;
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const kv of rest.slice(1, sp).split(';')) { const i = kv.indexOf('='); tags[kv.slice(0, i)] = kv.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\'); }
    rest = rest.slice(sp + 1);
  }
  let prefix = '';
  if (rest.startsWith(':')) { const sp = rest.indexOf(' '); prefix = rest.slice(1, sp); rest = rest.slice(sp + 1); }
  const ti = rest.indexOf(' :');
  const trailing = ti >= 0 ? rest.slice(ti + 2) : '';
  const params = (ti >= 0 ? rest.slice(0, ti) : rest).split(' ');
  return { tags, prefix, command: params[0], params: params.slice(1), trailing };
}

// Emotes da Twitch chegam como posições no texto; viram "[emote:id:nome]" para a tela.
function withEmotes(text, emotesTag) {
  if (!emotesTag) return text;
  const chars = Array.from(text);
  const spots = [];
  for (const part of emotesTag.split('/')) {
    const [id, ranges] = part.split(':');
    for (const r of (ranges || '').split(',')) { const [a, b] = r.split('-').map(Number); if (b >= a) spots.push([a, b, id]); }
  }
  spots.sort((x, y) => x[0] - y[0]);
  let out = '', pos = 0;
  for (const [a, b, id] of spots) {
    if (a < pos) continue;
    out += chars.slice(pos, a).join('') + `[emote:${id}:${chars.slice(a, b + 1).join('')}]`;
    pos = b + 1;
  }
  return out + chars.slice(pos).join('');
}

const BADGES = { broadcaster: 'Streamer', moderator: 'Mod', vip: 'VIP', subscriber: 'Sub', founder: 'Fundador', staff: 'Staff' };
function handleIrc(raw) {
  if (!raw) return;
  if (raw.startsWith('PING')) { if (irc) irc.send(raw.replace('PING', 'PONG')); return; }
  const m = parseIrc(raw);
  if (m.command !== 'PRIVMSG') return;
  const slug = (m.params[0] || '').replace('#', '');
  let text = m.trailing;
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1];
  const badges = (m.tags.badges || '').split(',').map((b) => b.split('/')[0]).filter((b) => BADGES[b]).map((type) => ({ type, text: BADGES[type] }));
  send('chat', { slug, kind: 'message', data: {
    id: m.tags.id, content: withEmotes(text, m.tags.emotes),
    created_at: Number(m.tags['tmi-sent-ts']) || Date.now(),
    sender: { username: m.tags['display-name'] || m.prefix.split('!')[0], identity: { color: m.tags.color || null, badges } },
    reward: !!m.tags['custom-reward-id'],
  } });
}

function connectChat() {
  if (disposed || (irc && irc.readyState <= 1)) return;
  if (typeof WebSocket === 'undefined') return;
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  irc = ws;
  ws.onopen = () => {
    if(disposed || irc!==ws){try{ws.close();}catch{}return;}
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS SCHMOOPIIE');
    ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
    ircJoined.clear();
    syncChat();
  };
  ws.onmessage = (e) => {if(!disposed&&irc===ws)String(e.data).split('\r\n').forEach(handleIrc);};
  ws.onclose = () => { if (irc === ws) irc = null; later(connectChat, 10 * 1000); };
  ws.onerror = () => {};
}

function syncChat() {
  if (!irc || irc.readyState !== 1) return;
  const want = new Set(config.channels.filter((s) => LOGIN_RE.test(s)));
  for (const c of want) if (!ircJoined.has(c)) { irc.send(`JOIN #${c}`); ircJoined.add(c); }
  for (const c of [...ircJoined]) if (!want.has(c)) { irc.send(`PART #${c}`); ircJoined.delete(c); }
}

// Envio: uma conexão com a sua conta, aberta na primeira mensagem que você manda.
async function sendChat(slug, content) {
  const generation = apiClient.generation;
  if (sessionTransition) return { ok: false, message: 'Session changed' };
  const token = await authToken();
  if (sessionTransition || generation !== apiClient.generation) return { ok: false, message: 'Session changed' };
  if (!token || !username) return { ok: false, message: 'faça login na Twitch' };
  const login = String(username).toLowerCase();
  if (!ircSend || ircSend.readyState > 1 || ircSend.login !== login || ircSend.generation !== generation) {
    if (ircSend) { try { ircSend.close(); } catch {} }
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    ws.login = login;
    ws.generation = generation;
    ircSend = ws;
    ws.ready = withTimeout(new Promise((resolve, reject) => {
      ws.onopen = () => {
        if (generation !== apiClient.generation || sessionTransition || ircSend !== ws) { try { ws.close(); } catch {} reject(new Error('Session changed')); return; }
        ws.send(`PASS oauth:${token}`); ws.send(`NICK ${login}`);
      };
      ws.onmessage = (e) => {
        for (const line of String(e.data).split('\r\n')) {
          if (line.startsWith('PING')) ws.send(line.replace('PING', 'PONG'));
          if (/ 001 /.test(line)) resolve();
          if (/Login authentication failed|Improperly formatted auth/.test(line)) reject(new Error('login recusado pelo chat'));
        }
      };
      ws.onclose = () => reject(new Error('chat fechou'));
    }), 10 * 1000);
  }
  const socket = ircSend;
  try {
    await socket.ready;
    assertSession(generation);
    if (ircSend !== socket) throw new Error('Session changed');
    socket.send(`PRIVMSG #${slug} :${String(content).replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
    return { ok: true };
  } catch (e) {
    if (ircSend === socket) ircSend = null;
    try { socket.close(); } catch {}
    return { ok: false, message: e.message };
  }
}

// ---------- Lives ----------
// Na janela de cada live: força 160p enquanto ela está oculta.
function instrumentWatcher(slug, win) {
  const dbg = win.webContents.debugger;
  try { dbg.attach('1.3'); } catch { return; }
  dbg.on('message', async (_e, method, p) => {
    if (method !== 'Fetch.requestPaused') return;
    const pass = () => dbg.sendCommand('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    if (!config.lowQuality || win.isDestroyed() || userOpened.has(win)) return pass();
    try {
      const { body, base64Encoded } = await dbg.sendCommand('Fetch.getResponseBody', { requestId: p.requestId });
      const text = base64Encoded ? Buffer.from(body, 'base64').toString() : body;
      const low = text.includes('#EXT-X-STREAM-INF') ? lowestQualityOnly(text) : null;
      if (!low) return pass();
      await dbg.sendCommand('Fetch.fulfillRequest', {
        requestId: p.requestId, responseCode: p.responseStatusCode || 200,
        responseHeaders: p.responseHeaders, body: Buffer.from(low).toString('base64'),
      });
    } catch { pass(); }
  });
  dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*.m3u8*', requestStage: 'Response' }] }).catch(() => {});
  watchRedemptions(slug, win.webContents);
}

const userOpened = new WeakSet();
const isLinux = process.platform === 'linux';
// Janela "invisível": existe para o Windows (o vídeo anda de verdade), mas é transparente, não
// recebe cliques e não aparece na barra de tarefas nem no Alt+Tab.
function makeInvisible(win) {
  userOpened.delete(win);
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.setFocusable(false);
  win.setSize(480, 270);
  win.setPosition(0, 0);
  if (isLinux) win.hide();
  else win.showInactive();
}

function startWatcher(slug) {
  if (watchers.has(slug)) return;
  const win = new BrowserWindow({
    width: 480, height: 270, x: 0, y: 0, show: false, title: `Twitch — ${slug}`, autoHideMenuBar: true,
    type: 'toolbar', skipTaskbar: true, focusable: false, opacity: 0,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { partition: PARTITION, backgroundThrottling: false, spellcheck: false },
  });
  win.webContents.setAudioMuted(true);
  const wcId = win.webContents.id;
  watcherIds.add(wcId);
  win.on('closed', () => watcherIds.delete(wcId));
  instrumentWatcher(slug, win);
  win.loadURL(`${TWITCH}/${slug}`);
  makeInvisible(win);
  win.on('close', (e) => {
    if (app.isQuitting || watchers.get(slug) !== win) return;
    e.preventDefault();
    makeInvisible(win);
    win.webContents.setAudioMuted(true);
    win.webContents.reload();
  });
  win.on('closed', () => { if (watchers.get(slug) === win) watchers.delete(slug); });
  const drop = () => setImmediate(() => { if (watchers.get(slug) === win) stopWatcher(slug); });
  win.webContents.on('render-process-gone', drop);
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => { if (isMainFrame && code !== -3) drop(); });
  watchers.set(slug, win);
  const s = status.get(slug) || {};
  s.watchingSince = Date.now();
  status.set(slug, s);
}

function stopWatcher(slug) {
  const win = watchers.get(slug);
  if (!win) return;
  watchers.delete(slug);
  const s = status.get(slug);
  if (s && s.watchingSince) { s.watchedMs = (s.watchedMs || 0) + (Date.now() - s.watchingSince); s.watchingSince = null; }
  if (!win.isDestroyed()) win.destroy();
}

// Loja de pontos: o chat popout oficial da Twitch, com o saldo, as recompensas e o baú.
const storeWindows = new Map();
function openStore(slug, title = `Pontos — ${slug}`) {
  let win = storeWindows.get(slug);
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 420, height: 760, title, autoHideMenuBar: true, backgroundColor: '#0e0e10',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { partition: PARTITION },
  });
  watchRedemptions(slug, win.webContents);
  win.loadURL(`${TWITCH}/popout/${slug}/chat?popout=`);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => {
    if (storeWindows.get(slug) !== win) return;
    storeWindows.delete(slug);
    poll();
    if (storeSequence && storeSequence.current === slug) openNextStore();
  });
  storeWindows.set(slug, win);
}

let storeSequence = null;
function openNextStore() {
  const seq = storeSequence;
  const slug = seq && seq.queue.shift();
  if (!slug) { storeSequence = null; notifyState(); return; }
  seq.current = slug;
  seq.done++;
  const name = (status.get(slug) || {}).displayName || slug;
  openStore(slug, `Pontos — ${name} (${seq.done} de ${seq.total})`);
  notifyState();
}

// Confere cada live oculta: aviso de conteúdo adulto (só a pessoa pode confirmar) e estado do player.
async function checkPlayers() {
  const generation = apiClient.generation;
  for (const [slug, win] of watchers) {
    if (sessionTransition || generation !== apiClient.generation) return;
    const s = status.get(slug);
    if (!s || win.isDestroyed() || userOpened.has(win)) continue;
    const info = await withTimeout(win.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('video');
      return {
        gate: !!document.querySelector('[data-a-target="content-classification-gate-overlay-start-watching-button"], [data-a-target="player-overlay-mature-accept"]'),
        video: v ? { paused: v.paused, time: Math.round(v.currentTime), height: v.videoHeight, ready: v.readyState } : null,
      };
    })()`), PLAYER_CHECK_MS).catch((err) => {
      // Página lenta (PC fraco, Linux sem aceleração) não é página travada: só fecha depois de
      // 3 checagens seguidas sem resposta e nunca nos primeiros 3 min da live.
      if (sessionTransition || generation !== apiClient.generation || err.message !== 'timeout' || watchers.get(slug) !== win || status.get(slug) !== s) return null;
      s.playerTimeouts = (s.playerTimeouts || 0) + 1;
      if (s.playerTimeouts >= 3 && Date.now() - (s.watchingSince || 0) > 3 * 60 * 1000) { s.playerTimeouts = 0; stopWatcher(slug); }
      return null;
    });
    if (sessionTransition || generation !== apiClient.generation) return;
    if (!info || watchers.get(slug) !== win || status.get(slug) !== s) continue;
    s.playerTimeouts = 0;
    s.ageGate = info.gate;
    s.video = info.video;
  }
}

// "Ganhando": o saldo subiu nos últimos minutos enquanto a live tocava. A Twitch dá 10 pts a
// cada 5 min assistidos (a primeira contagem vem ~5 min depois que a live abre).
const EARN_WINDOW_MS = 13 * 60 * 1000;
function earningState(slug, now) {
  const s = status.get(slug) || {};
  if (!watchers.has(slug)) return null;
  if (s.lastGainAt && now - s.lastGainAt < EARN_WINDOW_MS) return 'earning';
  if (now - (s.watchingSince || now) < EARN_WINDOW_MS) return 'warming';
  return 'idle';
}

function logHistory() {
  const now = Date.now();
  const channels = {};
  for (const slug of config.channels) {
    const s = status.get(slug) || {};
    if (!s.live && s.points == null) continue;
    channels[slug] = {
      live: !!s.live, watching: watchers.has(slug), points: s.points ?? null, subscribed: !!s.subscribed,
      earning: earningState(slug, now), video: s.video || null, gate: !!s.ageGate, watchedMin: Math.floor(totalWatched(slug, now) / 60000),
    };
  }
  const line = JSON.stringify({ t: new Date(now).toISOString(), loggedIn, maxWatchers: config.maxWatchers, limitTest: limitTestSnapshot(), channels });
  const file = path.join(dataDirectory, 'points-log.jsonl');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, line + '\n');
  } catch {}
}

// Foco em bônus: as vagas vão para quem está mais perto do próximo bônus, com o preço de cada
// canal. Canal sem recompensa do PokeIdle ainda fica por último. Canal com sub vem primeiro.
const SWITCH_MARGIN = 50;
const IDLE_COOLDOWN_MS = 30 * 60 * 1000;

function goalRank(s) {
  const p = s.points || 0;
  const costs = costsOf(s);
  if (parseTarget()) {
    const target = targetCost(s);
    const tier = Math.floor(p / target);
    const goal = (tier + 1) * target;
    return { tier, goal, left: goal - p };
  }
  const list = [...new Set(Object.values(costs))].sort((a, b) => a - b);
  const top = list[list.length - 1];
  if (p >= top) {
    const m = Math.floor(p / top);
    return { tier: list.length - 1 + m, goal: (m + 1) * top, left: (m + 1) * top - p };
  }
  const tier = list.filter((c) => p >= c).length;
  return { tier, goal: list[tier], left: list[tier] - p };
}

const compareGoal = (a, b) => {
  const ra = goalRank(a), rb = goalRank(b);
  return !!b.sub - !!a.sub || !!a.cooling - !!b.cooling || !a.bonus - !b.bonus || ra.tier - rb.tier || ra.left - rb.left;
};

function worthSwitching(candidate, current) {
  if (current.sub) return false;
  if (candidate.sub) return true;
  if (candidate.cooling) return false;
  if (candidate.bonus !== current.bonus) return candidate.bonus;
  const c = goalRank(candidate), w = goalRank(current);
  return c.tier < w.tier || (c.tier === w.tier && c.left + SWITCH_MARGIN < w.left);
}

const totalWatched = (slug, now) => {
  const s = status.get(slug) || {};
  return (s.watchedMs || 0) + (s.watchingSince ? now - s.watchingSince : 0);
};
const turnTime = (slug, now) => now - ((status.get(slug) || {}).watchingSince || now);
const isShown = (slug) => { const w = watchers.get(slug); return !!w && !w.isDestroyed() && userOpened.has(w); };
const RECYCLE_MS = 6 * 60 * 60 * 1000;

function reconcileWatchers() {
  if (config.farming && sessionChecking && !process.env.TWITCHTERINO_ALLOW_ANON) return;
  const now = Date.now();
  const canFarm = config.farming && (loggedIn || process.env.TWITCHTERINO_ALLOW_ANON);
  for (const slug of [...watchers.keys()]) {
    const s = status.get(slug);
    if (isShown(slug)) continue;
    if (!canFarm || !config.channels.includes(slug) || (s && s.live === false)) stopWatcher(slug);
  }
  if (!canFarm) return;

  for (const slug of [...watchers.keys()]) {
    if (isShown(slug)) continue;
    const s = status.get(slug);
    const idle = !s?.subscribed && !config.watchAll && loggedIn && !limitTest && config.maxWatchers <= 2 && earningState(slug, now) === 'idle';
    if (idle && s) s.cooldownUntil = now + IDLE_COOLDOWN_MS;
    if (idle || turnTime(slug, now) >= RECYCLE_MS) stopWatcher(slug);
  }

  const rotatable = () => [...watchers.keys()].filter((slug) => !isShown(slug)).sort((a, b) => turnTime(b, now) - turnTime(a, now));
  while (!config.watchAll && watchers.size > config.maxWatchers && rotatable().length) stopWatcher(rotatable()[0]);

  const focusInfo = (slug) => {
    const s = status.get(slug) || {};
    const cooling = !s.subscribed && (s.cooldownUntil || 0) > now;
    return { points: s.points, rewards: s.rewards, cooling, sub: !!s.subscribed, bonus: hasBonus(s) };
  };
  const byGoal = (a, b) => compareGoal(focusInfo(a), focusInfo(b));
  const waiting = config.channels.filter((slug) => !watchers.has(slug) && (status.get(slug) || {}).live && (config.watchAll || (status.get(slug) || {}).subscribed || (status.get(slug) || {}).pointsEnabled !== false));
  if (config.watchAll) {
    for (const slug of waiting) startWatcher(slug);
    return;
  }
  waiting.sort((a,b) => Number(focusInfo(b).sub)-Number(focusInfo(a).sub) || (config.rotation ? byGoal(a,b) : 0));
  while (watchers.size < config.maxWatchers && waiting.length) startWatcher(waiting.shift());

  for (const slug of rotatable().sort((a, b) => byGoal(b, a))) {
    if (!config.rotation && (!waiting.length || !focusInfo(waiting[0]).sub)) break;
    if (!waiting.length || !worthSwitching(focusInfo(waiting[0]), focusInfo(slug))) break;
    stopWatcher(slug);
    startWatcher(waiting.shift());
  }
}

// Teste de várias lives: mede quantas lives a Twitch conta pontos ao mesmo tempo com a SUA conta.
// Cada live no ritmo cheio rende 10 pts a cada 5 min, então "lives contando" ≈ pts / (min × 2).
const LIMIT_LADDER = [2, 3, 4, 6, 8, 10];
const LIMIT_STEP_MS = (Number(process.env.TWITCHTERINO_LIMIT_STEP_MIN) || 20) * 60 * 1000;
const LIMIT_WARMUP_MS = (Number(process.env.TWITCHTERINO_LIMIT_WARMUP_MIN) || 7) * 60 * 1000;
const LIMIT_MAX = 10;
let limitTest = null;

const sumGained = () => [...status.values()].reduce((t, s) => t + (s.gainedTotal || 0), 0);
const liveCount = () => config.channels.filter((slug) => (status.get(slug) || {}).live).length;

function startLimitTest() {
  const all = Math.max(2, Math.min(LIMIT_MAX, liveCount()));
  limitTest = {
    i: 0, steps: [all, ...LIMIT_LADDER.filter((n) => n < all)],
    stepStart: Date.now(), baseline: null, results: [],
    prev: { maxWatchers: config.maxWatchers, rotation: config.rotation },
  };
  config.maxWatchers = all;
  config.rotation = false;
}

function stopLimitTest() {
  if (!limitTest) return;
  config.maxWatchers = limitTest.prev.maxWatchers;
  config.rotation = limitTest.prev.rotation;
  limitTest = null;
  saveConfig();
}

function advanceLimitTest() {
  if (!limitTest) return;
  const now = Date.now();
  const elapsed = now - limitTest.stepStart;
  if (limitTest.baseline == null && elapsed >= LIMIT_WARMUP_MS) { limitTest.baseline = sumGained(); limitTest.baselineAt = now; }
  if (elapsed < LIMIT_STEP_MS || limitTest.baseline == null) return;
  const minutes = (now - limitTest.baselineAt) / 60000;
  const pts = sumGained() - limitTest.baseline;
  const result = { lives: limitTest.steps[limitTest.i], playing: watchers.size, minutes: Math.round(minutes), pts, counting: Math.round((pts / (minutes * 2)) * 10) / 10 };
  limitTest.results.push(result);
  if (limitTest.i === 0) {
    const cap = result.counting >= result.playing * 0.85 ? 0 : Math.ceil(result.counting) + 2;
    limitTest.steps = [limitTest.steps[0], ...limitTest.steps.slice(1).filter((n) => n <= Math.max(cap, 3) && cap > 0)];
  }
  limitTest.i++;
  if (limitTest.i < limitTest.steps.length) {
    Object.assign(limitTest, { stepStart: now, baseline: null });
    config.maxWatchers = limitTest.steps[limitTest.i];
    return;
  }
  const best = Math.max(...limitTest.results.map((r) => r.pts));
  const chosen = [...limitTest.results].sort((a, b) => a.lives - b.lives).find((r) => r.pts >= best * 0.9) || limitTest.results[0];
  config.limitResult = { at: new Date(now).toISOString(), results: limitTest.results, chosen: chosen.lives };
  config.maxWatchers = chosen.lives;
  config.rotation = true;
  limitTest = null;
  saveConfig();
}

function limitTestSnapshot() {
  if (!limitTest) return null;
  const elapsed = Date.now() - limitTest.stepStart;
  return {
    step: limitTest.i + 1, steps: limitTest.steps.length, lives: limitTest.steps[limitTest.i],
    warming: limitTest.baseline == null, leftMin: Math.max(0, Math.ceil((LIMIT_STEP_MS - elapsed) / 60000)),
    totalLeftMin: Math.ceil(((limitTest.steps.length - limitTest.i) * LIMIT_STEP_MS - elapsed) / 60000),
    results: limitTest.results,
  };
}

function summary() {
  const confirmed=loggedIn && verifiedAccountGeneration===apiClient.generation;
  return {id,username:confirmed?username:null,loggedIn,sessionChecking,farming:config.farming,
    watching:watchers.size,today:confirmed?config.daily[dayKey(Date.now())]||0:0};
}
function snapshot() {
  const now = Date.now();
  const confirmedAccount = loggedIn && verifiedAccountGeneration === apiClient.generation;
  return {
    farming: config.farming, watchAll: !!config.watchAll, maxWatchers: config.maxWatchers, lowQuality: config.lowQuality, rotation: config.rotation,
    bonusTarget: config.bonusTarget, bonusOptions: bonusOptions(), limitTest: limitTestSnapshot(), limitResult: config.limitResult || null,
    openAtLogin: isOpenAtLogin(), platform: process.platform,
    notifyBonus: config.notifyBonus, notifyChest: config.notifyChest, autoChest: config.autoChest, chestsToday: (config.chestDaily || {})[dayKey(now)] || 0, notifyChat: config.notifyChat, sleepMode: config.sleepMode,
    favorites: config.favorites, username: confirmedAccount ? username : null, sessionChecking, version: app.getVersion(),
    intro: config.lastSeenVersion === app.getVersion() ? null : (firstRun ? 'welcome' : 'news'),
    bonuses: confirmedAccount ? activeBonuses(now) : [],
    today: confirmedAccount ? config.daily[dayKey(now)] || 0 : 0,
    purchases: confirmedAccount ? [...config.purchases].sort((a, b) => b.t - a.t).slice(0, 6) : [],
    storeSequence: storeSequence ? { done: storeSequence.done, total: storeSequence.total } : null,
    channels: config.channels.map((slug) => {
      const s = status.get(slug) || {};
      const known = confirmedAccount && s.points != null;
      const rank = known ? goalRank(s) : null;
      return {
        slug, displayName: s.displayName || slug, avatar: s.avatar || null, live: !!s.live, viewers: s.viewers || 0, title: s.title || '',
        chatroomId: s.displayName ? slug : null, points: confirmedAccount ? s.points ?? null : null,
        watching: watchers.has(slug), ageGate: !!s.ageGate, earning: earningState(slug, now),
        following: s.following ?? null, subscribed: !!s.subscribed, multiplier: s.multiplier || 1,
        gained: confirmedAccount ? s.gainedTotal || 0 : 0, goal: rank ? rank.goal : null, goalLeft: rank ? rank.left : null,
        costs: costsOf(s), targetCost: targetCost(s), hasBonus: hasBonus(s), rewardsLoaded: !!s.rewards, chest: !!s.claim, chestState: chestBusy === slug ? 'claiming' : chestQueue.includes(slug) ? 'queued' : config.autoChest && s.chestError && s.claim ? 'retry' : null, chestError: s.chestError || null,
        rewards: (s.rewards || []).filter((r) => r.available).map((r) => ({ kind: r.kind, hours: r.hours, cost: r.cost })),
        priceChange: s.priceChange && now - s.priceChange.at < DAY_MS ? s.priceChange.text : null,
        pointsEnabled: s.pointsEnabled !== false,
        watchedMin: Math.floor(totalWatched(slug, now) / 60000), error: s.error || null,
      };
    }),
    memoryMB: Math.round(app.getAppMetrics().reduce((t, m) => t + m.memory.workingSetSize, 0) / 1024),
    loggedIn,
  };
}

const POLL_STUCK_MS = 5 * 60 * 1000;
let polling = false;
let pollStartedAt = 0;
let pollingGeneration = -1;
let pollSequence = 0;
let loggedIn = false;
const step = (...a) => { if (process.env.TWITCHTERINO_DEBUG) console.log('STEP', new Date().toISOString().slice(11, 19), ...a); };
async function poll() {
  if (disposed || sessionTransition || cookieCheckPending) return;
  const generation = apiClient.generation;
  if (polling && pollingGeneration === generation && Date.now() - pollStartedAt < POLL_STUCK_MS) return;
  const startedAt = Date.now();
  const cycle = ++pollSequence;
  polling = true;
  pollingGeneration = generation;
  pollStartedAt = startedAt;
  try {
    const token = await authToken();
    assertSession(generation);
    if (token && verifiedAccountGeneration !== generation) sessionChecking = true;
    step('consulta');
    await refreshAll();
    assertSession(generation);
    step('consulta ok', [...status.values()].filter((s) => s.live).length, 'ao vivo');
    loggedIn = !!token && verifiedAccountGeneration === generation;
    sessionChecking = false;
    if (loggedIn) {verifiedTokenDigest = tokenDigest(token);releaseLoginWindow();}
    if (!token) { username = null; verifiedTokenDigest = null; }
    queueAvailableChests();
    if (configDirty) { configDirty = false; saveConfig(); }
    advanceLimitTest();
    reconcileWatchers();
    step('lives', watchers.size);
    await checkPlayers();
    assertSession(generation);
    step('players ok');
    logHistory();
    notifyState();
    updateTray();
    if (process.env.TWITCHTERINO_DEBUG) {
      console.log(JSON.stringify(snapshot()));
      for (const [slug, win] of watchers) {
        const h = await win.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); return v ? v.videoHeight + 'p t=' + Math.round(v.currentTime) + ' paused=' + v.paused : 'sem video'; })()`).catch(() => '?');
        console.log(`VIDEO ${slug} ${h}`);
      }
    }
  } catch (e) {
    if (process.env.TWITCHTERINO_DEBUG) console.log("POLL ERROR", e && e.stack);
    // Twitch ou internet fora do ar: a próxima rodada tenta de novo.
    if (generation === apiClient.generation && !cookieCheckPending && verifiedAccountGeneration !== generation) {
      sessionChecking = false;
      loggedIn = false;
      notifyState();
    }
  } finally { if (pollSequence === cycle) polling = false; }
}

// ---------- Modo 24/7 ----------
let awakeBlocker = null;
function syncKeepAwake() {
  if (config.farming && awakeBlocker == null) awakeBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!config.farming && awakeBlocker != null) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
}

function setFarming(on) {
  config.farming = !!on;
  saveConfig();
  syncKeepAwake();
  reconcileWatchers();
  updateTray();
  notifyState();
}

function recoverAfterResume() {
  if(disposed)return;
  for (const slug of [...watchers.keys()]) if (!isShown(slug)) stopWatcher(slug);
  later(poll, 15 * 1000);
}

handleIpc('state:get', () => snapshot());
handleIpc('channels:add', async (_e, slug) => {
  slug = String(slug || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '');
  if (LOGIN_RE.test(slug) && !config.channels.includes(slug)) { config.channels.push(slug); saveConfig(); syncChat(); poll(); }
  return snapshot();
});
handleIpc('channels:remove', (_e, slug) => {
  config.channels = config.channels.filter((c) => c !== slug);
  stopWatcher(slug); status.delete(slug); saveConfig(); syncChat();
  return snapshot();
});
handleIpc('farming:set', (_e, on) => { setFarming(on); return snapshot(); });
handleIpc('watchAll:set', (_e, on) => { stopLimitTest(); config.watchAll = on; saveConfig(); reconcileWatchers(); return snapshot(); });
handleIpc('autostart:set', (_e, on) => { try { setOpenAtLogin(!!on); } catch {} return snapshot(); });
handleIpc('app:quit', quitApp);
handleIpc('notifyBonus:set', (_e, on) => { config.notifyBonus = !!on; saveConfig(); return snapshot(); });
handleIpc('notifyChest:set', (_e, on) => { config.notifyChest = !!on; saveConfig(); return snapshot(); });
handleIpc('autoChest:set', (_e, on) => {
  config.autoChest = on; saveConfig();
  if (on) { queueAvailableChests(); void poll(); }
  else { chestQueue.length = 0; for (const win of chestWindows) if (!win.isDestroyed()) win.destroy(); }
  return snapshot();
});
handleIpc('notifyChat:set', (_e, on) => { config.notifyChat = !!on; saveConfig(); return snapshot(); });
handleIpc('sleepMode:set', (_e, on) => { config.sleepMode = !!on; saveConfig(); return snapshot(); });
handleIpc('favorite:toggle', (_e, slug) => {
  if (!config.channels.includes(slug)) return snapshot();
  config.favorites = config.favorites.includes(slug) ? config.favorites.filter((s) => s !== slug) : [...config.favorites, slug];
  saveConfig();
  return snapshot();
});
handleIpc('purchase:add', (_e, kind) => {
  if (KIND[kind]) { addPurchase({ t: Date.now(), kind, hours: 1, slug: null }); saveConfig(); configDirty = false; }
  updateTray();
  return snapshot();
});
handleIpc('purchase:remove', (_e, t) => { config.purchases = config.purchases.filter((p) => p.t !== t); saveConfig(); updateTray(); return snapshot(); });
handleIpc('stores:sequence', (_e, slugs) => {
  const queue = (Array.isArray(slugs) ? slugs : []).filter((s) => config.channels.includes(s));
  if (!queue.length) return snapshot();
  storeSequence = { queue, total: queue.length, done: 0, current: null };
  openNextStore();
  return snapshot();
});
handleIpc('stores:cancel', () => { if (storeSequence) storeSequence.queue = []; return snapshot(); });
handleIpc('report:get', () => weeklyReport());
handleIpc('report:save', async (_e, rect) => {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  const image = await mainWin.webContents.capturePage(r);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Salvar resumo da semana',
    defaultPath: path.join(app.getPath('pictures'), `twitchterino-semana-${dayKey(Date.now())}.png`),
    filters: [{ name: 'Imagem PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, image.toPNG());
  return filePath;
});
handleIpc('intro:done', () => { config.lastSeenVersion = app.getVersion(); firstRun = false; saveConfig(); return snapshot(); });
handleIpc('maxWatchers:set', (_e, n) => {
  limitTest = null;
  config.maxWatchers = Math.max(1, Math.min(LIMIT_MAX, Number(n) || 1)); saveConfig(); reconcileWatchers(); return snapshot();
});
handleIpc('rotation:set', (_e, on) => { limitTest = null; config.rotation = !!on; saveConfig(); reconcileWatchers(); return snapshot(); });
handleIpc('bonusTarget:set', (_e, value) => {
  const t = parseTarget(value);
  config.bonusTarget = t && HOURS.includes(t.hours) ? `${t.kind}:${t.hours}` : '';
  for (const st of status.values()) { st.targetTier = null; st.bonusTier = null; } // a referência dos avisos recomeça
  saveConfig();
  reconcileWatchers();
  return snapshot();
});
handleIpc('limitTest:start', () => {
  if (!loggedIn || config.watchAll) return snapshot();
  startLimitTest(); reconcileWatchers(); return snapshot();
});
handleIpc('limitTest:stop', () => { stopLimitTest(); reconcileWatchers(); return snapshot(); });
handleIpc('lowQuality:set', (_e, on) => {
  config.lowQuality = !!on; saveConfig();
  for (const win of watchers.values()) if (!win.isDestroyed() && !userOpened.has(win)) win.webContents.reload();
  return snapshot();
});
handleIpc('refresh', async () => { await poll(); return snapshot(); });
handleIpc('login:show', async () => {
  const win=createApiWindow();
  win.show();win.focus();
  await loadApi(`${TWITCH}/login`,win);
});
handleIpc('logout', async () => {
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'question', buttons: ['Sair da conta', 'Cancelar'], defaultId: 1, cancelId: 1,
    title: 'Sair da conta', message: `Sair de ${username || id} neste perfil?`,
    detail: 'Os dados de login salvos no app serão apagados. Para juntar pontos de novo, será preciso entrar outra vez.',
  });
  if (response !== 0) return snapshot();
  sessionTransition = true;
  timers.cancel(authRefreshTimer);
  authRefreshTimer = null;
  verifiedTokenDigest = null;
  sessionChecking = false;
  cookieCheckPending = false;
  apiClient.suspend();
  try {
    releaseLoginWindow();
    resetAccountRuntime();
    verifiedAccountGeneration = -1;
    if (ircSend) { try { ircSend.close(); } catch {} ircSend = null; }
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    ses.flushStorageData();
    status.clear();
    username = null;
    loggedIn = false;
  } finally {
    sessionTransition = false;
    apiClient.resume();
  }
  later(poll, 0);
  return snapshot();
});
handleIpc('store:open', (_e, slug) => openStore(slug));
handleIpc('channel:show', (_e, slug) => {
  let win = watchers.get(slug);
  if (!win) { startWatcher(slug); win = watchers.get(slug); }
  userOpened.add(win);
  win.webContents.setAudioMuted(false);
  win.setOpacity(1);
  win.setIgnoreMouseEvents(false);
  win.setFocusable(true);
  win.setSize(960, 600); win.center();
  win.show(); win.focus();
  const s = status.get(slug);
  if (s) s.ageGate = false;
  notifyState();
});
handleIpc('chat:send', (_e, { chatroomId, content }) => sendChat(chatroomId, content));


let started = false;
let disposed = false;
function start(mainWindow) {
  if (started) return;
  started = true;
  mainWin = mainWindow;
  loadConfig();
  setupSession();
  syncKeepAwake();
  connectChat();
  void poll();
  timers.every(poll, POLL_MS);
  timers.every(() => { checkBonusEnding(); updateTray(); }, 30 * 1000);
  later(syncPartners, 30 * 1000);
  timers.every(syncPartners, 6 * 60 * 60 * 1000);
}
function stop() {
  disposed = true;
  sessionTransition = true;
  timers.cancel(authRefreshTimer);
  timers.stop();
  apiClient.suspend();
  resetAccountRuntime();
  if (irc) { try { irc.close(); } catch {} }
  if (ircSend) { try { ircSend.close(); } catch {} }
  releaseLoginWindow();
  if (awakeBlocker != null) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
}
const runtime = {
  id, partition, start, stop, poll, snapshot, summary, recoverAfterResume,
  getIpcContext: () => ({ channels: config.channels, chatroomIds: [], viewport: mainWin?.getContentSize() || [1380, 840] }),
  invoke(command, event, args) {
    const handler = commands.get(command);
    if (!handler) throw new Error('Unknown account command');
    return handler(event, ...args);
  },
};
return runtime;
}
module.exports = { createAccountRuntime };

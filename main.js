'use strict';
// One application shell; account tokens, players and reports live in scoped runtimes.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createAccountRuntime } = require('./account-runtime');
const { createAccountManager, ACCOUNT_IDS } = require('./account-manager');
const { createIpcRegistrar } = require('./security/ipc');
const UI_DOCUMENT = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
// Mantém vídeos rodando mesmo com janelas ocultas/minimizadas.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,BackgroundVideoTrackOptimization,IntensiveWakeUpThrottling');
app.commandLine.appendSwitch('js-flags', '--max-semi-space-size=1');

// Pasta de dados alternativa (testes sem mexer na instalação de verdade).
const dataArgument = process.argv.find(argument => argument.startsWith('--twitchterino-data='));
const customDataPath = dataArgument?.slice('--twitchterino-data='.length) || process.env.TWITCHTERINO_DATA;
if (customDataPath) app.setPath('userData', customDataPath);

// A Twitch recusa login de navegadores que ela não conhece: o app se apresenta como o Chrome que ele é.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|twitchterino|Twitchterino)\/\S+/g, '');


let mainWin = null;
let tray = null;
const isLinux = process.platform === 'linux';
const loginProfilePath = process.platform === 'win32' && customDataPath ? path.resolve(app.getPath('userData')) : null;
const LOGIN_ITEM = {
  path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  args: ['--hidden', ...(loginProfilePath ? ['--twitchterino-data=' + loginProfilePath] : [])],
  ...(loginProfilePath ? { name: 'Twitchterino-' + createHash('sha256').update(loginProfilePath.toLowerCase()).digest('hex').slice(0, 16) } : {}),
};
const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart', 'twitchterino.desktop');
function isOpenAtLogin() {
  if (isLinux) return fs.existsSync(autostartFile());
  const settings = app.getLoginItemSettings(LOGIN_ITEM);
  // Electron's legacy openAtLogin checks only the default AppUserModelID entry.
  if (LOGIN_ITEM.name) return Array.isArray(settings.launchItems) && settings.launchItems.some(item =>
    item.name === LOGIN_ITEM.name && item.scope === 'user' && item.enabled === true);
  return settings.openAtLogin;
}
function setOpenAtLogin(on) {
  if (!isLinux) return app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: on });
  const file = autostartFile();
  if (!on) return fs.rmSync(file, { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const exe = process.env.APPIMAGE || process.execPath;
  fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Twitchterino\nExec="${exe}" --hidden\nIcon=twitchterino\nX-GNOME-Autostart-enabled=true\n`);
}


function showMain(accountId) {
  if (accountId) manager.select(accountId);
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
  broadcast();
}
function quitApp() { app.isQuitting = true; app.quit(); }
function broadcast() {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('status', manager.snapshot());
}
function updateTray() {
  if (!tray) return;
  const accounts = manager.snapshot().accounts;
  const watching = accounts.reduce((total, account) => total + account.watching, 0);
  tray.setToolTip(`Twitchterino — ${accounts.filter(a => a.loggedIn).length}/4 contas · ${watching} lives`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Twitchterino', click: () => showMain() },
    ...accounts.map(a => ({ label: a.username || a.label, click: () => showMain(a.id) })),
    { type: 'separator' }, { label: 'Sair', click: quitApp },
  ]));
}
function emit(accountId, channel, payload) {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (channel === 'status') { broadcast(); return; }
  if (manager.acceptEvent(accountId)) mainWin.webContents.send(channel, { accountId, payload });
}
const runtimes = ACCOUNT_IDS.map((id, index) => createAccountRuntime({
  id, partition: index === 0 ? 'persist:twitch' : `persist:twitch-account-${index + 1}`,
  dataDirectory: index === 0 ? app.getPath('userData') : path.join(app.getPath('userData'), 'accounts', id),
  emit, onChanged: updateTray, showMain: () => showMain(id), quitApp, isOpenAtLogin, setOpenAtLogin,
}));
const manager = createAccountManager({ runtimes });

const TRUSTED_DOMAINS = ['twitch.tv', 'apple.com', 'facebook.com', 'amazon.com', 'google.com', 'accounts.youtube.com'];
function isTrustedUrl(url) {
  if (url === 'about:blank') return true;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && TRUSTED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}
app.on('web-contents-created', (_event, wc) => {
  wc.setWindowOpenHandler(({ url }) => wc !== mainWin?.webContents && isTrustedUrl(url) ? {
    action: 'allow',
    overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true,
      webPreferences: { session: wc.session, sandbox: true, contextIsolation: true, nodeIntegration: false } },
  } : { action: 'deny' });
  const guard = details => {
    if (wc === mainWin?.webContents ? (!details.isMainFrame || details.url !== UI_DOCUMENT)
      : (details.isMainFrame && !isTrustedUrl(details.url))) details.preventDefault();
  };
  wc.on('will-frame-navigate', guard); wc.on('will-navigate', guard); wc.on('will-redirect', guard);
});
const handleIpc = createIpcRegistrar({ ipcMain, getMainWindow: () => mainWin,
  uiDocument: UI_DOCUMENT, platform: 'twitch', getContext: () => ({ accounts: manager.contexts() }),
});
handleIpc('state:get', () => manager.snapshot());
handleIpc('account:select', (_e, id) => { const state = manager.select(id); updateTray(); broadcast(); return state; });
handleIpc('account:command', (event, {accountId, command, args}) => manager.invoke(accountId, command, args, event));
handleIpc('autostart:set', (_e, on) => { setOpenAtLogin(on); broadcast(); return manager.snapshot(); });
handleIpc('app:quit', quitApp);

const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) { app.isQuitting = true; app.quit(); }
else {
  app.on('second-instance', () => showMain());
  app.setAppUserModelId('com.vinniisaantos.twitchterino');
  app.whenReady().then(() => {
    mainWin = new BrowserWindow({
      width: 1380, height: 900, minWidth: 820, minHeight: 620, backgroundColor: '#0b0716', title: 'Twitchterino',
      show: !process.argv.includes('--hidden'), icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true,
        nodeIntegration: false, additionalArguments: ['--app-ui-url=' + UI_DOCUMENT] },
    });
    mainWin.setMenuBarVisibility(false);
    mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWin.on('close', event => { if (!app.isQuitting) { event.preventDefault(); mainWin.hide(); } });
    mainWin.on('query-session-end', () => { app.isQuitting = true; });
    mainWin.on('session-end', () => { app.isQuitting = true; });
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 }));
    tray.on('click', () => showMain());
    for (const runtime of runtimes) runtime.start(mainWin);
    powerMonitor.on('resume', () => runtimes.forEach(r => r.recoverAfterResume()));
    updateTray();
  });
}
app.on('before-quit', () => { app.isQuitting = true; runtimes.forEach(r => r.stop()); });
app.on('window-all-closed', () => app.quit());

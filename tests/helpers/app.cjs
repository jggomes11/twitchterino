'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

function loadApp({ packaged = false, platform = 'win32', configSeed = null, singleInstance = true, env = {}, argv = [], loginRegistry = new Map() } = {}) {
  const root = path.resolve(__dirname, '../..');
  const state = { scripts: [], requests: [], writes: [], quit: 0, updates: 0, windows: [], ready: [], dialogResponse: 0, sockets: [], timers: [], reloads: [] };
  state.paths = {}; state.loginItems = []; state.loginQueries = [];
  const cookies = new EventEmitter();
  cookies.get = async ({ name }) => [{ value: name === 'auth-token' || name === 'session_token' ? 'FAKE_ACCOUNT_TOKEN' : 'FAKE_OTHER_COOKIE' }];
  const session = {
    cookies, fetch: async (url, init) => { state.requests.push({ url, init }); return new Response('{"data":{"currentUser":{"login":"tester","displayName":"tester"}}}'); },
    setSpellCheckerEnabled() {}, setUserAgent() {}, setPermissionRequestHandler() {},
    webRequest: { onBeforeRequest() {} }, clearStorageData: async () => {}, clearCache: async () => {}, clearAuthCache: async () => {}, flushStorageData() {},
  };
  const sessions = new Map([['persist:twitch', session]]);
  function getSession(partition = '') {
    if (!sessions.has(partition)) {
      const jar = new EventEmitter(); jar.get = cookies.get;
      sessions.set(partition, { ...session, cookies: jar, webRequest: { onBeforeRequest() {} } });
    }
    return sessions.get(partition);
  }
  let app;
  class Window extends EventEmitter {
    constructor(options = {}) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = new EventEmitter();
      const wc = this.webContents;
      wc.id = state.windows.length + 1;
      wc.session = options.webPreferences?.session || getSession(options.webPreferences?.partition);
      wc.mainFrame = { url: 'about:blank', detached: false };
      wc.isDestroyed = () => this.destroyed;
      wc.setWindowOpenHandler = handler => { wc.openHandler = handler; };
      wc.setAudioMuted = () => {};
      wc.getURL = () => wc.mainFrame.url;
      wc.send = () => {};
      wc.stop = () => {};
      wc.reload = () => { state.reloads.push(wc.id); };
      wc.debugger = { isAttached: () => false, attach() {}, on() {}, sendCommand: async () => ({}) };
      wc.executeJavaScript = async code => { state.scripts.push(code); return { status: 200, text: '{"data":{"currentUser":{"login":"page"}}}' }; };
      wc.capturePage = async () => ({ toPNG: () => Buffer.from('png') });
      state.windows.push(this);
      app.emit('web-contents-created', {}, wc);
    }
    loadURL(url) { this.webContents.mainFrame.url = url; queueMicrotask(() => this.webContents.emit('did-finish-load')); return Promise.resolve(); }
    loadFile(file) { return this.loadURL(pathToFileURL(file).href); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
    getContentSize() { return [1380, 840]; }
    getBounds() { return { width: 1380, height: 840 }; }
    isMinimized() { return false; } restore() {} setMenuBarVisibility() {} show() {} hide() {} focus() {} setOpacity() {} setIgnoreMouseEvents() {} setFocusable() {} setSize() {} setPosition() {} showInactive() {} center() {}
  }
  Window.fromWebContents = wc => state.windows.find(w => w.webContents === wc);
  app = new EventEmitter();
  Object.assign(app, {
    commandLine: { appendSwitch() {} }, userAgentFallback: 'Chrome/100 Electron/45', isPackaged: packaged,
    getPath: name => state.paths[name] || '/fake/' + name, setPath: (name, value) => { state.paths[name] = value; }, getVersion: () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    requestSingleInstanceLock: () => singleInstance, quit: () => { state.quit++; }, setAppUserModelId() {}, getAppMetrics: () => [],
    whenReady: () => ({ then: callback => { state.ready.push(callback); } }),
    getLoginItemSettings: query => {
      state.loginQueries.push(query);
      const legacy = loginRegistry.get('app-default');
      return { openAtLogin: !!legacy?.openAtLogin && legacy.path === query.path && JSON.stringify(legacy.args) === JSON.stringify(query.args),
        launchItems: [...loginRegistry.entries()].filter(([, item]) => item.path === query.path)
          .map(([name, item]) => ({ name, path: item.path, args: item.args, scope: 'user', enabled: item.openAtLogin })) };
    },
    setLoginItemSettings: item => { state.loginItems.push(item); loginRegistry.set(item.name || 'app-default', item); },
  });
  const handlers = new Map();
  const image = { resize() { return this; }, getSize: () => ({ width: 16, height: 16 }) };
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  class Notification extends EventEmitter { static isSupported() { return false; } show() {} }
  const electron = {
    app, BrowserWindow: Window, ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    session: { fromPartition: partition => { if (!/^persist:(twitch|kick|twitch-account-[2-4])$/.test(partition)) throw new Error('Wrong partition'); return getSession(partition); } },
    dialog: { showMessageBox: async () => ({ response: state.dialogResponse }), showSaveDialog: async () => ({ canceled: true }) },
    Tray, Menu: { buildFromTemplate: () => ({}) }, Notification,
    nativeImage: { createFromPath: () => image, createFromDataURL: () => image },
    powerSaveBlocker: { start: () => 1, stop() {}, isStarted: () => false }, powerMonitor: new EventEmitter(),
    net: { fetch: async () => new Response('{"channels":[]}') },
  };
  const ownRequire = createRequire(path.join(root, 'main.js'));
  const context = {
    require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: { on() {}, checkForUpdatesAndNotify: async () => { state.updates++; } } }
      : ['fs', 'node:fs'].includes(name) ? { existsSync: () => configSeed !== null, readFileSync: () => JSON.stringify(configSeed || {}), writeFileSync: (...args) => state.writes.push(args), mkdirSync() {}, appendFileSync() {} }
      : name === './account-runtime' ? runtimeModule : ownRequire(name),
    WebSocket: class {
      constructor() { this.readyState = 0; this.messages = []; state.sockets.push(this); }
      send(message) { this.messages.push(message); }
      close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    },
    __dirname: root, module: { exports: {} }, Buffer, URL, console, AbortController, TextDecoder,
    process: { platform, env, argv, execPath: '/fake/Twitchterino.exe' },
    setTimeout: (callback, delay) => { const timer = { callback, delay, cancelled: false }; state.timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; }, setInterval: () => 1, clearInterval() {}, setImmediate, queueMicrotask,
  };
  vm.createContext(context);
  const runtimeSource = fs.readFileSync(path.join(root, 'account-runtime.js'), 'utf8')
    .replace('return runtime;', 'runtime.__test = { query: gql, poll, snapshot, setupSession, sendChat, watchRedemptions, setUsername(value) { username = value; }, setup(main, api) { mainWin = main; apiWin = api; apiReady = Promise.resolve(); }, chestScript: FIND_CHEST, status, get config() { return config; }, get client() { return apiClient; } }; return runtime;');
  const runtimeContainer = { exports: {} };
  vm.runInContext('(function(require,module,__dirname){' + runtimeSource + '\n})', context, { filename: path.join(root, 'account-runtime.js') })(context.require, runtimeContainer, root);
  const runtimeModule = runtimeContainer.exports;
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8') + '\nmodule.exports = { manager, runtimes, setMain(win) { mainWin = win; } };', context, { filename: path.join(root, 'main.js') });
  const { manager, runtimes } = context.module.exports;
  for (const runtime of runtimes) getSession(runtime.partition);
  const main = new Window();
  main.loadFile(path.join(root, 'renderer/index.html'));
  const api = new Window();
  api.loadURL('https://accounts.google.com/ServiceLogin');
  context.module.exports.setMain(main);
  const apiExports = runtimes[0].__test;
  apiExports.setup(main, api);
  // Legacy regression callers still traverse the real authenticated, validated dispatcher.
  const accountHandler = handlers.get('account:command');
  const legacyCommands = ['channels:add','channels:remove','farming:set','watchAll:set','notifyBonus:set','notifyChest:set','autoChest:set','notifyChat:set','sleepMode:set','favorite:toggle','purchase:add','purchase:remove','stores:sequence','stores:cancel','report:get','report:save','intro:done','maxWatchers:set','rotation:set','bonusTarget:set','limitTest:start','limitTest:stop','lowQuality:set','refresh','login:show','logout','store:open','channel:show','chat:send'];
  for (const command of legacyCommands) handlers.set(command, async (event, ...args) => {
    const response = await accountHandler(event, { accountId: 'account-1', command, args });
    return response.result;
  });
  return {
    state, app, session, sessions, handlers, main, api, apiExports, runtimes, manager, dialog: electron.dialog,
    event: () => ({ sender: main.webContents, senderFrame: main.webContents.mainFrame }),
    async fireTimers(delay) {
      const timers = state.timers.filter(timer => timer.delay === delay);
      state.timers = state.timers.filter(timer => timer.delay !== delay);
      for (const timer of timers) if (!timer.cancelled) await timer.callback();
      await new Promise(resolve => setImmediate(resolve));
    },
    async start() { for (const callback of state.ready) await callback(); await new Promise(resolve => setImmediate(resolve)); },
  };
}
module.exports = { loadApp };


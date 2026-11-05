'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

function loadApp({ packaged = false, platform = 'win32' } = {}) {
  const root = path.resolve(__dirname, '../..');
  const state = { scripts: [], requests: [], writes: [], quit: 0, updates: 0, windows: [], ready: [], dialogResponse: 0, sockets: [] };
  const cookies = new EventEmitter();
  cookies.get = async ({ name }) => [{ value: name === 'auth-token' || name === 'session_token' ? 'FAKE_ACCOUNT_TOKEN' : 'FAKE_OTHER_COOKIE' }];
  const session = {
    cookies, fetch: async (url, init) => { state.requests.push({ url, init }); return new Response('{"data":{"currentUser":{"login":"tester","displayName":"tester"}}}'); },
    setSpellCheckerEnabled() {}, setUserAgent() {}, setPermissionRequestHandler() {},
    webRequest: { onBeforeRequest() {} }, clearStorageData: async () => {}, clearCache: async () => {}, clearAuthCache: async () => {}, flushStorageData() {},
  };
  let app;
  class Window extends EventEmitter {
    constructor(options = {}) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = new EventEmitter();
      const wc = this.webContents;
      wc.id = state.windows.length + 1;
      wc.mainFrame = { url: 'about:blank', detached: false };
      wc.isDestroyed = () => this.destroyed;
      wc.setWindowOpenHandler = handler => { wc.openHandler = handler; };
      wc.setAudioMuted = () => {};
      wc.getURL = () => wc.mainFrame.url;
      wc.send = () => {};
      wc.stop = () => {};
      wc.reload = () => {};
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
    setMenuBarVisibility() {} show() {} hide() {} focus() {} setOpacity() {} setIgnoreMouseEvents() {} setFocusable() {} setSize() {} setPosition() {} showInactive() {} center() {}
  }
  Window.fromWebContents = wc => state.windows.find(w => w.webContents === wc);
  app = new EventEmitter();
  Object.assign(app, {
    commandLine: { appendSwitch() {} }, userAgentFallback: 'Chrome/100 Electron/45', isPackaged: packaged,
    getPath: name => '/fake/' + name, setPath() {}, getVersion: () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    requestSingleInstanceLock: () => true, quit: () => { state.quit++; }, setAppUserModelId() {}, getAppMetrics: () => [],
    whenReady: () => ({ then: callback => { state.ready.push(callback); } }),
    getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {},
  });
  const handlers = new Map();
  const image = { resize() { return this; }, getSize: () => ({ width: 16, height: 16 }) };
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  class Notification extends EventEmitter { static isSupported() { return false; } show() {} }
  const electron = {
    app, BrowserWindow: Window, ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    session: { fromPartition: partition => { if (!/^persist:(twitch|kick)$/.test(partition)) throw new Error('Wrong partition'); return session; } },
    dialog: { showMessageBox: async () => ({ response: state.dialogResponse }), showSaveDialog: async () => ({ canceled: true }) },
    Tray, Menu: { buildFromTemplate: () => ({}) }, Notification,
    nativeImage: { createFromPath: () => image, createFromDataURL: () => image },
    powerSaveBlocker: { start: () => 1, stop() {}, isStarted: () => false }, powerMonitor: new EventEmitter(),
    net: { fetch: async () => new Response('{"channels":[]}') },
  };
  const ownRequire = createRequire(path.join(root, 'main.js'));
  const context = {
    require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: { on() {}, checkForUpdatesAndNotify: async () => { state.updates++; } } }
      : name === 'fs' ? { existsSync: () => false, readFileSync: () => '{}', writeFileSync: (...args) => state.writes.push(args), mkdirSync() {}, appendFileSync() {} }
      : ownRequire(name),
    WebSocket: class {
      constructor() { this.readyState = 0; this.messages = []; state.sockets.push(this); }
      send(message) { this.messages.push(message); }
      close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    },
    __dirname: root, module: { exports: {} }, Buffer, URL, console, AbortController, TextDecoder,
    process: { platform, env: {}, argv: [] },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, setImmediate, queueMicrotask,
  };
  vm.createContext(context);
  const exported = 'module.exports = { query: typeof gql === "function" ? gql : kickFetch, poll, snapshot, setupSession, sendChat: typeof sendChat === "function" ? sendChat : null, watchRedemptions: typeof watchRedemptions === "function" ? watchRedemptions : null, setUsername(value) { username = value; }, setup(main, api) { mainWin = main; apiWin = api; apiReady = Promise.resolve(); }, status, config, get client() { return typeof apiClient === "undefined" ? null : apiClient; } };';
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8') + exported, context, { filename: path.join(root, 'main.js') });
  const main = new Window();
  main.loadFile(path.join(root, 'renderer/index.html'));
  const api = new Window();
  api.loadURL('https://accounts.google.com/ServiceLogin');
  context.module.exports.setup(main, api);
  return {
    state, app, session, handlers, main, api, apiExports: context.module.exports,
    event: () => ({ sender: main.webContents, senderFrame: main.webContents.mainFrame }),
    async start() { for (const callback of state.ready) await callback(); await new Promise(resolve => setImmediate(resolve)); },
  };
}
module.exports = { loadApp };


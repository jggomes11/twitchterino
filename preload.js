const { contextBridge, ipcRenderer } = require('electron');

const uiArgument = process.argv.find((arg) => arg.startsWith('--app-ui-url='));
if (process.isMainFrame && uiArgument && location.href === uiArgument.slice('--app-ui-url='.length)) {
  let selectedAccountId = 'account-1';
  let selectionInitialized = false;
  const invokeAccount = async (accountId, command, ...args) => {
    if (!/^account-[1-4]$/.test(accountId)) throw new Error('Invalid account');
    const reply = await ipcRenderer.invoke('account:command', { accountId, command, args });
    return reply.result && typeof reply.result === 'object' ? { ...reply.result, accountId: reply.accountId } : reply.result;
  };
  const accountInvoke = (command, ...args) => invokeAccount(selectedAccountId, command, ...args);
  const accountEvent = (channel, callback) => ipcRenderer.on(channel, (_event, message) => {
    if (message.accountId === selectedAccountId) callback(message.payload, message.accountId);
  });
  contextBridge.exposeInMainWorld('tt', {
    selectAccount: (id) => {
      if (!/^account-[1-4]$/.test(id)) return Promise.reject(new Error('Invalid account'));
      selectionInitialized = true;
      selectedAccountId = id;
      return ipcRenderer.invoke('account:select', id);
    },
    onAccountSelect: (callback) => ipcRenderer.on('account:activate', (_event, id) => callback(id)),
    getState: async () => {
      const state = await ipcRenderer.invoke('state:get');
      if (!selectionInitialized && /^account-[1-4]$/.test(state.accountId)) {
        selectedAccountId = state.accountId;
        selectionInitialized = true;
      }
      return state;
    },
    addChannel: (slug) => accountInvoke('channels:add', slug),
    removeChannel: (slug) => accountInvoke('channels:remove', slug),
    setFarming: (on) => accountInvoke('farming:set', on),
    setWatchAll: (on) => accountInvoke('watchAll:set', on),
    setMaxWatchers: (n) => accountInvoke('maxWatchers:set', n),
    setRotation: (on) => accountInvoke('rotation:set', on),
    setBonusTarget: (kind) => accountInvoke('bonusTarget:set', kind),
    setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),
    quit: () => ipcRenderer.invoke('app:quit'),
    setNotifyBonus: (on) => accountInvoke('notifyBonus:set', on),
    setNotifyChest: (on) => accountInvoke('notifyChest:set', on),
    setAutoChest: (on) => accountInvoke('autoChest:set', on),
    onToast: (cb) => accountEvent('toast', cb),
    startLimitTest: () => accountInvoke('limitTest:start'),
    stopLimitTest: () => accountInvoke('limitTest:stop'),
    setLowQuality: (on) => accountInvoke('lowQuality:set', on),
    refresh: () => accountInvoke('refresh'),
    openStore: (slug) => accountInvoke('store:open', slug),
    showLogin: () => accountInvoke('login:show'),
    logout: () => accountInvoke('logout'),
    logoutAccount: (id) => invokeAccount(id, 'logout'),
    showChannel: (slug) => accountInvoke('channel:show', slug),
    sendChat: (chatroomId, content) => accountInvoke('chat:send', { chatroomId, content }),
    setNotifyChat: (on) => accountInvoke('notifyChat:set', on),
    setSleepMode: (on) => accountInvoke('sleepMode:set', on),
    toggleFavorite: (slug) => accountInvoke('favorite:toggle', slug),
    addPurchase: (kind) => accountInvoke('purchase:add', kind),
    removePurchase: (t) => accountInvoke('purchase:remove', t),
    openStoreSequence: (slugs) => accountInvoke('stores:sequence', slugs),
    cancelStoreSequence: () => accountInvoke('stores:cancel'),
    getReport: () => accountInvoke('report:get'),
    saveReport: (rect) => accountInvoke('report:save', rect),
    introDone: () => accountInvoke('intro:done'),
    onSelect: (cb) => accountEvent('select', cb),
    onStatus: (cb) => ipcRenderer.on('status', (_e, s) => { if (s.accountId === selectedAccountId) cb(s); }),
    onChat: (cb) => accountEvent('chat', cb),
  });
}

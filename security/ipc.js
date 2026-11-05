'use strict';

function invalid() { throw new Error('Invalid IPC arguments'); }
function one(args) { if (args.length !== 1) invalid(); return args[0]; }
function numeric(value) {
  if (typeof value === 'string' && /^[0-9]{1,16}$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid();
  return value;
}
function channelName(value, platform) {
  if (typeof value !== 'string' || value.length > 200 || /[\r\n]/.test(value)) invalid();
  let slug = value.trim().toLowerCase();
  if (/^https?:\/\//.test(slug)) {
    let url;
    try { url = new URL(slug); } catch { invalid(); }
    const host = platform === 'twitch' ? 'twitch.tv' : 'kick.com';
    if (![host, 'www.' + host].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) invalid();
    slug = url.pathname.replace(/^\/|\/$/g, '');
  } else slug = slug.replace(/^[@#]/, '');
  if (!(platform === 'twitch' ? /^[a-z0-9_]{2,25}$/ : /^[a-z0-9_-]{2,30}$/).test(slug)) invalid();
  return slug;
}

function validateIpcArgs(channel, args, context) {
  const { platform, channels = [], chatroomIds = [], viewport = [16384, 16384] } = context;
  if (['state:get', 'app:quit', 'stores:cancel', 'report:get', 'intro:done', 'limitTest:start', 'limitTest:stop', 'refresh', 'login:show', 'logout'].includes(channel)) {
    if (args.length) invalid();
    return [];
  }
  const value = one(args);
  if (['farming:set', 'autostart:set', 'notifyBonus:set', 'notifyChest:set', 'autoChest:set', 'notifyChat:set', 'sleepMode:set', 'rotation:set', 'lowQuality:set'].includes(channel)) {
    if (typeof value !== 'boolean') invalid();
    return [value];
  }
  if (channel === 'channels:add') return [channelName(value, platform)];
  if (['channels:remove', 'favorite:toggle', 'store:open', 'channel:show'].includes(channel)) {
    if (typeof value !== 'string' || channelName(value, platform) !== value || !channels.includes(value)) invalid();
    return [value];
  }
  if (channel === 'maxWatchers:set') {
    const number = numeric(value);
    if (number < 1 || number > (platform === 'twitch' ? 10 : 30)) invalid();
    return [number];
  }
  if (channel === 'bonusTarget:set') {
    if (platform === 'twitch') {
      if (typeof value !== 'string' || (value !== '' && !/^(xp|capture|lure)(?::(1|3|5|10))?$/.test(value))) invalid();
      return [value];
    }
    const cost = numeric(value);
    if (![0, 300, 500, 1000].includes(cost)) invalid();
    return [cost];
  }
  if (channel === 'purchase:add') {
    if (platform === 'twitch') {
      if (!['xp', 'capture', 'lure'].includes(value)) invalid();
      return [value];
    }
    const cost = numeric(value);
    if (![300, 500, 1000].includes(cost)) invalid();
    return [cost];
  }
  if (channel === 'purchase:remove') {
    const timestamp = numeric(value);
    if (timestamp < 1) invalid();
    return [timestamp];
  }
  if (channel === 'stores:sequence') {
    if (!Array.isArray(value) || value.length > 100 || new Set(value).size !== value.length || value.some(slug => typeof slug !== 'string' || !channels.includes(slug))) invalid();
    return [[...value]];
  }
  if (channel === 'report:save') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['x', 'y', 'width', 'height'].includes(key))) invalid();
    const rect = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) invalid();
      rect[key] = Math.round(value[key]);
    }
    if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.width * rect.height > 64 * 1024 * 1024
      || rect.x + rect.width > viewport[0] || rect.y + rect.height > viewport[1]) invalid();
    return [rect];
  }
  if (channel === 'chat:send') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.content !== 'string'
      || value.content.length > 500 || Object.keys(value).some(key => !['chatroomId', 'content'].includes(key))) invalid();
    const content = value.content.replace(/[\r\n]+/g, ' ').trim();
    if (!content) invalid();
    let id = value.chatroomId;
    if (platform === 'twitch') {
      if (typeof id !== 'string' || channelName(id, platform) !== id || !channels.includes(id)) invalid();
    } else {
      if (typeof id === 'number' && (!Number.isSafeInteger(id) || id < 1)) invalid();
      if (!['number', 'string'].includes(typeof id)) invalid();
      id = String(id);
      if (!/^[1-9][0-9]{0,19}$/.test(id) || !chatroomIds.some(known => String(known) === id)) invalid();
    }
    return [{ chatroomId: id, content }];
  }
  invalid();
}

function createIpcRegistrar({ ipcMain, getMainWindow, uiDocument, platform, getContext }) {
  return function handleIpc(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      let authorized = false;
      try {
        const main = getMainWindow();
        const sender = event && event.sender;
        const frame = event && event.senderFrame;
        authorized = !!main && !main.isDestroyed() && sender === main.webContents && !sender.isDestroyed()
          && !!frame && !frame.detached && frame === sender.mainFrame && frame.url === uiDocument;
      } catch {}
      if (!authorized) throw new Error('Unauthorized IPC');
      const checked = validateIpcArgs(channel, args, { ...getContext(), platform });
      return handler(event, ...checked);
    });
  };
}

module.exports = { createIpcRegistrar, validateIpcArgs };


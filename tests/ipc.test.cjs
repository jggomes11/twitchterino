'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createIpcRegistrar, validateIpcArgs } = require('../security/ipc');
const uiDocument = pathToFileURL(path.resolve(__dirname, '../renderer/index.html')).href;
const context = { platform: 'twitch', channels: ['some_user', 'other_user'], chatroomIds: [123], viewport: [1380, 840] };

test('only the live main UI frame can perform privileged work', async () => {
  const handlers = new Map();
  const frame = { url: uiDocument, detached: false };
  const sender = { isDestroyed: () => false, mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: sender };
  let actions = 0;
  const handle = createIpcRegistrar({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, getMainWindow: () => window, uiDocument, platform: 'twitch', getContext: () => context });
  handle('app:quit', () => { actions++; return 'done'; });
  const call = handlers.get('app:quit');
  assert.equal(await call({ sender, senderFrame: frame }), 'done');
  for (const event of [
    { sender: { ...sender }, senderFrame: frame },
    { sender, senderFrame: { ...frame } },
    { sender, senderFrame: null }, {},
  ]) await assert.rejects(call(event), /Unauthorized IPC/);
  for (const url of ['https://evil.invalid', uiDocument + '?x=1', uiDocument + '.evil']) {
    frame.url = url;
    await assert.rejects(call({ sender, senderFrame: frame }), /Unauthorized IPC/);
  }
  frame.url = uiDocument; frame.detached = true;
  await assert.rejects(call({ sender, senderFrame: frame }), /Unauthorized IPC/);
  assert.equal(actions, 1);
});

test('argument validation happens before privileged side effects', async () => {
  let callback;
  let writes = 0;
  const frame = { url: uiDocument };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const handle = createIpcRegistrar({ ipcMain: { handle: (_channel, fn) => { callback = fn; } }, getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }), uiDocument, platform: 'twitch', getContext: () => context });
  handle('notifyChat:set', () => { writes++; });
  await assert.rejects(callback({ sender, senderFrame: frame }, 'false'), /Invalid IPC/);
  assert.equal(writes, 0);
  await callback({ sender, senderFrame: frame }, false);
  assert.equal(writes, 1);
});

test('channel normalization preserves valid inputs and rejects ambiguous URLs', () => {
  for (const value of ['Some_User', '@some_user', 'https://www.twitch.tv/some_user/']) {
    assert.deepEqual(validateIpcArgs('channels:add', [value], context), ['some_user']);
  }
  for (const value of ['https://twitch.tv.evil.invalid/some_user', 'https://u:p@twitch.tv/some_user', 'some_user\r\nJOIN #other', 'some/user', 'a', 'x'.repeat(26)]) {
    assert.throws(() => validateIpcArgs('channels:add', [value], context), /Invalid IPC/);
  }
  assert.throws(() => validateIpcArgs('store:open', ['not_known'], context), /Invalid IPC/);
});

test('numeric UI strings work without accepting coercion tricks or nonfinite values', () => {
  assert.deepEqual(validateIpcArgs('maxWatchers:set', ['2'], context), [2]);
  for (const value of [NaN, Infinity, 'Infinity', '0x10', true, 0, 31, '2oops', {}, []]) {
    assert.throws(() => validateIpcArgs('maxWatchers:set', [value], context), /Invalid IPC/);
  }
  assert.deepEqual(validateIpcArgs('maxWatchers:set', [10], context), [10]);
});

test('store queues and capture rectangles cannot exceed their bounded UI operation', () => {
  assert.deepEqual(validateIpcArgs('stores:sequence', [['some_user', 'other_user']], context), [['some_user', 'other_user']]);
  for (const queue of [Array(101).fill('some_user'), ['some_user', 'some_user'], ['unknown']]) {
    assert.throws(() => validateIpcArgs('stores:sequence', [queue], context), /Invalid IPC/);
  }
  assert.deepEqual(validateIpcArgs('report:save', [{ x: 10.4, y: 20.2, width: 300, height: 200 }], context), [{ x: 10, y: 20, width: 300, height: 200 }]);
  for (const rect of [{ x: 0, y: 0, width: Infinity, height: 2 }, { x: -1, y: 0, width: 2, height: 2 }, { x: 1300, y: 0, width: 500, height: 2 }]) {
    assert.throws(() => validateIpcArgs('report:save', [rect], context), /Invalid IPC/);
  }
});

test('chat identifiers cannot inject IRC commands or arbitrary API paths', () => {
  assert.deepEqual(validateIpcArgs('chat:send', [{ chatroomId: 'some_user', content: ' hi\r\nthere ' }], context), [{ chatroomId: 'some_user', content: 'hi there' }]);
  for (const id of ['some_user\r\nJOIN #other', 'some_user :/ban', 'unknown']) {
    assert.throws(() => validateIpcArgs('chat:send', [{ chatroomId: id, content: 'hi' }], context), /Invalid IPC/);
  }
  const kick = { ...context, platform: 'kick' };
  assert.deepEqual(validateIpcArgs('chat:send', [{ chatroomId: 123, content: 'hi' }], kick), [{ chatroomId: '123', content: 'hi' }]);
  for (const id of ['../user', '//evil.invalid', -1, Infinity, '0123', 456]) {
    assert.throws(() => validateIpcArgs('chat:send', [{ chatroomId: id, content: 'hi' }], kick), /Invalid IPC/);
  }
  for (const content of ['', ' ', 'x'.repeat(501), {}]) {
    assert.throws(() => validateIpcArgs('chat:send', [{ chatroomId: 'some_user', content }], context), /Invalid IPC/);
  }
});

test('preload exposes the bridge only in its expected UI main frame', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8');
  for (const scenario of [
    { href: uiDocument, main: true, expected: true },
    { href: 'https://www.twitch.tv/', main: true, expected: false },
    { href: uiDocument, main: false, expected: false },
    { href: uiDocument + '?x=1', main: true, expected: false },
  ]) {
    const exposed = [];
    vm.runInNewContext(source, {
      require: () => ({ contextBridge: { exposeInMainWorld: name => exposed.push(name) }, ipcRenderer: { invoke() {}, on() {} } }),
      location: { href: scenario.href },
      process: { isMainFrame: scenario.main, argv: ['--app-ui-url=' + uiDocument] },
    });
    assert.equal(exposed.length > 0, scenario.expected);
  }
});


test('all-live mode accepts only a boolean through the guarded UI command', () => {
  assert.deepEqual(validateIpcArgs('watchAll:set', [true], context), [true]);
  assert.deepEqual(validateIpcArgs('watchAll:set', [false], context), [false]);
  for (const value of ['true', 1, null, {}, []]) assert.throws(() => validateIpcArgs('watchAll:set', [value], context), /Invalid IPC/);
});

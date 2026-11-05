'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
const platform = require('../package.json').name === 'kickterino' ? 'kick' : 'twitch';

test('actual application queries do not execute credentials in an external login page', async () => {
  const app = loadApp();
  const result = platform === 'twitch' ? await app.apiExports.query('{currentUser{login}}') : await app.apiExports.query('/api/v1/user');
  assert.equal(result.json.data.currentUser.login, 'tester');
  assert.equal(app.state.scripts.length, 0);
  assert.equal(app.state.requests.length, 1);
  assert.equal(new URL(app.state.requests[0].url).origin, platform === 'twitch' ? 'https://gql.twitch.tv' : 'https://kick.com');
});

test('every registered command rejects a foreign window before doing work', async () => {
  const app = loadApp();
  for (const [channel, handler] of app.handlers) {
    await assert.rejects(Promise.resolve().then(() => handler({
      sender: { isDestroyed: () => false, mainFrame: { url: 'https://evil.invalid' } },
      senderFrame: { url: 'https://evil.invalid' },
    })), /Unauthorized IPC/, channel);
  }
  assert.equal(app.state.quit, 0);
  assert.equal(app.state.writes.length, 0);
  assert.equal(app.state.requests.length, 0);
});

test('valid UI callers retain the application state contract and boolean settings', async () => {
  const app = loadApp();
  const initial = await app.handlers.get('state:get')(app.event());
  assert.equal(Array.isArray(initial.channels), true);
  assert.equal(initial.channels.length, 17);
  const changed = await app.handlers.get('notifyChat:set')(app.event(), false);
  assert.equal(changed.notifyChat, false);
});

test('platform auth-cookie replacement invalidates outstanding query work', async () => {
  const app = loadApp();
  app.apiExports.setupSession();
  let release;
  app.session.fetch = async () => { await new Promise(resolve => { release = resolve; }); return new Response('{"old":true}'); };
  const pending = platform === 'twitch' ? app.apiExports.query('{currentUser{login}}') : app.apiExports.query('/api/v1/user');
  while (!release && app.state.scripts.length === 0) await new Promise(resolve => setImmediate(resolve));
  app.session.cookies.emit('changed', {}, { name: platform === 'twitch' ? 'auth-token' : 'session_token', domain: platform === 'twitch' ? '.twitch.tv' : '.kick.com' }, 'explicit', false);
  if (release) release();
  await assert.rejects(pending, /Session changed/);
});

test('logout clears application state and cancels an outstanding query', async () => {
  const app = loadApp();
  let release;
  app.session.fetch = async () => { await new Promise(resolve => { release = resolve; }); return new Response('{"old":true}'); };
  const pending = platform === 'twitch' ? app.apiExports.query('{currentUser{login}}') : app.apiExports.query('/api/v1/user');
  const rejected = assert.rejects(pending, /Session changed/);
  while (!release && app.state.scripts.length === 0) await new Promise(resolve => setImmediate(resolve));
  const logout = app.handlers.get('logout')(app.event());
  await new Promise(resolve => setImmediate(resolve));
  if (release) release();
  await rejected;
  await logout;
  assert.equal(app.apiExports.status.size, 0);
});

test('packaged startup never contacts an automatic update service', async () => {
  const app = loadApp({ packaged: true });
  await app.start();
  assert.equal(app.state.updates, 0);
});


test('logout cancels a store queue before asynchronous window close events', async () => {
  const app = loadApp();
  const channels = app.apiExports.config.channels.slice(0, 2);
  await app.handlers.get('stores:sequence')(app.event(), channels);
  const firstStore = app.state.windows[2];
  firstStore.close = () => setImmediate(() => firstStore.destroy());
  await app.handlers.get('logout')(app.event());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.windows.length, 3, 'a second queued store must not open after logout');
  assert.equal(app.apiExports.snapshot().storeSequence, null);
});

function setAccountResponses(app, account) {
  app.session.fetch = async (url) => {
    if (platform === 'twitch') {
      const user = { id: 'channel-id', displayName: 'Channel', stream: null,
        channel: { self: { communityPoints: { balance: account.points } }, communityPointsSettings: { isEnabled: true, customRewards: [] } } };
      const data = { currentUser: { id: account.id, login: account.name, displayName: account.name } };
      for (let i = 0; i < 10; i++) data['c' + i] = user;
      return new Response(JSON.stringify({ data }));
    }
    if (/\/api\/v[12]\/user$/.test(url)) return new Response(JSON.stringify({ id: account.id, username: account.name }));
    if (url.endsWith('/points')) return new Response(JSON.stringify({ points: account.points }));
    if (url.endsWith('/me')) return new Response('{"is_following":false,"subscription":null}');
    return new Response('{"chatroom":{"id":123},"livestream":null,"user":{"username":"Channel"}}');
  };
}

test('a replacement account starts with its own balance baseline', async () => {
  const app = loadApp();
  app.apiExports.setupSession();
  const account = { id: '1', name: 'account_a', points: 100 };
  setAccountResponses(app, account);
  await app.apiExports.poll();
  account.id = '2'; account.name = 'account_b'; account.points = 200;
  app.session.cookies.emit('changed', {}, { name: platform === 'twitch' ? 'auth-token' : 'session_token', domain: platform === 'twitch' ? '.twitch.tv' : '.kick.com' }, 'explicit', false);
  await app.apiExports.poll();
  assert.equal(Object.values(app.apiExports.config.daily).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(app.apiExports.snapshot().channels.reduce((sum, channel) => sum + channel.gained, 0), 0);
});

test('ordinary token rotation for the same account keeps its earnings baseline', async () => {
  const app = loadApp();
  app.apiExports.setupSession();
  const account = { id: '1', name: 'account_a', points: 100 };
  setAccountResponses(app, account);
  await app.apiExports.poll();
  account.points = 110;
  app.session.cookies.emit('changed', {}, { name: platform === 'twitch' ? 'auth-token' : 'session_token', domain: platform === 'twitch' ? '.twitch.tv' : '.kick.com' }, 'explicit', false);
  await app.apiExports.poll();
  assert.equal(Object.values(app.apiExports.config.daily).reduce((sum, value) => sum + value, 0), 170);
});

if (platform === 'twitch') {
  test('a redemption response completing after logout cannot restore old account state', async () => {
    const app = loadApp();
    const { EventEmitter } = require('node:events');
    const debuggerApi = new EventEmitter();
    let release;
    debuggerApi.isAttached = () => true;
    debuggerApi.sendCommand = async method => method === 'Network.getResponseBody' ? new Promise(resolve => { release = resolve; }) : {};
    app.apiExports.watchRedemptions('clovaobengala', { debugger: debuggerApi, isDestroyed: () => false });
    debuggerApi.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'old', request: {
      url: 'https://gql.twitch.tv/gql', postData: JSON.stringify({ operationName: 'RedeemCustomReward', variables: { input: { cost: 300, title: '+15% XP' } } }),
    } });
    debuggerApi.emit('message', {}, 'Network.loadingFinished', { requestId: 'old' });
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await app.handlers.get('logout')(app.event());
    release({ body: '{"data":{"redeemCustomReward":{"redemption":{}}}}' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.apiExports.status.size, 0);
    assert.equal(app.apiExports.config.purchases.length, 0);
  });

  test('pending IRC authentication and messages cannot survive cookie invalidation', async () => {
    const app = loadApp();
    app.apiExports.setupSession();
    app.apiExports.setUsername('tester');
    const pending = app.handlers.get('chat:send')(app.event(), { chatroomId: 'clovaobengala', content: 'hello' });
    while (!app.state.sockets.length) await new Promise(resolve => setImmediate(resolve));
    const socket = app.state.sockets[0];
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'explicit', true);
    socket.onopen();
    socket.onmessage({ data: ':tmi.twitch.tv 001 tester :Welcome\r\n' });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.deepEqual(socket.messages, []);
  });
}


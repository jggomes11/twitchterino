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
  const changes = platform === 'twitch' ? [['inserted', false], ['overwrite', true]] : [['explicit', false]];
  for (const [cause, removed] of changes) {
    const app = loadApp();
    app.apiExports.setupSession();
    let release;
    app.session.fetch = async () => { await new Promise(resolve => { release = resolve; }); return new Response('{"old":true}'); };
    const pending = platform === 'twitch' ? app.apiExports.query('{currentUser{login}}') : app.apiExports.query('/api/v1/user');
    while (!release && app.state.scripts.length === 0) await new Promise(resolve => setImmediate(resolve));
    app.session.cookies.emit('changed', {}, { name: platform === 'twitch' ? 'auth-token' : 'session_token', domain: platform === 'twitch' ? '.twitch.tv' : '.kick.com' }, cause, removed);
    if (release) release();
    await assert.rejects(pending, /Session changed/);
  }
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
  if (platform === 'twitch') app.session.cookies.get = async ({ name }) => {
    if (name === 'auth-token') return account.token === '' ? [] : [{ value: account.token || 'FAKE_TOKEN_' + account.id }];
    return [];
  };
  app.session.fetch = async (url, init) => {
    if (platform === 'twitch') {
      const data = { currentUser: { id: account.id, login: account.name, displayName: account.name } };
      const query = JSON.parse(init.body).query;
      for (const match of query.matchAll(/(c[0-9]+): user\(login: ("[^"\n]+")\)/g)) {
        const slug = JSON.parse(match[2]);
        data[match[1]] = { id: 'channel-' + slug, login: slug, displayName: slug,
          stream: (account.live || []).includes(slug) ? { id: 'stream-' + slug, viewersCount: 10, title: 'Fixture live' } : null,
          channel: { self: { communityPoints: { balance: account.points } }, communityPointsSettings: { isEnabled: true, customRewards: [] } } };
      }
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
  if (platform === 'twitch') await app.fireTimers(100); else await app.apiExports.poll();
  assert.equal(Object.values(app.apiExports.config.daily).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(app.apiExports.snapshot().channels.reduce((sum, channel) => sum + channel.gained, 0), 0);
});

test('ordinary token rotation for the same account keeps its earnings baseline', async () => {
  const app = loadApp();
  app.apiExports.setupSession();
  const account = { id: '1', name: 'account_a', points: 100 };
  setAccountResponses(app, account);
  await app.apiExports.poll();
  account.points = 110; account.token = 'FAKE_ROTATED_TOKEN';
  app.session.cookies.emit('changed', {}, { name: platform === 'twitch' ? 'auth-token' : 'session_token', domain: platform === 'twitch' ? '.twitch.tv' : '.kick.com' }, 'explicit', false);
  if (platform === 'twitch') await app.fireTimers(100); else await app.apiExports.poll();
  assert.equal(Object.values(app.apiExports.config.daily).reduce((sum, value) => sum + value, 0), 170);
});

if (platform === 'twitch') {
  test('all-live mode starts every listed online channel without revealing a player', async () => {
    const app = loadApp();
    const slugs = app.apiExports.config.channels.slice(0, 3);
    await app.handlers.get('farming:set')(app.event(), false);
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100, live: slugs });
    await app.apiExports.poll();
    await app.handlers.get('maxWatchers:set')(app.event(), 1);
    await app.handlers.get('watchAll:set')(app.event(), true);
    const actual = await app.handlers.get('farming:set')(app.event(), true);
    assert.deepEqual(actual.channels.filter(channel => channel.watching).map(channel => channel.slug), slugs);
    assert.equal(actual.watchAll, true);
    assert.equal(app.state.reloads.length, 0);
  });

  test('all-live mode follows channels becoming online and offline and can return to a fixed limit', async () => {
    const app = loadApp();
    const slugs = app.apiExports.config.channels.slice(0, 3);
    const account = { id: '1', name: 'account_a', points: 100, live: slugs.slice(0, 2) };
    setAccountResponses(app, account);
    await app.handlers.get('watchAll:set')(app.event(), true);
    await app.apiExports.poll();
    assert.equal(app.apiExports.snapshot().channels.filter(channel => channel.watching).length, 2);
    account.live = slugs; await app.apiExports.poll();
    assert.equal(app.apiExports.snapshot().channels.filter(channel => channel.watching).length, 3);
    account.live = slugs.slice(1); await app.apiExports.poll();
    assert.deepEqual(app.apiExports.snapshot().channels.filter(channel => channel.watching).map(channel => channel.slug), slugs.slice(1));
    await app.handlers.get('maxWatchers:set')(app.event(), 1);
    const limited = await app.handlers.get('watchAll:set')(app.event(), false);
    assert.equal(limited.channels.filter(channel => channel.watching).length, 1);
  });

  test('all-live mode retains online players when a channel has not awarded points recently', async () => {
    const app = loadApp();
    const slug = app.apiExports.config.channels[0];
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100, live: [slug] });
    await app.handlers.get('watchAll:set')(app.event(), true);
    await app.apiExports.poll();
    const player = app.state.windows.at(-1);
    app.apiExports.status.get(slug).watchingSince = Date.now() - 15 * 60 * 1000;
    await app.apiExports.poll();
    assert.equal(player.isDestroyed(), false);
    assert.equal(app.apiExports.snapshot().channels[0].watching, true);
  });

  test('reasserting the selected verified cookie never exposes a signed-out state or closes an unchanged-session store', async () => {
    const app = loadApp();
    app.apiExports.setupSession();
    const account = { id: '1', name: 'account_a', points: 100 };
    setAccountResponses(app, account);
    await app.apiExports.poll();
    const slug = app.apiExports.config.channels[0];
    await app.handlers.get('store:open')(app.event(), slug);
    const store = app.state.windows.at(-1);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'overwrite', true);
    let during = app.apiExports.snapshot();
    assert(during.loggedIn || during.sessionChecking, 'an overwrite is checking or connected, never signed out');
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted-no-change-overwrite', false);
    await app.fireTimers(100);
    const after = app.apiExports.snapshot();
    assert.equal(after.loggedIn, true);
    assert.equal(after.username, 'account_a');
    assert.equal(store.isDestroyed(), false);
  });

  test('cookie events for an unselected path use the actual selected token', async () => {
    const app = loadApp(); app.apiExports.setupSession();
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100 });
    await app.apiExports.poll();
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv', path: '/other', value: 'FAKE_OTHER_SCOPED_COOKIE' }, 'inserted', false);
    await app.fireTimers(100);
    assert.equal(app.apiExports.snapshot().username, 'account_a');
    assert.equal(app.apiExports.snapshot().loggedIn, true);
  });

  test('current-session verification is not dropped behind a previous-generation player check', async () => {
    const app = loadApp(); app.apiExports.setupSession();
    const slug = app.apiExports.config.channels[0];
    const account = { id: '1', name: 'account_a', points: 100, live: [slug] };
    setAccountResponses(app, account); await app.apiExports.poll();
    const player = app.state.windows.at(-1);
    let release, checks = 0;
    player.webContents.executeJavaScript = async () => {
      if (checks++ === 0) await new Promise(resolve => { release = resolve; });
      return { gate: false, video: null };
    };
    const oldPoll = app.apiExports.poll();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    account.id = '2'; account.name = 'account_b'; account.points = 200; account.live = [];
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
    await app.fireTimers(100);
    const beforeOldFinishes = app.apiExports.snapshot();
    release(); await oldPoll;
    assert.equal(beforeOldFinishes.username, 'account_b');
    assert.equal(app.apiExports.snapshot().username, 'account_b');
    assert.equal(app.apiExports.snapshot().today, 0);
  });

  test('logout invalidates a selected-cookie check that completes later', async () => {
    const app = loadApp(); app.apiExports.setupSession();
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100 });
    await app.apiExports.poll();
    let release;
    app.session.cookies.get = async ({ name }) => name === 'auth-token' ? new Promise(resolve => { release = resolve; }) : [];
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
    const checking = app.fireTimers(100);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await app.handlers.get('logout')(app.event());
    release([{ value: 'FAKE_TOKEN_1' }]); await checking;
    assert.equal(app.apiExports.snapshot().loggedIn, false);
    assert.equal(app.apiExports.snapshot().sessionChecking, false);
    assert.equal(app.apiExports.status.size, 0);
  });

  test('removing an unselected scoped cookie preserves the actual verified session and its windows', async () => {
    const app = loadApp(); app.apiExports.setupSession();
    const slug = app.apiExports.config.channels[0];
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100, live: [slug] });
    await app.apiExports.poll(); const player = app.state.windows.at(-1);
    await app.handlers.get('store:open')(app.event(), slug); const store = app.state.windows.at(-1);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv', path: '/other' }, 'explicit', true);
    const checking = app.apiExports.snapshot();
    assert(checking.loggedIn || checking.sessionChecking);
    await app.fireTimers(100);
    assert.equal(app.apiExports.snapshot().username, 'account_a');
    assert.equal(player.isDestroyed(), false);
    assert.equal(store.isDestroyed(), false);
  });

  test('an obsolete player result cannot overwrite the current same-window health', async () => {
    const app = loadApp(); app.apiExports.setupSession();
    const slug = app.apiExports.config.channels[0];
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100, live: [slug] });
    await app.apiExports.poll(); const player = app.state.windows.at(-1);
    let release, checks = 0;
    player.webContents.executeJavaScript = async () => {
      if (checks++ === 0) return new Promise(resolve => { release = resolve; });
      return { gate: false, video: { paused: false, time: 40, ready: 4 } };
    };
    const oldPoll = app.apiExports.poll();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
    await app.fireTimers(100);
    release({ gate: true, video: null }); await oldPoll;
    assert.equal(app.apiExports.snapshot().channels[0].ageGate, false);
  });

  test('obsolete player timeouts cannot destroy a healthy player in the current generation', async () => {
    const app = loadApp(); app.apiExports.setupSession();
    const slug = app.apiExports.config.channels[0];
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100, live: [slug] });
    await app.apiExports.poll(); const player = app.state.windows.at(-1);
    app.apiExports.status.get(slug).watchingSince = Date.now() - 4 * 60 * 1000;
    const rejects = []; let checks = 0;
    player.webContents.executeJavaScript = async () => {
      if (++checks <= 3) return new Promise((_resolve, reject) => rejects.push(reject));
      return { gate: false, video: { paused: false, time: 40, ready: 4 } };
    };
    const oldPolls = [app.apiExports.poll()];
    while (rejects.length < 1) await new Promise(resolve => setImmediate(resolve));
    for (let generation = 0; generation < 3; generation++) {
      app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
      const next = app.fireTimers(100);
      if (generation < 2) {
        oldPolls.push(next);
        while (rejects.length < generation + 2) await new Promise(resolve => setImmediate(resolve));
      } else await next;
    }
    for (const reject of rejects) reject(new Error('timeout'));
    await Promise.all(oldPolls);
    assert.equal(player.isDestroyed(), false);
    assert.equal(app.apiExports.snapshot().channels[0].watching, true);
  });

  test('showing an already running player does not reload or replace it', async () => {
    const app = loadApp();
    const slug = app.apiExports.config.channels[0];
    const account = { id: '1', name: 'account_a', points: 100, live: [slug] };
    setAccountResponses(app, account);
    await app.apiExports.poll();
    const player = app.state.windows.at(-1);
    const count = app.state.windows.length;
    await app.handlers.get('channel:show')(app.event(), slug);
    assert.equal(app.state.windows.length, count);
    assert.equal(player.isDestroyed(), false);
    assert.equal(app.state.reloads.includes(player.webContents.id), false);
  });

  test('overwriting an auth cookie keeps live players and their verified account baseline', async () => {
    const app = loadApp();
    app.apiExports.setupSession();
    const account = { id: '1', name: 'account_a', points: 100 };
    setAccountResponses(app, account);
    await app.apiExports.poll();
    const slug = app.apiExports.config.channels[0];
    app.apiExports.status.get(slug).live = true;
    await app.handlers.get('farming:set')(app.event(), true);
    const player = app.state.windows.at(-1);
    assert.equal(app.apiExports.snapshot().channels[0].watching, true);
    await app.handlers.get('stores:sequence')(app.event(), app.apiExports.config.channels.slice(0, 2));
    const store = app.state.windows.at(-1);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'overwrite', true);
    assert.equal(player.isDestroyed(), false, 'replacement is not a logout');
    assert.equal(store.isDestroyed(), false, 'an unchanged selected cookie preserves the same-account store');
    assert.equal(app.apiExports.snapshot().channels[0].live, true);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted-no-change-overwrite', false);
    account.points = 110;
    await app.fireTimers(100);
    assert.equal(app.apiExports.snapshot().today, 170, 'the same account keeps its pre-refresh baseline');
  });

  test('an auth-cookie insertion revalidates the account while the login window is hidden', async () => {
    const app = loadApp();
    app.apiExports.setupSession();
    const account = { id: '1', name: 'account_a', points: 100 };
    setAccountResponses(app, account);
    await app.apiExports.poll();
    account.token = 'FAKE_NEW_SAME_ACCOUNT_TOKEN';
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'overwrite', true);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
    await app.fireTimers(100);
    const actual = app.apiExports.snapshot();
    assert.equal(actual.username, 'account_a');
    assert.equal(actual.loggedIn, true);
  });

  test('an actual auth-cookie removal still clears live players and cached account data', async () => {
    const app = loadApp();
    app.apiExports.setupSession();
    const account = { id: '1', name: 'account_a', points: 100 };
    setAccountResponses(app, account);
    await app.apiExports.poll();
    app.apiExports.status.get(app.apiExports.config.channels[0]).live = true;
    await app.handlers.get('farming:set')(app.event(), true);
    const player = app.state.windows.at(-1);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
    account.token = '';
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'explicit', true);
    let requests = 0;
    app.session.fetch = async () => { requests++; return new Response('{}'); };
    await app.fireTimers(100);
    assert.equal(player.isDestroyed(), true);
    assert.equal(app.apiExports.status.size, 0);
    assert.equal(app.apiExports.snapshot().loggedIn, false);
    assert.equal(requests, 0, 'removal must cancel scheduled authenticated work');
    assert.equal(app.apiExports.snapshot().loggedIn, false);
  });

  test('a retained player cannot attribute a new redemption to an unverified previous account', async () => {
    const app = loadApp();
    app.apiExports.setupSession();
    const account = { id: '1', name: 'account_a', points: 100 };
    setAccountResponses(app, account);
    await app.apiExports.poll();
    const slug = app.apiExports.config.channels[0];
    app.apiExports.status.get(slug).live = true;
    await app.handlers.get('farming:set')(app.event(), true);
    const player = app.state.windows.at(-1);
    const { EventEmitter } = require('node:events');
    function redemptionFrom(win) {
      const debuggerApi = new EventEmitter();
      debuggerApi.isAttached = () => true;
      debuggerApi.sendCommand = async () => ({ body: '{"data":{"redeemCustomReward":{"redemption":{}}}}' });
      win.webContents.debugger = debuggerApi;
      app.apiExports.watchRedemptions(slug, win.webContents);
      return async () => {
        debuggerApi.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'purchase', request: {
          url: 'https://gql.twitch.tv/gql', postData: JSON.stringify({ operationName: 'RedeemCustomReward', variables: { input: { cost: 300, title: '+15% XP' } } }),
        } });
        debuggerApi.emit('message', {}, 'Network.loadingFinished', { requestId: 'purchase' });
        await new Promise(resolve => setImmediate(resolve));
      };
    }
    const redeem = redemptionFrom(player);
    account.id = '2'; account.name = 'account_b'; account.points = 200;
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'overwrite', true);
    app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
    assert.equal(player.isDestroyed(), false);
    await redeem();
    assert.equal(app.apiExports.config.purchases.length, 0, 'unverified new-session work must not enter the previous account report');
    await app.fireTimers(100);
    assert.equal(app.apiExports.config.reportAccount, 'id:2');
    assert.equal(app.apiExports.config.accountReports.find(report => report.account === 'id:1').purchases.length, 0);
    await app.handlers.get('store:open')(app.event(), slug);
    await redemptionFrom(app.state.windows.at(-1))();
    assert.equal(app.apiExports.config.purchases.length, 1, 'verified current-account redemptions still work');
  });

  test('a redemption response completing after logout cannot restore old account state', async () => {
    const app = loadApp();
    setAccountResponses(app, { id: '1', name: 'account_a', points: 100 });
    await app.apiExports.poll();
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


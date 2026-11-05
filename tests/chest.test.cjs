'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp } = require('./helpers/app.cjs');

function chestFixture({ confirm = true, rewriteCookie = false, slowRevalidation = false, switchAccount = false, omitConfirmation = false, extraClaim = false, holdFirst = false } = {}) {
  const app = loadApp(); app.apiExports.setupSession();
  const slug = app.apiExports.config.channels[0];
  const secondSlug = app.apiExports.config.channels[1];
  const backend = { claim: 'fixture-claim', secondClaim: extraClaim ? 'fixture-claim-2' : null, balance: 100, secondBalance: 100, clicks: 0, requests: [] };
  const user = { id: '1', login: 'fixture', displayName: 'Fixture' };
  app.session.cookies.get = async ({ name }) => name === 'auth-token' ? [{ value: 'FAKE_TOKEN_' + user.id }] : [];
  const channel = name => ({ id: '123', login: name, displayName: name, stream: null,
    channel: { self: { communityPoints: { balance: name === slug ? backend.balance : name === secondSlug ? backend.secondBalance : 100,
      availableClaim: name === slug && backend.claim ? { id: backend.claim } : name === secondSlug && backend.secondClaim ? { id: backend.secondClaim } : null } },
    communityPointsSettings: { isEnabled: true, customRewards: [] } } });
  app.session.fetch = async (url, init) => {
    const query = JSON.parse(init.body).query;
    backend.requests.push({ url, query });
    const data = { currentUser: user };
    if (query.includes('ChestClaimConfirmation')) {
      const requested = query.match(/channel:user\(login:("[^"]+")\)/);
      data.channel = channel(requested ? JSON.parse(requested[1]) : slug);
      if (omitConfirmation) delete data.channel.channel.self.communityPoints.availableClaim;
    }
    else for (const match of query.matchAll(/(c[0-9]+): user\(login: ("[^"\n]+")\)/g)) data[match[1]] = channel(JSON.parse(match[2]));
    return new Response(JSON.stringify({ data }));
  };
  const push = app.state.windows.push.bind(app.state.windows);
  app.state.windows.push = win => {
    if (win.options.width === 400) win.webContents.executeJavaScript = async () => {
      const currentSlug = new URL(win.webContents.getURL()).pathname.split('/')[2];
      if (holdFirst && currentSlug === slug && !backend.rejectFirst) return new Promise((_resolve, reject) => { backend.rejectFirst = reject; });
      backend.clicks++;
      if (confirm) {
        if (currentSlug === secondSlug) { backend.secondClaim = null; backend.secondBalance = 150; }
        else { backend.claim = null; backend.balance = 150; }
      }
      if (switchAccount) { user.id = '2'; user.login = 'account_b'; user.displayName = 'Account B'; }
      if (slowRevalidation) {
        app.session.cookies.get = async ({ name }) => name === 'auth-token'
          ? new Promise(resolve => { backend.resolveCookie = resolve; }) : [];
        app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
      }
      if (rewriteCookie || switchAccount) {
        app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'overwrite', true);
        app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted-no-change-overwrite', false);
        await app.fireTimers(100);
      }
      return { ok: true, clicked: true };
    };
    return push(win);
  };
  async function drain() {
    for (let i = 0; i < 15; i++) {
      const delays = [...new Set(app.state.timers.filter(timer => !timer.cancelled && timer.delay <= 3000).map(timer => timer.delay))];
      for (const delay of delays) await app.fireTimers(delay);
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return { app, slug, secondSlug, backend, drain };
}

test('an available chest is queued on the first verified poll without a follow or subscription', async () => {
  const { app, backend, drain } = chestFixture();
  await app.handlers.get('farming:set')(app.event(), false);
  await app.apiExports.poll(); await drain();
  assert.equal(backend.clicks, 1);
  assert.equal(app.apiExports.snapshot().chestsToday, 1);
  assert.equal(app.apiExports.snapshot().channels[0].points, 150);
});

test('a click without backend confirmation is never counted as a collected chest', async () => {
  const { app, backend, drain } = chestFixture({ confirm: false });
  app.apiExports.config.autoChest = false;
  await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true); await drain();
  assert.equal(backend.clicks, 1);
  assert.equal(app.apiExports.snapshot().chestsToday, 0);
  assert.equal(app.apiExports.snapshot().channels[0].chest, true);
});

test('a confirmed chest survives a same-token cookie rewrite without losing or duplicating its points', async () => {
  const { app, backend, drain } = chestFixture({ rewriteCookie: true });
  app.apiExports.config.autoChest = false;
  await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true); await drain();
  const state = app.apiExports.snapshot();
  assert.equal(backend.clicks, 1);
  assert.equal(state.loggedIn, true);
  assert.equal(state.chestsToday, 1);
  assert.equal(state.channels[0].points, 150);
  assert.equal(state.today, 50);
  assert.equal(state.channels[0].chest, false);
});

test('the chest finder never clicks a generic reward redemption button', async () => {
  const app = loadApp(); let paidClicks = 0, tick, stopped = false, clock = 0;
  const paid = { disabled: false, className: '', getAttribute: () => 'Claim reward', click: () => { paidClicks++; } };
  const document = { querySelector: () => null, querySelectorAll: () => [paid] };
  const result = vm.runInNewContext(app.apiExports.chestScript('some_channel'), {
    document, location: { origin: 'https://www.twitch.tv', pathname: '/popout/some_channel/chat' },
    Date: { now: () => clock }, setInterval: callback => { tick = callback; return 1; }, clearInterval: () => { stopped = true; },
  });
  for (let i = 0; i < 100 && !stopped; i++) { clock += 500; tick(); }
  await result;
  assert.equal(paidClicks, 0);
});

test('an already-clicked chest waits for slow same-token cookie verification before confirmation', async () => {
  const { app, backend, drain } = chestFixture({ slowRevalidation: true });
  app.apiExports.config.autoChest = false; await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true);
  while (backend.clicks === 0) await new Promise(resolve => setImmediate(resolve));
  const revalidation = app.fireTimers(100);
  while (!backend.resolveCookie) await new Promise(resolve => setImmediate(resolve));
  for (let tick = 0; tick < 24; tick++) await app.fireTimers(25);
  app.session.cookies.get = async ({ name }) => name === 'auth-token' ? [{ value: 'FAKE_TOKEN_1' }] : [];
  backend.resolveCookie([{ value: 'FAKE_TOKEN_1' }]);
  await revalidation; await drain();
  assert.equal(app.apiExports.snapshot().loggedIn, true);
  assert.equal(app.apiExports.snapshot().chestsToday, 1);
  assert.equal(backend.clicks, 1);
});

test('an automatic chest cannot be recorded for a different verified account', async () => {
  const { app, drain } = chestFixture({ switchAccount: true });
  app.apiExports.config.autoChest = false;
  await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true); await drain();
  assert.equal(app.apiExports.config.reportAccount, 'id:2');
  assert.equal(app.apiExports.snapshot().chestsToday, 0);
  assert.equal(app.apiExports.config.accountReports.find(report => report.account === 'id:1').chestsClaimed, 0);
});

test('a missing available-claim field is not proof that the chest was collected', async () => {
  const { app, drain } = chestFixture({ omitConfirmation: true });
  app.apiExports.config.autoChest = false;
  await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true); await drain();
  assert.equal(app.apiExports.snapshot().chestsToday, 0);
});

test('a queued chest resumes after a failed attempt overlaps same-token revalidation', async () => {
  const { app, secondSlug, backend, drain } = chestFixture({ extraClaim: true, holdFirst: true });
  app.apiExports.config.autoChest = false; await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true);
  while (!backend.rejectFirst) await new Promise(resolve => setImmediate(resolve));
  app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'inserted', false);
  backend.rejectFirst(new Error('timeout'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.apiExports.snapshot().channels.find(channel => channel.slug === secondSlug).chestState, 'queued');
  await app.fireTimers(100); await drain();
  assert.equal(app.apiExports.snapshot().chestsToday, 1);
  assert.equal(backend.clicks, 1);
});

test('turning off automatic chests closes the active window and cancels its queued successor', async () => {
  const { app, backend, drain } = chestFixture({ extraClaim: true, holdFirst: true });
  app.apiExports.config.autoChest = false; await app.apiExports.poll();
  await app.handlers.get('autoChest:set')(app.event(), true);
  while (!backend.rejectFirst) await new Promise(resolve => setImmediate(resolve));
  const active = app.state.windows.at(-1);
  await app.handlers.get('autoChest:set')(app.event(), false);
  assert.equal(active.isDestroyed(), true);
  backend.rejectFirst(new Error('timeout')); await drain();
  assert.equal(backend.clicks, 0);
  assert.equal(app.apiExports.snapshot().chestsToday, 0);
  assert.equal(app.apiExports.snapshot().channels.some(channel => channel.chestState === 'queued'), false);
});

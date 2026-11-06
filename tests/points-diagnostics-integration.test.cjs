'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');

function fixture({ late = false } = {}) {
  const a = loadApp(); a.apiExports.setupSession();
  const [control, target] = a.apiExports.config.channels;
  Object.assign(a.apiExports.config, { channels: [control, target], farming: true, watchAll: true, autoChest: false });
  let targetLive = !late, partial = false, balance = 100;
  const push = a.state.windows.push.bind(a.state.windows);
  a.state.windows.push = win => {
    if (win.options.width === 480) win.webContents.executeJavaScript = async () => ({ gate: false,
      video: { paused: false, time: 300, height: 160, ready: 4 },
      page: { visibility: 'visible', focused: false, loginPromptVisible: false, muted: true, volume: 1,
        username: 'SECRET_USER', token: 'SECRET_PAGE' } });
    return push(win);
  };
  a.session.fetch = async (_url, options) => {
    const data = { currentUser: { id: '1', login: 'fixture', displayName: 'Fixture' } };
    for (const m of JSON.parse(options.body).query.matchAll(/(c[0-9]+): user\(login: ("[^"\n]+")\)/g)) {
      const slug = JSON.parse(m[2]);
      data[m[1]] = { id: 'channel-' + slug, displayName: slug,
        stream: slug === control || targetLive ? { id: 'stream-' + slug, title: 'Fixture', viewersCount: 1 } : null,
        channel: { communityPointsSettings: { isEnabled: true, customRewards: [] }, self: {
          communityPoints: partial && slug === target ? null : { balance: slug === target ? 300 : balance, availableClaim: null } } } };
    }
    return new Response(JSON.stringify({ data }));
  };
  const poll = async (minutes = 0) => { a.advanceTime(minutes * 60000); balance += 10; await a.apiExports.poll(); };
  const player = slug => a.state.windows.findLast(w => !w.isDestroyed() && w.webContents.getURL() === 'https://www.twitch.tv/' + slug);
  const log = () => JSON.parse(a.state.logs.findLast(([file]) => file.endsWith('points-log.jsonl'))[1]);
  return { a, control, target, poll, player, log, online() { targetLive = true; }, partial() { partial = true; } };
}

test('real history associates passive telemetry with its player and exposes recovery conditions without secrets', async () => {
  const f = fixture(); await f.poll();
  const target = f.player(f.target), control = f.player(f.control);
  target.webContents.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'SECRET_REQUEST', request: {
    method: 'POST', url: 'https://spade.twitch.tv/track?private=SECRET_URL',
    headers: { Authorization: 'SECRET_AUTH' }, postData: '[{"event":"minute-watched","properties":{"token":"SECRET_BODY"}}]' } });
  target.webContents.debugger.emit('message', {}, 'Network.responseReceived', { requestId: 'SECRET_REQUEST', response: { status: 204 } });
  target.webContents.debugger.emit('message', {}, 'Network.loadingFinished', { requestId: 'SECRET_REQUEST' });
  await f.poll(1);
  const log = f.log(), d = log.channels[f.target].diagnostics;
  assert.ok(d, 'point history omits diagnostic evidence');
  assert.equal(log.farming, true); assert.equal(log.watchAll, true);
  assert.equal(d.balanceAvailable, true); assert.equal(d.apiError, false);
  assert.equal(d.pointsEnabled, true); assert.equal(d.manualPlayer, false);
  assert.equal(d.page.visibility, 'visible'); assert.equal(d.page.loginPromptVisible, false);
  assert.equal(typeof d.playerSampleAt, 'number');
  assert.equal(d.tracking.minuteWatchedEvents, 1); assert.equal(d.tracking.lastStatus, 204);
  assert.equal(d.tracking.networkEnabled, true);
  assert.equal(log.channels[f.control].diagnostics.tracking.requests, 0);
  assert.equal(d.recovery.awaitingInitialCredit, false);
  assert.equal(f.player(f.target), target); assert.equal(f.player(f.control), control);
  assert.doesNotMatch(JSON.stringify(log), /SECRET|Authorization|https:|properties|username/);
  assert.equal(f.a.state.debugCommands.some(c => c.method === 'Network.getRequestPostData'), false);
});

test('diagnostics distinguish a cached balance, manual player and stale sample', async () => {
  const f = fixture(); await f.poll();
  const sampledAt = f.log().channels[f.target].diagnostics?.playerSampleAt;
  await f.a.handlers.get('channel:show')(f.a.event(), f.target);
  f.partial(); await f.poll(1);
  const c = f.log().channels[f.target];
  assert.ok(c.diagnostics, 'cached balance lacks diagnostic validity');
  assert.equal(c.points, 300);
  assert.equal(c.diagnostics.balanceAvailable, false);
  assert.equal(c.diagnostics.manualPlayer, true);
  assert.equal(c.diagnostics.playerSampleAt, sampledAt);
});

test('an actual initial-credit retry is recorded without replacing the healthy player', async () => {
  const f = fixture({ late: true }); await f.poll(); f.online(); await f.poll(1);
  const target = f.player(f.target), control = f.player(f.control);
  await f.poll(14);
  assert.equal(target.isDestroyed(), true); assert.equal(f.player(f.control), control);
  const d = f.log().channels[f.target].diagnostics;
  assert.ok(d, 'retry event lacks diagnostic evidence');
  assert.equal(d.recovery.attempts, 1);
  assert.equal(typeof d.recovery.lastAttemptAt, 'number');
  assert.equal(d.recovery.nextAttemptAt - d.recovery.lastAttemptAt, 26 * 60000);
});

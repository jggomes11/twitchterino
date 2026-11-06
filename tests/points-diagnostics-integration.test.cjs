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
      data[m[1]] = { id: slug === target ? '123' : '99', displayName: slug,
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

test('Electron45 navigation details discard obsolete requests only for a new main document', async () => {
  const f = fixture(); await f.poll();
  const wc = f.player(f.target).webContents;
  wc.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'pending',
    request: { url: 'https://spade.twitch.tv/track', method: 'POST' } });
  wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: 'SECRET_SUBFRAME', frame: null });
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: 'SECRET_HASH', frame: null });
  await f.poll();
  assert.equal(f.log().channels[f.target].diagnostics.tracking.pendingRequests, 1);
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'SECRET_NAV', frame: null });
  await f.poll();
  const tracking = f.log().channels[f.target].diagnostics.tracking;
  assert.equal(tracking.pendingRequests, 0);
  assert.equal(tracking.navigations, 1);
  assert.doesNotMatch(JSON.stringify(tracking), /SECRET/);
});

test('real main compares the transmitted watch account/channel and reads only identified telemetry responses', async () => {
  const { gzipSync } = require('node:zlib');
  const f = fixture(); await f.poll();
  const wc = f.player(f.target).webContents;
  const original = wc.debugger.sendCommand;
  let bodyReads = 0;
  wc.debugger.sendCommand = async (method, params) => {
    if (method === 'Network.getResponseBody') {
      bodyReads++;
      assert.equal(params.requestId, 'telemetry');
      return { body: '{"data":{"sendSpadeEvents":{"statusCode":200}},"private":"SECRET_RESPONSE"}' };
    }
    return original(method, params);
  };
  const data = gzipSync(JSON.stringify([{ event: 'minute-watched', properties: {
    user_id: 1, channel_id: '123', logged_in: true, live: true, is_ad_playing: false,
    playback_gated: false, muted: false, minutes_logged: 2, token: 'SECRET_BODY',
  } }])).toString('base64');
  wc.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'telemetry', request: {
    method: 'POST', url: 'https://gql.twitch.tv/gql', postData: JSON.stringify({
      query: 'mutation SendEvents($input:SendSpadeEventsInput!){sendSpadeEvents(input:$input){statusCode}}',
      variables: { input: { data, repository: 'twilight', encoding: 'GZIP_B64' } },
    }) } });
  wc.debugger.emit('message', {}, 'Network.responseReceived', { requestId: 'telemetry', response: { status: 200 } });
  wc.debugger.emit('message', {}, 'Network.loadingFinished', { requestId: 'telemetry', encodedDataLength: 100 });
  await new Promise(resolve => setImmediate(resolve));
  await f.poll();
  const log = f.log(), d = log.channels[f.target].diagnostics;
  assert.equal(d.tracking.lastWatchAccountMatches, true);
  assert.equal(d.tracking.lastWatchChannelMatches, true);
  assert.equal(d.tracking.spadeAcceptedResponses, 1);
  assert.equal(bodyReads, 1);
  assert.equal(log.diagnosticsVersion, 2);
  assert.doesNotMatch(JSON.stringify(log), /SECRET|user_id|channel_id|sendSpadeEvents/);
});

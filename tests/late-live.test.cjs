'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
const MINUTE = 60000;

function fixture() {
  const app = loadApp(); app.apiExports.setupSession();
  const [earning, late, secondLate] = app.apiExports.config.channels.slice(0, 3);
  Object.assign(app.apiExports.config, { channels: [earning, late, secondLate], watchAll: true, farming: true, autoChest: false });
  const live = new Set([earning]);
  const points = new Map([[earning, 100], [late, 100], [secondLate, 100]]);
  const disabled = new Set(), gated = new Set(), unavailable = new Set();
  const push = app.state.windows.push.bind(app.state.windows);
  app.state.windows.push = win => {
    if (win.options.width === 480) {
      let time = 0;
      win.webContents.executeJavaScript = async () => ({ gate: gated.has(new URL(win.webContents.getURL()).pathname.slice(1)),
        video: { paused: false, time: time += 60, ready: 4, height: 160 } });
    }
    return push(win);
  };
  app.session.fetch = async (_url, options) => {
    const query = JSON.parse(options.body).query;
    const data = { currentUser: { id: '1', login: 'fixture', displayName: 'Fixture' } };
    for (const match of query.matchAll(/(c[0-9]+): user\(login: ("[^"\n]+")\)/g)) {
      const slug = JSON.parse(match[2]);
      data[match[1]] = { id: 'channel-' + slug, login: slug, displayName: slug,
        stream: live.has(slug) ? { id: 'stream-' + slug, viewersCount: 10, title: 'Fixture live' } : null,
        channel: { self: { communityPoints: unavailable.has(slug) ? null : { balance: points.get(slug), availableClaim: null } },
          communityPointsSettings: { isEnabled: !disabled.has(slug), customRewards: [] } } };
    }
    return new Response(JSON.stringify({ data, ...(unavailable.size ? { errors: [{ message: 'Balance unavailable' }] } : {}) }));
  };
  const player = slug => app.state.windows.findLast(win => !win.isDestroyed() && win.webContents.getURL() === 'https://www.twitch.tv/' + slug);
  async function poll(minutes = 0) {
    app.advanceTime(minutes * MINUTE);
    points.set(earning, points.get(earning) + 10);
    await app.apiExports.poll();
  }
  async function startLate(...slugs) { slugs.forEach(slug => live.add(slug)); await poll(1); }
  return { app, earning, late, secondLate, points, live, disabled, gated, unavailable, player, poll, startLate };
}

test('a newly online channel with no initial credit is restarted without replacing the earning player', async () => {
  const f = fixture(); await f.poll();
  const earningPlayer = f.player(f.earning);
  await f.startLate(f.late);
  const latePlayer = f.player(f.late);
  await f.poll(14);
  assert.equal(latePlayer.isDestroyed(), true);
  assert.notEqual(f.player(f.late), latePlayer);
  assert.equal(f.player(f.earning), earningPlayer);
  assert.equal(earningPlayer.isDestroyed(), false);
  assert.equal(f.app.apiExports.snapshot().channels.find(channel => channel.slug === f.earning).earning, 'earning');
});

test('a late channel is allowed to receive its first credit before any recovery', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  const player = f.player(f.late); await f.poll(6);
  assert.equal(f.player(f.late), player);
  assert.equal(player.isDestroyed(), false);
});

test('late-channel retries back off instead of refreshing on every poll', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late); await f.poll(14);
  const replacement = f.player(f.late);
  await f.poll(1); await f.poll(13);
  assert.equal(f.player(f.late), replacement);
  await f.poll(13);
  assert.equal(replacement.isDestroyed(), true);
  assert.notEqual(f.player(f.late), replacement);
});

test('initial credit ends the recovery cycle for a late channel', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  const original = f.player(f.late); await f.poll(14);
  assert.equal(original.isDestroyed(), true);
  f.points.set(f.late, 110); await f.poll(1);
  const player = f.player(f.late); await f.poll(90);
  assert.equal(f.player(f.late), player);
  assert.equal(player.isDestroyed(), false);
});

test('recovering multiple late channels is spaced out without touching an earning stream', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late, f.secondLate);
  const first = f.player(f.late), second = f.player(f.secondLate), earning = f.player(f.earning);
  await f.poll(14);
  assert.equal(first.isDestroyed(), true);
  assert.equal(second.isDestroyed(), false);
  await f.poll();
  assert.equal(second.isDestroyed(), false);
  await f.poll(1);
  assert.equal(second.isDestroyed(), true);
  assert.equal(f.player(f.earning), earning);
});

test('automatic initial-credit recovery respects age confirmation and disabled channel points', async () => {
  const f = fixture(); await f.poll(); f.gated.add(f.late); f.disabled.add(f.secondLate);
  await f.startLate(f.late, f.secondLate);
  const gated = f.player(f.late), disabled = f.player(f.secondLate);
  await f.poll(14);
  assert.equal(f.player(f.late), gated);
  assert.equal(f.player(f.secondLate), disabled);
});

test('turning farming off cancels a pending late-channel recovery', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  await f.app.handlers.get('farming:set')(f.app.event(), false);
  await f.poll(14);
  assert.equal(f.player(f.late), undefined);
  assert.equal(f.app.apiExports.snapshot().channels.some(channel => channel.watching), false);
});

test('a late channel that earns before the grace period keeps its original player', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  const player = f.player(f.late);
  f.points.set(f.late, 110); await f.poll(5); await f.poll(90);
  assert.equal(f.player(f.late), player);
  assert.equal(player.isDestroyed(), false);
});

test('an API outage does not restart a player merely because its cached balance is unchanged', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  const player = f.player(f.late);
  f.app.session.fetch = async () => new Response('{}', { status: 503 });
  await f.poll(14);
  assert.equal(f.player(f.late), player);
  assert.equal(player.isDestroyed(), false);
});

test('pending session verification cannot trigger late-channel recovery', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  const player = f.player(f.late);
  f.app.session.cookies.emit('changed', {}, { name: 'auth-token', domain: '.twitch.tv' }, 'overwrite', true);
  await f.poll(14);
  assert.equal(f.player(f.late), player);
  assert.equal(player.isDestroyed(), false);
  assert.equal(f.app.apiExports.snapshot().sessionChecking, true);
});

test('a partial API response cannot turn a cached balance into a failed-credit recovery', async () => {
  const f = fixture(); await f.poll(); await f.startLate(f.late);
  const player = f.player(f.late);
  f.unavailable.add(f.late); await f.poll(14);
  assert.equal(f.player(f.late), player);
  assert.equal(player.isDestroyed(), false);
  f.unavailable.clear(); await f.poll(1);
  assert.equal(player.isDestroyed(), true);
});

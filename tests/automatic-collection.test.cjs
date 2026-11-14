'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');

test('opening the app resumes all four saved paused profiles without changing collection preferences', async () => {
  const app = loadApp({ configSeed: { configVersion: 2, farming: false, maxWatchers: 3, rotation: false, lowQuality: false } });
  for (const runtime of app.runtimes) {
    const session = app.sessions.get(runtime.partition);
    session.cookies.get = async () => [];
    session.fetch = async () => new Response('{}', { status: 401 });
  }
  await app.start();
  for (const runtime of app.runtimes) {
    const state = runtime.snapshot();
    assert.equal(state.farming, true);
    assert.equal(state.maxWatchers, 3);
    assert.equal(state.rotation, false);
    assert.equal(state.lowQuality, false);
    assert.equal(state.loggedIn, false);
    assert.equal(state.channels.some(channel => channel.watching), false, 'collection still requires a connected account');
  }
  const saved = app.state.writes.filter(([file]) => file.endsWith('config.json'));
  assert(saved.length >= 4);
  assert(saved.every(([, json]) => JSON.parse(json).farming === true));
});

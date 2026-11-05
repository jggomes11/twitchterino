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


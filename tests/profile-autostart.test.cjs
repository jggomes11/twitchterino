'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp } = require('./helpers/app.cjs');

test('Windows autostart resumes the selected account without the launcher environment', async () => {
  const profile = path.resolve('/fake/Users/Conta One/Twitchterino-Profiles/Conta-1');
  const app = loadApp({ env: { TWITCHTERINO_DATA: profile } });
  assert.equal((await app.handlers.get('autostart:set')(app.event(), true)).openAtLogin, true);
  const item = app.state.loginItems.at(-1);
  const argument = item.args.find(value => value.startsWith('--twitchterino-data='));
  assert.equal(argument, '--twitchterino-data=' + profile);
  const restarted = loadApp({ argv: item.args });
  assert.equal(restarted.app.getPath('userData'), profile);
});

test('one account autostart toggle preserves the other account registration', async () => {
  const loginRegistry = new Map();
  const first = loadApp({ env: { TWITCHTERINO_DATA: '/fake/profiles/Conta-1' }, loginRegistry });
  const second = loadApp({ env: { TWITCHTERINO_DATA: '/fake/profiles/Conta-2' }, loginRegistry });
  await first.handlers.get('autostart:set')(first.event(), true);
  await second.handlers.get('autostart:set')(second.event(), true);
  assert.notEqual(first.state.loginItems.at(-1).name, second.state.loginItems.at(-1).name);
  await second.handlers.get('autostart:set')(second.event(), false);
  assert.equal(first.apiExports.snapshot().openAtLogin, true);
  assert.equal(second.apiExports.snapshot().openAtLogin, false);
  const reopened = loadApp({ argv: first.state.loginItems[0].args, loginRegistry });
  assert.equal(reopened.apiExports.snapshot().openAtLogin, true);
});

test('default profile keeps its original startup entry and selected explicit data wins ambient data', async () => {
  const app = loadApp();
  await app.handlers.get('autostart:set')(app.event(), true);
  assert.equal(app.state.loginItems[0].name, undefined);
  assert.deepEqual(Array.from(app.state.loginItems[0].args), ['--hidden']);
  const explicit = loadApp({ env: { TWITCHTERINO_DATA: '/fake/ambient' }, argv: ['--twitchterino-data=/fake/selected'] });
  assert.equal(explicit.app.getPath('userData'), '/fake/selected');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('disconnecting a background card retains its target while the selected profile changes', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const calls = [];
  let bridge, finish;
  vm.runInNewContext(source, {
    process: { isMainFrame: true, argv: ['--app-ui-url=file:///ui.html'] },
    location: { href: 'file:///ui.html' },
    require: () => ({
      contextBridge: { exposeInMainWorld(_name, api) { bridge = api; } },
      ipcRenderer: {
        on() {},
        invoke: async (channel, value) => {
          calls.push({ channel, value });
          if (channel === 'account:select') return { accountId: value };
          if (value.command === 'logout') return new Promise(resolve => { finish = resolve; });
          return { accountId: value.accountId, result: { channels: [] } };
        },
      },
    }),
  });
  await bridge.selectAccount('account-3');
  const pending = bridge.logoutAccount('account-2');
  await bridge.selectAccount('account-4');
  finish({ accountId: 'account-2', result: { loggedIn: false, channels: [] } });
  assert.equal((await pending).accountId, 'account-2');
  await bridge.setFarming(false);
  assert.equal(calls[1].channel, 'account:command');
  assert.equal(calls[1].value.accountId, 'account-2');
  assert.equal(calls[1].value.command, 'logout');
  assert.equal(calls[1].value.args.length, 0);
  assert.equal(calls.at(-1).value.accountId, 'account-4');
  const before = calls.length;
  await assert.rejects(bridge.logoutAccount('account-5'), /Invalid account/);
  assert.equal(calls.length, before);
});

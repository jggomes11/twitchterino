'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');

function fixture(state = {}) {
  const filename = path.resolve(__dirname, '../scripts/validate-profiles.cjs');
  const source = fs.readFileSync(filename, 'utf8').split('\n(async () => {')[0];
  const context = { require: createRequire(filename), __dirname: path.dirname(filename), module: { exports: {} },
    process: { platform: 'win32', argv: [], env: {} }, console, Date, setTimeout, clearTimeout, AbortSignal, URL,
    fetch: async () => ({ json: async () => [{ type: 'page', url: 'file:///renderer/index.html', webSocketDebuggerUrl: 'ws://fake/ui' },
      { type: 'page', url: 'https://www.twitch.tv/directory', webSocketDebuggerUrl: 'ws://fake/api' }] }) };
  context.WebSocket = class extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(text) { const message = JSON.parse(text); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id: message.id, result: { result: { value: state } } }),
    }))); }
    close() { this.dispatchEvent(new Event('close')); }
  };
  vm.runInNewContext(source + '\nmodule.exports = { openClient, quitProfile, temporary };', context, { filename });
  return { ...context.module.exports, clean() { fs.rmSync(context.module.exports.temporary, { recursive: true, force: true }); } };
}

test('native fixture rejects placeholder booleans before metadata is loaded', async () => {
  const f = fixture({ loggedIn: false, watchAll: false, maxWatchers: 2, rotation: true, farming: true, autoChest: true,
    channels: [{ slug: 'tester', live: false, rewardsLoaded: false }] });
  try { await assert.rejects(f.openClient({ child: { exitCode: null, signalCode: null, port: 1 } }, 25), /unavailable|ready/); }
  finally { f.clean(); }
});

test('native fixture rejects collection or chest defaults disabled after metadata loads', async () => {
  for (const field of ['farming', 'autoChest']) {
    const f = fixture({ loggedIn: false, watchAll: false, maxWatchers: 2, rotation: true, farming: true, autoChest: true,
      channels: [{ slug: 'tester', live: true, rewardsLoaded: true, error: null }], [field]: false });
    try { await assert.rejects(f.openClient({ child: { exitCode: null, signalCode: null, port: 1 } }, 25)); }
    finally { f.clean(); }
  }
});

test('native lifecycle cannot certify forced termination after a failed quit command', async () => {
  const f = fixture();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const client = { call: async () => { throw new Error('quit transport failed'); }, close() {} };
  try {
    await assert.rejects(f.quitProfile({ child, ui: client, api: client }, 25), /graceful|quit/);
    assert.equal(child.exitCode, null, 'Failure must be left for explicit finally cleanup');
    assert.equal(child.signalCode, null);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); f.clean(); }
});

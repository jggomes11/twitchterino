'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('account fixture does not wait for a compositor screenshot without an output request', async () => {
  const { captureAccountScreenshot } = require('./electron-fixture-support.cjs');
  const debuggerApi = { sendCommand() { throw new Error('A hidden renderer cannot supply a frame'); } };
  await captureAccountScreenshot(debuggerApi, 'fixture', undefined);
});

test('requested account screenshots fail with the pending stage when the compositor stops responding', async () => {
  const { captureAccountScreenshot } = require('./electron-fixture-support.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kickterino-screenshot-test-'));
  try {
    await assert.rejects(captureAccountScreenshot({ sendCommand: () => new Promise(() => {}) }, 'fixture', directory, 15), /account screenshot.*timed out/i);
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('explicit account screenshot requests preserve the captured PNG evidence', async () => {
  const { captureAccountScreenshot } = require('./electron-fixture-support.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kickterino-screenshot-test-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=', 'base64');
  try {
    await captureAccountScreenshot({ sendCommand: async method => {
      assert.equal(method, 'Page.captureScreenshot');
      return { data: png.toString('base64') };
    } }, 'fixture', directory);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'fixture-account-controls.png')), png);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

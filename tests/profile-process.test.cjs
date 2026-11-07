'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { isRunning, stop } = require('../scripts/profile-process.cjs');

test('profile cleanup recognizes actual process termination by either exit code or signal', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    assert.equal(isRunning(child), true);
    await stop(child, 1000);
    assert.equal(isRunning(child), false);
    assert(child.exitCode !== null || child.signalCode !== null);
    await stop(child, 1000);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
});

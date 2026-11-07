'use strict';
const assert = require('node:assert/strict');
const { isRunning } = require('./profile-process.cjs');
const { evaluate } = require('./cdp-client.cjs');
function assertAccountReady(state, accountId) {
  assert.equal(state?.accountId, accountId);
  assert.deepEqual(state.accounts.map(a => a.id), ['account-1', 'account-2', 'account-3', 'account-4']);
  assert(state.channels.length > 0 && state.channels.every(c => c.rewardsLoaded === true && !c.error), 'Real metadata must be loaded');
  assert.equal(state.loggedIn, false, 'Native fixture must not use real accounts');
  assert.equal(state.watchAll, false); assert.equal(state.maxWatchers, 2); assert.equal(state.rotation, true);
  assert.equal(state.farming, true); assert.equal(state.autoChest, true);
}
async function quitApplication(client, timeoutMs = 10000) {
  if (client.ui && isRunning(client.child)) { try { await evaluate(client.ui, 'window.tt.quit()'); } catch {} }
  const deadline = Date.now() + timeoutMs;
  while (isRunning(client.child) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert(!isRunning(client.child), 'Application did not quit gracefully');
  assert.equal(client.child.exitCode, 0, 'Application did not exit successfully after quit');
}
module.exports = { assertAccountReady, quitApplication };

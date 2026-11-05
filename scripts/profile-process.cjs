'use strict';

const isRunning = child => child.exitCode === null && child.signalCode === null;

async function stop(child, timeoutMs = 5000) {
  if (!isRunning(child)) return;
  child.kill();
  const deadline = Date.now() + timeoutMs;
  while (isRunning(child) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (isRunning(child)) throw new Error('Test process did not stop within its deadline');
}

module.exports = { isRunning, stop };

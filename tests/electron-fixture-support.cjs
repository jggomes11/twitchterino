'use strict';
const fs = require('node:fs');
const path = require('node:path');

function checkpoint(stage) {
  const line = '[Electron fixture] ' + stage + '\n';
  // A file survives native Windows GUI stdout/console attachment differences.
  if (process.env.SECURITY_FIXTURE_PROGRESS) fs.appendFileSync(process.env.SECURITY_FIXTURE_PROGRESS, line);
  console.log(line.trimEnd());
}

async function within(promise, label, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function captureAccountScreenshot(debuggerApi, name, directory, timeoutMs = 5000) {
  // Hidden native windows need not have a compositor frame. Ordinary CI asserts
  // geometry and behavior without waiting for an unrequested screenshot.
  if (!directory) return;
  checkpoint('account screenshot');
  const shot = await within(debuggerApi.sendCommand('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: 1132, height: 240, scale: 1 }, captureBeyondViewport: true,
  }), 'Account screenshot', timeoutMs);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name + '-account-controls.png'), Buffer.from(shot.data, 'base64'));
}

module.exports = { checkpoint, within, captureAccountScreenshot };

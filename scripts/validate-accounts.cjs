'use strict';
// One actual Windows application, four empty session partitions. Fake cookies only.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { isRunning } = require('./profile-process.cjs');
const { connect, evaluate } = require('./cdp-client.cjs');
const { assertAccountReady, quitApplication } = require('./account-fixture.cjs');
const pkg = require('../package.json');
assert.equal(process.platform, 'win32', 'Validate account partitions on native Windows');
const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'release-output/portable/app/Twitchterino.exe'));
const reportPath = path.resolve(process.argv[3] || path.join(root, 'release-output/account-validation.json'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'twitchterino accounts validation-'));
const profile = path.join(temporary, 'one application');
const children = [], connections = new Set();
const report = { version: pkg.version, sourceSha: process.env.VALIDATION_SOURCE_SHA || 'local', passed: false,
  scope: 'one native Windows application, four unauthenticated partitions; no real login or points', checks: [] };
const markerUrl = 'https://profile-isolation.invalid/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function until(action, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs; let last = '';
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; } catch (error) { last = error.message; }
    await pause(200);
  }
  throw new Error(label + ' timed out' + (last ? ': ' + last : ''));
}
function launch(port) {
  const logFile = path.join(temporary, `app-${children.length}.log`), log = fs.openSync(logFile, 'w');
  let child;
  try {
    child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], {
      env: { ...process.env, TWITCHTERINO_DATA: profile, ELECTRON_NO_ATTACH_CONSOLE: '1' },
      stdio: ['ignore', log, log],
    });
  } finally { fs.closeSync(log); }
  child.port = port; child.logFile = logFile;
  child.on('error', error => { child.launchError = error.message; }); children.push(child); return child;
}
async function open(child) {
  const targets = () => fetch(`http://127.0.0.1:${child.port}/json/list`, { signal: AbortSignal.timeout(1500) }).then(r => r.json());
  const target = await until(async () => {
    assert(isRunning(child), 'Application exited before UI startup');
    return (await targets()).find(t => t.type === 'page' && /\/renderer\/index\.html$/.test(t.url));
  }, 'Main UI');
  const ui = await connect(target.webSocketDebuggerUrl); connections.add(ui); await ui.call('Runtime.enable');
  await until(async () => {
    const state = await evaluate(ui, 'window.tt && window.tt.getState()');
    return state?.accounts?.length === 4 && await evaluate(ui, 'document.querySelectorAll("#accounts button").length === 4');
  }, 'Four account controls');
  return {child, ui, targets};
}
async function select(client, index) {
  const id = 'account-' + index;
  await evaluate(client.ui, `document.querySelector('[data-account-id="${id}"]').click()`);
  return until(async () => {
    const state = await evaluate(client.ui, 'window.tt.getState()');
    assertAccountReady(state, id); return state;
  }, 'Account ' + index + ' metadata/defaults', 65000);
}
async function openSession(client, boundIds = new Set()) {
  // showLogin uses the existing official login command, not a privileged test hook.
  await evaluate(client.ui, 'void window.tt.showLogin().catch(() => {}); true');
  return until(async () => {
    for (const target of await client.targets()) {
      if (boundIds.has(target.id) || target.type !== 'page' || !target.url.startsWith('https://www.twitch.tv/')) continue;
      const api = await connect(target.webSocketDebuggerUrl); connections.add(api);
      try {
        if (await evaluate(api, 'document.visibilityState === "visible"')) return {id: target.id, api};
      } catch {}
      api.close(); connections.delete(api);
    }
  }, 'Visible source account login window');
}
async function markers(api) {
  const result = await api.call('Network.getCookies', {urls: [markerUrl]});
  return result.cookies.filter(c => c.name === 'account-isolation-marker').map(c => c.value);
}
(async () => {
  let current;
  try {
    assert(fs.existsSync(executable), 'Missing packaged executable');
    current = await open(launch(await freePort()));
    const apis = [];
    for (let index = 1; index <= 4; index++) {
      await select(current, index);
      const source = await openSession(current, new Set(apis.map(a => a.id)));
      assert(!apis.some(a => a.id === source.id), 'Two slots selected the same login window');
      const result = await source.api.call('Network.setCookie', {url: markerUrl, name: 'account-isolation-marker', value: 'FAKE_ACCOUNT_' + index, expires: Date.now() / 1000 + 86400});
      assert.equal(result.success, true); apis.push(source);
      await source.api.call('Page.navigate', {url:'https://www.twitch.tv/robots.txt'});
    }
    for (let index = 0; index < 4; index++) assert.deepEqual(await markers(apis[index].api), ['FAKE_ACCOUNT_' + (index + 1)]);
    assert.equal((await current.targets()).filter(t => /\/renderer\/index\.html$/.test(t.url)).length, 1);
    report.checks.push('one main UI with four ready account controls', 'four distinct login windows and session cookie jars');
    await select(current, 2);
    await evaluate(current.ui, 'window.tt.setNotifyChat(false)');
    await select(current, 3);
    assert.equal((await evaluate(current.ui, 'window.tt.getState()')).notifyChat, true);
    await select(current, 2);
    assert.equal((await evaluate(current.ui, 'window.tt.getState()')).notifyChat, false);
    report.checks.push('selected-slot settings do not change other slots');
    const duplicate = launch(await freePort());
    await until(() => !isRunning(duplicate), 'Second launch exits', 15000);
    assert.equal(duplicate.exitCode, 0); assert(isRunning(current.child));
    assert.deepEqual(current.ui.exceptions, []);
    report.checks.push('second launch focuses existing application and exits cleanly');
    await quitApplication(current);
    current = await open(launch(await freePort()));
    const reopenedApis = [];
    for (let index = 1; index <= 4; index++) {
      await select(current, index);
      const source = await openSession(current, new Set(reopenedApis.map(a => a.id)));
      reopenedApis.push(source);
      assert.deepEqual(await markers(source.api), ['FAKE_ACCOUNT_' + index]);
      await source.api.call('Page.navigate', {url:'https://www.twitch.tv/robots.txt'});
    }
    await select(current, 2);
    assert.equal((await evaluate(current.ui, 'window.tt.getState()')).notifyChat, false);
    assert.deepEqual(current.ui.exceptions, []);
    await quitApplication(current);
    report.checks.push('natural quit and reopen retain all four partition cookies and slot settings');
    report.passed = true;
  } catch (error) {
    report.error = error.message; process.exitCode = 1;
  } finally {
    // Forced cleanup is never accepted as proof of a successful natural quit.
    for (const connection of connections) connection.close();
    for (const child of children) if (isRunning(child)) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', timeout: 10000});
    fs.mkdirSync(path.dirname(reportPath), {recursive: true});
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    for (let index = 0; index < children.length; index++) if (fs.existsSync(children[index].logFile)) fs.copyFileSync(children[index].logFile, reportPath + `.app-${index}.log`);
    try { fs.rmSync(temporary, {recursive: true, force: true}); } catch {}
    console.log(JSON.stringify(report));
  }
})();

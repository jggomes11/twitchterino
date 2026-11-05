'use strict';
// Desktop validation uses an isolated empty profile. It never supplies credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const pkg = require('../package.json');

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  return index < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, index), arg.slice(index + 1)];
}));
const windows = process.platform === 'win32';
if (!windows && !options['allow-non-windows']) throw new Error('Run the Windows validation on native Windows.');
const root = path.resolve(__dirname, '..');
const executable = path.resolve(options.executable || path.join(root, 'dist', 'win-unpacked', pkg.productName + '.exe'));
const output = path.resolve(options.output || 'validation-output/evidence');
const namespace = pkg.name === 'twitchterino' ? 'tt' : 'kick';
const platformHost = pkg.name === 'twitchterino' ? 'twitch.tv' : 'kick.com';
const variable = pkg.name === 'twitchterino' ? 'TWITCHTERINO_DATA' : 'KICKTERINO_DATA';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), pkg.name + '-desktop-validation-'));
fs.mkdirSync(output, { recursive: true });
const defaults = require('./validation-config.cjs')(root, pkg.version);
const channels = defaults.channels;
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(defaults));

const report = {
  product: pkg.productName, os: process.platform, osRelease: os.release(),
  sourceSha: process.env.VALIDATION_SOURCE_SHA || 'local-preflight',
  scope: 'unauthenticated UI and official page navigation only',
  accountLogin: 'not performed; user authentication required',
  pointAccrual: 'not performed; authenticated live channel required',
  checks: [], loginPage: { opened: false }, passed: false,
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let main;
let login;
let childLog = '';

async function until(action, description, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    if (child && child.exitCode !== null) throw new Error('Application exited before ' + description);
    try { const result = await action(); if (result) return result; } catch (error) { last = error.message; }
    await pause(250);
  }
  throw new Error('Timed out waiting for ' + description + (last ? ': ' + last : ''));
}

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let next = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Debug connection timed out')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debug connection failed')); }, { once: true });
  });
  const exceptions = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id); pending.delete(message.id);
      clearTimeout(callback.timer);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(String(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text).slice(0, 800));
    }
  });
  socket.addEventListener('close', () => {
    for (const callback of pending.values()) { clearTimeout(callback.timer); callback.reject(new Error('Debug connection closed')); }
    pending.clear();
  });
  return {
    exceptions,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debug command timed out: ' + method)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(connection, expression) {
  const result = await connection.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description || result.exceptionDetails.text).slice(0, 800));
  return result.result.value;
}
async function screenshot(connection, filename) {
  const result = await connection.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, filename), Buffer.from(result.data, 'base64'));
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

(async () => {
  try {
    assert(fs.existsSync(executable), 'Packaged executable does not exist');
    const port = await freePort();
    const args = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port];
    if (!windows) args.push('--no-sandbox', '--ozone-platform=headless', '--disable-gpu');
    child = spawn(executable, args, {
      env: { ...process.env, [variable]: profile }, windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { childLog = (childLog + String(chunk)).slice(-30000); });
    child.stderr.on('data', chunk => { childLog = (childLog + String(chunk)).slice(-30000); });
    child.on('error', error => { childLog += error.message; });
    const targets = async () => {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list');
      return response.json();
    };
    const target = await until(async () => (await targets()).find(item => item.type === 'page' && /\/renderer\/index\.html$/.test(item.url)), 'main UI');
    main = await connect(target.webSocketDebuggerUrl);
    await main.call('Runtime.enable');
    await main.call('Page.enable');
    await until(() => evaluate(main, 'Boolean(window.' + namespace + ' && document.querySelector("#btn-login") && document.querySelector("#composer"))'), 'preload and UI controls');
    const state = await evaluate(main, 'window.' + namespace + '.getState()');
    assert.equal(state.loggedIn, false, 'CI profile must remain unauthenticated');
    assert.equal(state.farming, false);
    assert.equal(state.maxWatchers, 1);
    assert.equal(state.rotation, false);
    assert.equal(state.channels.length, channels.length);
    assert.equal(await evaluate(main, 'document.title'), pkg.productName);
    report.checks.push('packaged application opened', 'expected UI and guarded preload loaded', 'IPC getState passed on the actual platform');
    report.layout = await evaluate(main, '({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,screenWidth:screen.availWidth,screenHeight:screen.availHeight})');
    await screenshot(main, 'main.png');

    await evaluate(main, 'document.querySelector("#btn-settings")?.click()');
    await evaluate(main, 'document.querySelector("#notify-bonus").click()');
    await until(async () => (await evaluate(main, 'window.' + namespace + '.getState()')).notifyBonus === true, 'UI checkbox IPC');
    await evaluate(main, 'document.querySelector("#notify-bonus").click()');
    await evaluate(main, '(() => {const input=document.querySelector("#max-watchers");input.value="2";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await until(async () => (await evaluate(main, 'window.' + namespace + '.getState()')).maxWatchers === 2, 'numeric UI IPC');
    await evaluate(main, '(() => {const input=document.querySelector("#max-watchers");input.value="1";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
    report.checks.push('checkbox changed through the real UI', 'numeric input string accepted through the real UI');
    await screenshot(main, 'settings.png');
    assert.deepEqual(main.exceptions, [], 'Unexpected main UI JavaScript exception');

    await evaluate(main, 'document.querySelector("#btn-login").click()');
    const loginTarget = await until(async () => (await targets()).find(item => {
        try { const url = new URL(item.url); return item.type === 'page' && url.protocol === 'https:' && (url.hostname === platformHost || url.hostname.endsWith('.' + platformHost)) && url.pathname !== '/robots.txt'; }
        catch { return false; }
      }), 'official login navigation', 20000);
    if (loginTarget) {
      login = await connect(loginTarget.webSocketDebuggerUrl);
      await login.call('Page.enable');
      let formReady = false;
      try {
        await until(() => evaluate(login, 'Array.from(document.querySelectorAll("input")).some(input => ["email", "password", "text"].includes(input.type) && input.getBoundingClientRect().width > 0 && input.getBoundingClientRect().height > 0 && input.type !== "search")'), 'login form controls', 30000);
        formReady = true;
      } catch { /* Page navigation can be verified without authenticating or claiming form readiness. */ }
      const loginState = await evaluate(login, '({url:location.origin+location.pathname,title:document.title,passwordInput:Boolean(document.querySelector("input[type=password]")),appBridge:Boolean(window.' + namespace + ' && typeof window.' + namespace + '.getState==="function" && typeof window.' + namespace + '.showLogin==="function")})');
      assert.equal(loginState.appBridge, false, 'Remote login page received the application bridge');
      report.loginPage = { opened: true, ...loginState, formReady, authenticated: false };
      report.checks.push('official login window has no application IPC bridge');
      await screenshot(login, 'login.png');
    }
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (main) { try { await screenshot(main, 'failure.png'); } catch {} }
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'desktop-result.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'application-startup.log'), childLog);
    if (main) { try { await evaluate(main, 'window.' + namespace + '.quit()'); } catch {} }
    if (login) login.close();
    if (main) main.close();
    if (child && child.exitCode === null) {
      await pause(1000);
      if (child.exitCode === null) {
        if (windows) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGTERM');
      }
    }
    await pause(500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 }); } catch {}
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });


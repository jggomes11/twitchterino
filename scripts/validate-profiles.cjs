'use strict';
// Native portable-process test with four empty profiles; no account or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { isRunning, stop } = require('./profile-process.cjs');
const pkg = require('../package.json');

assert.equal(process.platform, 'win32', 'Validate portable profile processes on native Windows');
const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'release-output', 'portable', 'app', 'Twitchterino.exe'));
const reportPath = path.resolve(process.argv[3] || path.join(root, 'release-output', 'profile-validation.json'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'twitchterino profile validation-'));
const children = [];
const profiles = [];
const report = { version: pkg.version, scope: 'four empty portable profiles; no account or point awards', graphics: 'software rendering in the multi-process CI fixture', passed: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map();
  let next = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Profile debug connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Profile debug connection failed')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)), operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id); clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error('Profile debug command failed'));
    else operation.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error('Profile debug connection closed')); }
    pending.clear();
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Profile debug command timed out')); }, 5000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}
async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, 'Profile UI operation failed');
  return result.result.value;
}
async function openClient(profile, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert(isRunning(profile.child), 'Profile exited before its UI was ready');
    try {
      const targets = await fetch('http://127.0.0.1:' + profile.child.port + '/json/list', { signal: AbortSignal.timeout(1000) }).then(r => r.json());
      const ui = targets.find(t => t.type === 'page' && /\/renderer\/index\.html$/.test(t.url));
      const api = targets.find(t => t.type === 'page' && t.url.startsWith('https://www.twitch.tv/'));
      if (ui && api) {
        profile.ui = await connect(ui.webSocketDebuggerUrl);
        profile.api = await connect(api.webSocketDebuggerUrl);
        const state = await evaluate(profile.ui, 'window.tt && window.tt.getState()');
        if (state?.channels?.length && state.channels.every(channel => channel.rewardsLoaded === true && !channel.error)) {
          assert.equal(state.loggedIn, false, 'A CI profile must have no real account');
          assert.equal(state.watchAll, false); assert.equal(state.maxWatchers, 2); assert.equal(state.rotation, true);
          assert.equal(state.farming, true); assert.equal(state.autoChest, true);
          return;
        }
      }
    } catch (error) { profile.clientError = error.message; }
    profile.ui?.close(); profile.api?.close();
    await pause(250);
  }
  throw new Error('Profile UI/session unavailable: ' + (profile.clientError || 'no target'));
}
const markerUrl = 'https://profile-isolation.invalid/';
async function marker(profile) {
  const result = await profile.api.call('Network.getCookies', { urls: [markerUrl] });
  return result.cookies.filter(c => c.name === 'profile-isolation-marker').map(c => c.value);
}
async function quitProfile(profile, timeoutMs = 10000) {
  if (profile.ui && isRunning(profile.child)) {
    try { await evaluate(profile.ui, 'window.tt.quit()'); } catch {}
    const deadline = Date.now() + timeoutMs;
    while (isRunning(profile.child) && Date.now() < deadline) await pause(100);
  }
  // CDP may close before acknowledging quit; an actual clean exit is the proof.
  assert(!isRunning(profile.child), 'Application did not quit gracefully');
  assert.equal(profile.child.exitCode, 0, 'Application did not exit successfully after quit');
  profile.ui?.close(); profile.api?.close();
}
function launch(profile, port, argumentOnly = false) {
  console.log('Profile fixture: launch requested at ' + new Date().toISOString() + ', free MiB ' + Math.round(os.freemem() / 1048576));
  const env = { ...process.env, TWITCHTERINO_DATA: profile, TWITCHTERINO_DEBUG: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' };
  const args = ['--disable-gpu', '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port];
  if (argumentOnly) { delete env.TWITCHTERINO_DATA; args.push('--twitchterino-data=' + profile); }
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.port = port;
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { child.output = (child.output + data).slice(0, 6000); });
  child.on('error', error => { child.launchError = error.message; });
  children.push(child);
  console.log('Profile fixture: launched process ' + child.pid);
  return child;
}

(async () => {
  try {
    assert(fs.existsSync(executable), 'Missing actual portable executable');
    for (let index = 1; index <= 4; index++) {
      const profile = path.join(temporary, 'Conta-' + index);
      assert(!fs.existsSync(profile), 'First launch must create its own profile directory');
      const child = launch(profile, await freePort());
      const client = { path: profile, child };
      profiles.push(client);
      const startupDeadline = Date.now() + 30000;
      while (!child.output.includes('profile initialization complete')) {
        assert(!child.launchError && isRunning(child), 'A profile exited during initialization');
        assert(Date.now() < startupDeadline, 'A profile did not complete initialization');
        await pause(250);
      }
      console.log('Profile fixture: initialization complete for process ' + child.pid);
      await openClient(client);
      assert.equal((await evaluate(client.ui, 'window.tt.getState()')).openAtLogin, false, 'Another profile changed this startup entry');
      assert.equal((await evaluate(client.ui, 'window.tt.setAutostart(true)')).openAtLogin, true, 'Profile startup entry did not retain its arguments');
      assert.deepEqual(await marker(client), [], 'A new profile inherited another profile cookie');
      const written = await client.api.call('Network.setCookie', { url: markerUrl, name: 'profile-isolation-marker',
        value: 'FAKE_PROFILE_' + index, httpOnly: true, secure: true, expires: Math.floor(Date.now() / 1000) + 3600 });
      assert.equal(written.success, true);
      assert.deepEqual(await marker(client), ['FAKE_PROFILE_' + index]);
      console.log('Profile fixture: isolated cookie and two-stream configuration verified for profile ' + index);
      if (index === 1) {
        const duplicate = launch(profile, await freePort());
        const deadline = Date.now() + 30000;
        while (isRunning(duplicate) && Date.now() < deadline) await pause(100);
        assert.equal(duplicate.exitCode, 0, 'A duplicate failed even with only one profile open');
        assert(isRunning(child), 'Single-profile duplicate stopped the original');
        report.singleProfileDuplicateExited = true;
        console.log('Profile fixture: duplicate control with one profile passed');
      }
    }
    const deadline = Date.now() + 60000;
    for (;;) {
      for (const profile of profiles) {
        assert(!profile.child.launchError, 'Portable process failed to start');
        assert(isRunning(profile.child), 'A separate profile exited prematurely');
      }
      const ready = profiles.every(profile => {
        try { return JSON.parse(fs.readFileSync(path.join(profile.path, 'config.json'), 'utf8')).seenDefaults.length > 0; }
        catch { return false; }
      });
      if (ready) break;
      assert(Date.now() < deadline, 'Four profiles did not finish application startup');
      await pause(250);
    }
    await pause(3000);
    assert(profiles.every(profile => isRunning(profile.child)), 'Four profiles did not stay open concurrently');
    console.log('Profile fixture: four first-use profiles loaded and remain open');
    for (let index = 0; index < profiles.length; index++) assert.deepEqual(await marker(profiles[index]), ['FAKE_PROFILE_' + (index + 1)]);
    report.cookieIsolation = true;
    report.twoStreamDefaults = true;
    const duplicate = launch(profiles[0].path, await freePort());
    const duplicateDeadline = Date.now() + 30000;
    while (isRunning(duplicate) && !duplicate.launchError && Date.now() < duplicateDeadline) await pause(250);
    assert(!duplicate.launchError, 'Duplicate launch failed before testing the lock');
    assert.equal(duplicate.exitCode, 0, 'Opening an existing profile did not exit cleanly');
    console.log('Profile fixture: duplicate profile exited cleanly');
    assert(profiles.every(profile => isRunning(profile.child)), 'Duplicate launch stopped an existing profile');
    await quitProfile(profiles[0]);
    await pause(1000);
    assert(profiles.slice(1).every(profile => isRunning(profile.child)), 'Closing one profile stopped another');
    const reopened = { path: profiles[0].path, child: launch(profiles[0].path, await freePort(), true) };
    profiles[0] = reopened;
    await openClient(reopened);
    assert.equal((await evaluate(reopened.ui, 'window.tt.getState()')).openAtLogin, true, 'Restarted account lost its own startup entry');
    assert.deepEqual(await marker(reopened), ['FAKE_PROFILE_1'], 'Reopened profile did not retain its own cookie');
    for (let index = 1; index < profiles.length; index++) assert.deepEqual(await marker(profiles[index]), ['FAKE_PROFILE_' + (index + 1)]);
    report.profileReopened = true;
    report.cookiePersistedAfterRestart = true;
    report.windowsAutostartIsolated = true;
    report.simultaneousProfiles = profiles.length;
    report.firstLaunchCreatedProfiles = true;
    report.portableFormat = 'directory-zip';
    report.closingOnePreservedOthers = true;
    report.sameProfileSecondLaunchExited = true;
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error.message;
    const capture = path.join(path.dirname(reportPath), 'profile-desktop.png');
    fs.mkdirSync(path.dirname(capture), { recursive: true });
    const ids = children.map(child => child.pid).filter(Number.isInteger).join(',');
    const diagnostic = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Responding,MainWindowTitle,WorkingSet64 | ConvertTo-Json -Compress; ` +
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ` +
      `$CaptureBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen; ` +
      `$CaptureImage = New-Object System.Drawing.Bitmap($CaptureBounds.Width, $CaptureBounds.Height); ` +
      `$CaptureGraphics = [System.Drawing.Graphics]::FromImage($CaptureImage); ` +
      `$CaptureGraphics.CopyFromScreen($CaptureBounds.Location, [System.Drawing.Point]::Empty, $CaptureBounds.Size); ` +
      `$CaptureImage.Save('${capture.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); ` +
      `$CaptureGraphics.Dispose(); $CaptureImage.Dispose();`,
    ], { encoding: 'utf8', timeout: 10000 });
    console.error('Native process inspection: ' + diagnostic.stdout?.slice(0, 4000));
    report.processInspection = { status: diagnostic.status, errorCode: diagnostic.error?.code || null };
    report.diagnostics = children.map(child => ({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, launchError: child.launchError, output: child.output }));
    console.error(JSON.stringify(report.diagnostics));
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    for (const profile of profiles) {
      if (profile.ui && isRunning(profile.child)) {
        try { assert.equal((await evaluate(profile.ui, 'window.tt.setAutostart(false)')).openAtLogin, false); }
        catch (error) { report.passed = false; report.error ||= error.message; console.error(error.message); process.exitCode = 1; }
      }
      try { await quitProfile(profile); } catch (error) { report.passed = false; report.error ||= error.message; console.error(error.message); process.exitCode = 1; }
    }
    for (const child of children) {
      try { await stop(child); }
      catch (error) { console.error(error.message); process.exitCode = 1; }
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    try { fs.rmSync(temporary, { recursive: true, force: true }); }
    catch { console.log('Empty temporary profiles remain in the disposable runner.'); }
    console.log('Profile fixture: cleanup complete');
  }
})();

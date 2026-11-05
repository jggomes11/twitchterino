'use strict';
// Native portable-process test with four empty profiles; no account or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { isRunning, stop } = require('./profile-process.cjs');
const pkg = require('../package.json');

assert.equal(process.platform, 'win32', 'Validate portable profile processes on native Windows');
const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'release-output', 'portable', 'app', 'Twitchterino.exe'));
const reportPath = path.resolve(process.argv[3] || path.join(root, 'release-output', 'profile-validation.json'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'twitchterino-profile-validation-'));
const children = [];
const report = { version: pkg.version, scope: 'four empty portable profiles; no account or point awards', graphics: 'software rendering in the multi-process CI fixture', passed: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(profile) {
  console.log('Profile fixture: launch requested at ' + new Date().toISOString() + ', free MiB ' + Math.round(os.freemem() / 1048576));
  const child = spawn(executable, ['--disable-gpu'], { env: { ...process.env, TWITCHTERINO_DATA: profile, TWITCHTERINO_DEBUG: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const profiles = [];
    for (let index = 1; index <= 4; index++) {
      const profile = path.join(temporary, 'Conta-' + index);
      assert(!fs.existsSync(profile), 'First launch must create its own profile directory');
      const child = launch(profile);
      profiles.push({ path: profile, child });
      const startupDeadline = Date.now() + 30000;
      while (!child.output.includes('profile initialization complete')) {
        assert(!child.launchError && isRunning(child), 'A profile exited during initialization');
        assert(Date.now() < startupDeadline, 'A profile did not complete initialization');
        await pause(250);
      }
      console.log('Profile fixture: initialization complete for process ' + child.pid);
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
    const duplicate = launch(profiles[0].path);
    const duplicateDeadline = Date.now() + 30000;
    while (isRunning(duplicate) && !duplicate.launchError && Date.now() < duplicateDeadline) await pause(250);
    assert(!duplicate.launchError, 'Duplicate launch failed before testing the lock');
    assert.equal(duplicate.exitCode, 0, 'Opening an existing profile did not exit cleanly');
    console.log('Profile fixture: duplicate profile exited cleanly');
    assert(profiles.every(profile => isRunning(profile.child)), 'Duplicate launch stopped an existing profile');
    await stop(profiles[0].child);
    await pause(1000);
    assert(profiles.slice(1).every(profile => isRunning(profile.child)), 'Closing one profile stopped another');
    report.simultaneousProfiles = profiles.length;
    report.firstLaunchCreatedProfiles = true;
    report.portableFormat = 'directory-zip';
    report.closingOnePreservedOthers = true;
    report.sameProfileSecondLaunchExited = true;
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error.message;
    report.diagnostics = children.map(child => ({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, launchError: child.launchError, output: child.output }));
    console.error(JSON.stringify(report.diagnostics));
    console.error(error.message);
    process.exitCode = 1;
  } finally {
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

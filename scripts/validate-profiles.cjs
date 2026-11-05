'use strict';
// Native portable-process test with four empty profiles; no account or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const pkg = require('../package.json');

assert.equal(process.platform, 'win32', 'Validate portable profile processes on native Windows');
const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'release-output', 'portable', 'app', 'Twitchterino.exe');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'twitchterino-profile-validation-'));
const children = [];
const report = { version: pkg.version, scope: 'four empty portable profiles; no account or point awards', passed: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(profile) {
  const child = spawn(executable, [], { env: { ...process.env, TWITCHTERINO_DATA: profile }, stdio: 'ignore' });
  child.on('error', error => { child.launchError = error.message; });
  children.push(child);
  return child;
}

(async () => {
  try {
    assert(fs.existsSync(executable), 'Missing actual portable executable');
    const profiles = [];
    for (let index = 1; index <= 4; index++) {
      const profile = path.join(temporary, 'Conta-' + index);
      assert(!fs.existsSync(profile), 'First launch must create its own profile directory');
      profiles.push({ path: profile, child: launch(profile) });
    }
    const deadline = Date.now() + 60000;
    for (;;) {
      for (const profile of profiles) {
        assert(!profile.child.launchError, 'Portable process failed to start');
        assert.equal(profile.child.exitCode, null, 'A separate profile exited prematurely');
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
    assert(profiles.every(profile => profile.child.exitCode === null), 'Four profiles did not stay open concurrently');
    const duplicate = launch(profiles[0].path);
    const duplicateDeadline = Date.now() + 30000;
    while (duplicate.exitCode === null && !duplicate.launchError && Date.now() < duplicateDeadline) await pause(250);
    assert(!duplicate.launchError, 'Duplicate launch failed before testing the lock');
    assert.equal(duplicate.exitCode, 0, 'Opening an existing profile did not exit cleanly');
    assert(profiles.every(profile => profile.child.exitCode === null), 'Duplicate launch stopped an existing profile');
    const stopped = spawnSync('taskkill', ['/PID', String(profiles[0].child.pid), '/T', '/F'], { stdio: 'ignore' });
    assert.equal(stopped.status, 0, 'Could not close the first test profile');
    await pause(1000);
    assert(profiles.slice(1).every(profile => profile.child.exitCode === null), 'Closing one profile stopped another');
    report.simultaneousProfiles = profiles.length;
    report.firstLaunchCreatedProfiles = true;
    report.portableFormat = 'directory-zip';
    report.closingOnePreservedOthers = true;
    report.sameProfileSecondLaunchExited = true;
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error.message;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    for (const child of children) {
      if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    fs.writeFileSync(path.join(root, 'release-output', 'profile-validation.json'), JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  }
})();

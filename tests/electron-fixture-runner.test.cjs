'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/test-electron.cjs'), 'utf8');

for (const scenario of [
  { name: 'implicit native exit before assertions finish', status: 0, proof: undefined, expected: 1 },
  { name: 'partial failed proof despite a zero exit status', status: 0, proof: { passed: false }, expected: 1 },
  { name: 'all assertions finish and the application exits successfully', status: 0, proof: { passed: true }, expected: 0 },
  { name: 'a failed application exit despite a success proof', status: 1, proof: { passed: true }, expected: 1 },
]) test('Electron runner validates completion: ' + scenario.name, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kickterino-runner-test-'));
  const fakeProcess = { platform: 'win32', env: {}, stdout: { write() {} }, stderr: { write() {} } };
  try {
    vm.runInNewContext(source, {
      __dirname: path.join(root, 'scripts'), process: fakeProcess, console: { log() {}, error() {} },
      require(name) {
        if (name === 'electron') return 'fixture-electron.exe';
        if (name === 'node:child_process') return { spawnSync(_command, _args, options) {
          if (scenario.proof) fs.writeFileSync(options.env.SECURITY_FIXTURE_RESULT, JSON.stringify(scenario.proof));
          return { status: scenario.status };
        } };
        return require(name);
      },
    });
    assert.equal(fakeProcess.exitCode, scenario.expected);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

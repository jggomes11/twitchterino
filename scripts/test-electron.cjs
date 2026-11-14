'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-client-security-fixture-'));
const progress = path.join(data, 'progress.log');
const proof = path.join(data, 'result.json');
try {
  // Headless/no-sandbox flags are confined to this local fixture, never product startup.
  const flags = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [];
  const result = spawnSync(require('electron'), [...flags, path.resolve(__dirname, '../tests/electron-fixture.cjs')], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1', SECURITY_FIXTURE_DATA: data, SECURITY_FIXTURE_PROGRESS: progress, SECURITY_FIXTURE_RESULT: proof },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const stages = fs.existsSync(progress) ? fs.readFileSync(progress, 'utf8') : 'Electron fixture did not reach its first checkpoint.\n';
  let passed = false;
  try { passed = JSON.parse(fs.readFileSync(proof, 'utf8')).passed === true; } catch {}
  const evidence = path.resolve(__dirname, '../validation-output/evidence');
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'electron-fixture.log'), stages + 'Completion proof: ' + passed + '\n' + (result.error ? result.error.message + '\n' : 'Exit status: ' + result.status + '\n'));
  if (result.error) console.error(result.error.message);
  if (!passed) console.error('Electron fixture exited without successful completion proof.');
  if (result.status !== 0 || !passed) console.error('Native fixture progress:\n' + stages);
  process.exitCode = result.status === 0 && !result.error && passed ? 0 : 1;
} finally { fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }


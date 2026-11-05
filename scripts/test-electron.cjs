'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-client-security-fixture-'));
try {
  // Headless/no-sandbox flags are confined to this local fixture, never product startup.
  const flags = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [];
  const result = spawnSync(require('electron'), [...flags, path.resolve(__dirname, '../tests/electron-fixture.cjs')], {
    stdio: 'inherit', timeout: 30000, env: { ...process.env, SECURITY_FIXTURE_DATA: data },
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status === 0 ? 0 : 1;
} finally { fs.rmSync(data, { recursive: true, force: true }); }


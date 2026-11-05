'use strict';
// Required public API smoke test using an empty profile, never an account session.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-public-probe-'));
  try {
    const flags = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [];
    const result = spawnSync(require('electron'), [...flags, __filename], {
      stdio: 'inherit', timeout: 30000, env: { ...process.env, PUBLIC_PROBE_DATA: profile },
    });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status === 0 ? 0 : 1;
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
} else {
  const { app, session } = require('electron');
  const assert = require('node:assert/strict');
  app.setPath('userData', process.env.PUBLIC_PROBE_DATA);
  app.whenReady().then(async () => {
    try {
      const ses = session.fromPartition('public-probe');
      const { createPlatformClient } = require('../security/platform');
      const client = createPlatformClient('twitch', () => ses);
      const result = await client.request('/gql', {
        method: 'POST', body: { query: '{user(login:"faturetosl"){id stream{id viewersCount}}}' },
      });
      assert.equal(result.status, 200, 'Public API HTTP response');
      assert(result.json?.data?.user?.id, 'Public channel metadata missing');
      assert(!result.json.errors?.length, 'Public API returned GraphQL errors');
      console.log(JSON.stringify({ stage: 'public-channel', http: result.status, live: !!result.json.data.user.stream }));
      app.exit(0);
    } catch (error) { console.error(error.message); app.exit(1); }
  });
}

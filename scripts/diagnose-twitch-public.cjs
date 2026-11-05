'use strict';
// Public, unauthenticated transport probe. Never opens an existing account profile.
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
  app.setPath('userData', process.env.PUBLIC_PROBE_DATA);
  app.whenReady().then(async () => {
    try {
      const ses = session.fromPartition('public-probe');
      const fetch = ses.fetch.bind(ses);
      ses.fetch = async (url, options) => {
        try {
          const response = await fetch(url, options);
          console.log(JSON.stringify({ stage: 'response', status: response.status }));
          return response;
        } catch (error) {
          // The probe uses only an empty, in-memory session and a fixed public query.
          console.log(JSON.stringify({ stage: 'fetch', name: error.name, message: error.message }));
          throw error;
        }
      };
      const { createPlatformClient } = require('../security/platform');
      const client = createPlatformClient('twitch', () => ses);
      const result = await client.request('/gql', {
        method: 'POST', body: { query: '{user(login:"faturetosl"){id stream{id viewersCount}}}' },
      });
      console.log(JSON.stringify({ stage: 'result', http: result.status, data: !!result.json?.data, errors: result.json?.errors }));
      app.exit(result.status === 200 && result.json?.data ? 0 : 1);
    } catch (error) { console.log(JSON.stringify({ stage: 'client', message: error.message })); app.exit(1); }
  });
}

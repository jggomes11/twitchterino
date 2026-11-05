'use strict';
// Controlled main-process transport fixture: no real platform or account is contacted.
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSessionClient, readCookie } = require('../security/requests');

app.setPath('userData', process.env.SECURITY_FIXTURE_DATA);
app.whenReady().then(async () => {
  let server;
  try {
    let leaked = 0;
    let observed;
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: '/leak' }); return res.end(); }
      if (req.url === '/leak') { leaked++; return res.end('{}'); }
      if (req.url === '/slow') return;
      observed = { cookie: req.headers.cookie, authorization: req.headers.authorization };
      res.setHeader('Content-Type', 'application/json'); res.end('{"points":42}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const ses = session.fromPartition('security-fixture-' + process.pid);
    await ses.cookies.set({ url: origin, name: 'fixture_token', value: 'FAKE_RUNTIME_TOKEN' });
    const options = {
      getSession: () => ses,
      getHeaders: async () => ({ Authorization: 'Bearer ' + await readCookie(ses, origin, 'fixture_token') }),
      resolveUrl: input => { if (!['/data', '/redirect', '/slow'].includes(input)) throw new Error(); return origin + input; },
    };
    const client = createSessionClient(options);
    assert.deepEqual(await client.request('/data'), { status: 200, json: { points: 42 } });
    assert.match(observed.cookie, /fixture_token=FAKE_RUNTIME_TOKEN/);
    assert.equal(observed.authorization, 'Bearer FAKE_RUNTIME_TOKEN');
    await assert.rejects(client.request('/redirect'), /Request failed/);
    assert.equal(leaked, 0);
    await assert.rejects(createSessionClient({ ...options, timeoutMs: 30 }).request('/slow'), /Request timed out/);
    const pending = client.request('/slow');
    client.invalidate();
    await assert.rejects(pending, /Session changed/);
    await ses.clearStorageData();
    console.log('Electron transport fixture: session cookies, fixed destination, redirect refusal, timeout and invalidation passed.');
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    if (server) { server.closeAllConnections(); server.close(); }
    app.exit(1);
  }
});


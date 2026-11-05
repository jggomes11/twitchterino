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
      res.setHeader('Access-Control-Allow-Origin', '*');
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
    // Catch the production regression: renderer Origin plus credential inclusion
    // makes Chromium reject a wildcard-CORS API, even from a main-process fetch.
    const { createPlatformClient } = require('../security/platform');
    const twitch = createPlatformClient('twitch', () => ({
      cookies: { get: async ({ url, name }) => {
        assert.equal(url, 'https://www.twitch.tv');
        return name === 'auth-token' ? [{ value: await readCookie(ses, origin, 'fixture_token') }] : [];
      } },
      fetch: (url, init) => {
        assert.equal(url, 'https://gql.twitch.tv/gql');
        // The fixture redirects the destination to local HTTP, so omit only the
        // HTTPS referrer that Chromium correctly rejects on that downgrade.
        const headers = { ...init.headers }; delete headers.Referer;
        return ses.fetch(origin + '/data', { ...init, headers });
      },
    }));
    assert.deepEqual(await twitch.request('/gql', { method: 'POST', body: { query: '{user(login:"fixture"){id}}' } }),
      { status: 200, json: { points: 42 } });
    assert.match(observed.cookie, /fixture_token=FAKE_RUNTIME_TOKEN/);
    assert.equal(observed.authorization, 'OAuth FAKE_RUNTIME_TOKEN');
    console.log('Twitch main-process transport accepts wildcard-CORS responses with session cookies and OAuth.');
    // Chromium reports a same-value cookie overwrite as a removal and insertion.
    const cookieChanges = [];
    const observeCookie = (_event, cookie, cause, removed) => {
      if (cookie.name === 'fixture_token') cookieChanges.push({ cause, removed });
    };
    ses.cookies.on('changed', observeCookie);
    await ses.cookies.set({ url: origin, name: 'fixture_token', value: 'FAKE_RUNTIME_TOKEN' });
    const eventDeadline = Date.now() + 2000;
    while (cookieChanges.length < 2 && Date.now() < eventDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    ses.cookies.removeListener('changed', observeCookie);
    assert.equal(cookieChanges[0]?.cause, 'overwrite');
    assert.equal(cookieChanges[0]?.removed, true);
    assert.equal(cookieChanges[1]?.removed, false);
    console.log('Native same-value cookie overwrite emits a transient removal followed by insertion.');
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


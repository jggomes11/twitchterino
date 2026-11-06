'use strict';
// Controlled main-process transport fixture: no real platform or account is contacted.
const { app, session, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSessionClient, readCookie } = require('../security/requests');

app.setPath('userData', process.env.SECURITY_FIXTURE_DATA);
// This runner owns shutdown across multiple sequential fixture windows.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let server;
  try {
    let leaked = 0;
    let observed;
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: '/leak' }); return res.end(); }
      if (req.url === '/leak') { leaked++; return res.end('{}'); }
      if (req.url === '/slow') return;
      if (req.url === '/bonus-fixture') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(`<html><body><script>window.bonusClicks=0;window.rewardClicks=0;</script>
          <button id="reward" aria-label="Claim reward" onclick="rewardClicks++">Paid reward</button>
          <button id="bonus" onclick="bonusClicks++"><span class="claimable-bonus__icon">Bonus</span></button></body></html>`);
      }
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
    {
      const { createWatchDiagnostics } = require('../security/points-diagnostics');
      const metricsStep = async (label, operation) => {
        console.log('Metrics fixture:', label);
        let timer;
        try {
          return await Promise.race([operation(), new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Metrics fixture timeout: ' + label)), 7000);
          })]);
        } finally { clearTimeout(timer); }
      };
      // All HTTPS requests in this empty fixture partition are handled locally.
      // The synthetic watch event never reaches Twitch or any real account.
      const metricsSession = session.fromPartition('metrics-fixture-' + process.pid);
      // Fail closed if a custom handler stops intercepting: no fixture request
      // can reach the real HTTPS endpoint through this loopback-only proxy.
      await metricsStep('configure loopback-only proxy', () => metricsSession.setProxy({ proxyRules: '127.0.0.1:9' }));
      let intercepted = 0;
      await metricsSession.protocol.handle('https', request => {
        const url = new URL(request.url);
        if (url.origin === 'https://www.twitch.tv' && url.pathname === '/fixture') {
          return new Response('<html><body>Local metrics fixture</body></html>', { headers: { 'Content-Type': 'text/html' } });
        }
        if (url.origin === 'https://spade.twitch.tv' && url.pathname === '/track') {
          intercepted++;
          return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://www.twitch.tv' } });
        }
        return new Response(null, { status: 404 });
      });
      const metricsPage = new BrowserWindow({ show: false, webPreferences: { session: metricsSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        // Initialize the first renderer before awaiting CDP commands; awaiting
        // Network.enable on an unused about:blank window can otherwise stall.
        await metricsStep('load local protocol document', () => metricsPage.loadURL('https://www.twitch.tv/fixture'));
        const diagnostics = createWatchDiagnostics();
        const dbg = metricsPage.webContents.debugger;
        dbg.attach('1.3'); diagnostics.attached(true);
        dbg.on('message', (_e, method, params) => diagnostics.observe(method, params));
        await metricsStep('enable network observer', () => dbg.sendCommand('Network.enable')); diagnostics.enabled(true);
        const body = 'data=' + encodeURIComponent(Buffer.from(JSON.stringify([{ event: 'minute-watched', properties: { user_id: 'FAKE_DIAGNOSTIC_USER' } }])).toString('base64'));
        assert.equal(await metricsStep('observe local-only watch request', () => metricsPage.webContents.executeJavaScript(`fetch('https://spade.twitch.tv/track', {method:'POST', body:${JSON.stringify(body)}}).then(r => r.status)`)), 204);
        const deadline = Date.now() + 5000;
        while ((diagnostics.snapshot().responses < 1 || diagnostics.snapshot().pendingRequests) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        const observedMetrics = diagnostics.snapshot();
        assert.equal(intercepted, 1);
        assert.equal(observedMetrics.minuteWatchedEvents, 1);
        assert.equal(observedMetrics.responses, 1);
        assert.equal(observedMetrics.lastStatus, 204);
        assert.doesNotMatch(JSON.stringify(observedMetrics), /FAKE_DIAGNOSTIC_USER|postData|https:/);
        console.log('Native metrics observer: local-only watch-minute request/response classified without persisting request content.');
      } finally { metricsPage.destroy(); metricsSession.protocol.unhandle('https'); }
    }
    if (process.platform === 'win32') {
      const { chestClickScript } = require('../security/chest');
      const page = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        const address = origin + '/bonus-fixture';
        await page.loadURL(address);
        const clicked = await page.webContents.executeJavaScript(chestClickScript(address, 1000), true);
        assert.equal(clicked.clicked, true);
        assert.equal(await page.webContents.executeJavaScript('window.bonusClicks'), 1);
        await page.webContents.executeJavaScript('document.querySelector("#bonus").remove()');
        const absent = await page.webContents.executeJavaScript(chestClickScript(address, 1000), true);
        assert.equal(absent.clicked, false);
        assert.equal(await page.webContents.executeJavaScript('window.rewardClicks'), 0);
        console.log('Native chest UI fixture: only the bonus button is clicked; generic reward button remains untouched.');
      } finally { page.destroy(); }
    }
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


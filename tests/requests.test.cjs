'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSessionClient, readCookie } = require('../security/requests');

async function fixture(t, respond) {
  const server = http.createServer(respond);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return 'http://127.0.0.1:' + server.address().port;
}
function clientFor(base, options = {}) {
  return createSessionClient({
    getSession: () => ({ fetch: globalThis.fetch }),
    getHeaders: async () => ({ Authorization: 'Bearer FAKE_TEST_TOKEN' }),
    resolveUrl: input => { if (input !== '/data') throw new Error('Invalid route'); return base + input; },
    ...options,
  });
}

test('sends credentials only to the resolved request, never to another document', async t => {
  const received = [];
  const base = await fixture(t, (req, res) => {
    received.push({ path: req.url, auth: req.headers.authorization, method: req.method });
    res.setHeader('Content-Type', 'application/json'); res.end('{"points":42}');
  });
  const result = await clientFor(base).request('/data');
  assert.deepEqual(result, { status: 200, json: { points: 42 } });
  assert.deepEqual(received, [{ path: '/data', auth: 'Bearer FAKE_TEST_TOKEN', method: 'GET' }]);
});

test('rejects a route before reading any credentials', async () => {
  let reads = 0;
  const client = clientFor('http://unused.invalid', { getHeaders: async () => { reads++; return {}; } });
  await assert.rejects(client.request('//evil.invalid/data'), /Invalid request/);
  assert.equal(reads, 0);
});

test('refuses redirects without sending a second authenticated request', async t => {
  let destinationHits = 0;
  const destination = await fixture(t, (_req, res) => { destinationHits++; res.end('{}'); });
  const base = await fixture(t, (_req, res) => { res.writeHead(302, { Location: destination + '/steal' }); res.end(); });
  await assert.rejects(clientFor(base).request('/data'), /Request failed/);
  assert.equal(destinationHits, 0);
});

test('aborts the underlying request after its timeout', async t => {
  const base = await fixture(t, () => {});
  await assert.rejects(clientFor(base, { timeoutMs: 30 }).request('/data'), /Request timed out/);
});

test('bounds declared and streamed bodies and does not echo their contents', async () => {
  for (const response of [
    new Response('FAKE_PRIVATE_BODY', { headers: { 'content-length': '9999' } }),
    new Response('FAKE_PRIVATE_BODY'),
  ]) {
    const client = clientFor('', { maxResponseBytes: 4, getSession: () => ({ fetch: async () => response }) });
    await assert.rejects(client.request('/data'), error => /Response too large/.test(error.message) && !error.message.includes('PRIVATE'));
  }
});

test('sanitizes failures from transport, header decoding and malformed JSON', async () => {
  for (const options of [
    { getSession: () => ({ fetch: async () => { throw new Error('FAKE_TEST_TOKEN'); } }) },
    { getHeaders: async () => { throw new Error('FAKE_TEST_TOKEN'); } },
  ]) {
    await assert.rejects(clientFor('', options).request('/data'), error => error.message === 'Request failed');
  }
  const client = clientFor('', { getSession: () => ({ fetch: async () => new Response('not-json', { status: 403 }) }) });
  assert.deepEqual(await client.request('/data'), { status: 403, json: null });
});

test('suspending cancels requests and prevents credentials from being read', async () => {
  let release;
  let reads = 0;
  const client = clientFor('', {
    getHeaders: async () => { reads++; await new Promise(resolve => { release = resolve; }); return {}; },
    getSession: () => ({ fetch: async () => new Response('{}') }),
  });
  const pending = client.request('/data');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  client.suspend(); release();
  await assert.rejects(pending, /Session changed/);
  await assert.rejects(client.request('/data'), /Session unavailable/);
  assert.equal(reads, 1);
  client.resume();
  const second = client.request('/data');
  await new Promise(resolve => setImmediate(resolve)); release();
  assert.deepEqual(await second, { status: 200, json: {} });
});

test('session replacement rejects a body that completes after invalidation', async () => {
  let finish;
  const stream = new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('{"old":true}')); controller.close(); }; } });
  const client = clientFor('', { getSession: () => ({ fetch: async () => new Response(stream) }) });
  const pending = client.request('/data');
  await new Promise(resolve => setImmediate(resolve));
  client.invalidate(); finish();
  await assert.rejects(pending, /Session changed/);
});

test('decodes only the selected cookie and safely rejects malformed values', async () => {
  const session = { cookies: { get: async ({ url, name }) => {
    assert.equal(url, 'https://kick.com'); assert.equal(name, 'session_token');
    return [{ value: 'fake%20token' }];
  } } };
  assert.equal(await readCookie(session, 'https://kick.com', 'session_token'), 'fake token');
  assert.equal(await readCookie({ cookies: { get: async () => [] } }, 'https://kick.com', 'session_token'), '');
  await assert.rejects(readCookie({ cookies: { get: async () => [{ value: '%INVALID' }] } }, 'https://kick.com', 'session_token'), /Invalid session cookie/);
});


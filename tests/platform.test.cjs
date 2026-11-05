'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveKickUrl, resolveTwitchUrl, createPlatformClient } = require('../security/platform');

test('uses fixed origins for every supported platform operation', () => {
  assert.equal(resolveTwitchUrl('/gql'), 'https://gql.twitch.tv/gql');
  for (const path of ['/api/v1/user', '/api/v2/user', '/api/v2/channels/some_user', '/api/v2/channels/some-user/me', '/api/v2/channels/some_user/points', '/api/v2/messages/send/123']) {
    assert.equal(resolveKickUrl(path), 'https://kick.com' + path);
  }
});

test('rejects alternate origins, traversal, credentials, encoding, fragments and arbitrary routes', () => {
  for (const path of ['https://evil.invalid/api/v1/user', '//evil.invalid/api/v1/user', '/api/v2/../v1/user', '/api/v2/channels/aa%2f..', '/api/v1/user?token=secret', '/api/v1/user#fragment', '/api/v2/messages/send/1\r\nJOIN #other', '/api/v2/messages/send/-1', '/api/v1/anything', 'https://user:pass@kick.com/api/v1/user']) {
    assert.throws(() => resolveKickUrl(path), /Invalid request/);
  }
  for (const path of ['https://evil.invalid/gql', '//gql.twitch.tv/gql', '/gql?x=1', '/other']) assert.throws(() => resolveTwitchUrl(path), /Invalid request/);
});

test('builds Twitch auth in the selected session without running page JavaScript', async () => {
  const requests = [];
  const session = {
    cookies: { get: async ({ url, name }) => {
      assert.equal(url, 'https://www.twitch.tv');
      return [{ value: name === 'auth-token' ? 'FAKE_TOKEN' : 'FAKE_DEVICE' }];
    } },
    fetch: async (url, init) => { requests.push({ url, init }); return new Response('{"data":{"ok":true}}'); },
  };
  const client = createPlatformClient('twitch', () => session);
  assert.deepEqual(await client.request('/gql', { method: 'POST', body: { query: '{currentUser{login}}' } }), { status: 200, json: { data: { ok: true } } });
  assert.equal(requests[0].url, 'https://gql.twitch.tv/gql');
  assert.equal(requests[0].init.headers.Authorization, 'OAuth FAKE_TOKEN');
  assert.equal(requests[0].init.headers['X-Device-Id'], 'FAKE_DEVICE');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].init.credentials, 'include');
});

test('builds Kick bearer and CSRF headers from its own session cookies', async () => {
  let request;
  const session = {
    cookies: { get: async ({ name }) => [{ value: name === 'session_token' ? 'FAKE_TOKEN' : 'FAKE_CSRF' }] },
    fetch: async (url, init) => { request = { url, init }; return new Response('{"ok":true}'); },
  };
  await createPlatformClient('kick', () => session).request('/api/v2/messages/send/123', { method: 'POST', body: { content: 'hello', type: 'message' } });
  assert.equal(request.url, 'https://kick.com/api/v2/messages/send/123');
  assert.equal(request.init.headers.Authorization, 'Bearer FAKE_TOKEN');
  assert.equal(request.init.headers['X-XSRF-TOKEN'], 'FAKE_CSRF');
  assert.deepEqual(JSON.parse(request.init.body), { content: 'hello', type: 'message' });
});

test('invalid Kick paths never trigger a credential lookup', async () => {
  let lookups = 0;
  const session = { cookies: { get: async () => { lookups++; return []; } }, fetch: async () => { throw new Error('Should not run'); } };
  await assert.rejects(createPlatformClient('kick', () => session).request('//evil.invalid'), /Invalid request/);
  assert.equal(lookups, 0);
});


'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
let createWatchDiagnostics;
try { ({ createWatchDiagnostics } = require('../security/points-diagnostics')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

function observer() {
  assert.equal(typeof createWatchDiagnostics, 'function', 'passive watch diagnostics are not implemented');
  let now = 1000;
  const d = createWatchDiagnostics({ now: () => now });
  return { d, advance(ms) { now += ms; } };
}
function request(d, id, postData, url = 'https://spade.twitch.tv/track') {
  d.observe('Network.requestWillBeSent', { requestId: id,
    request: { url, method: 'POST', postData, headers: { Authorization: 'SECRET_AUTH' } } });
}

test('watch-minute diagnostics count JSON and form-base64 events without retaining their contents', () => {
  const { d, advance } = observer(); d.attached(true);
  const events = [{ event: 'minute-watched', properties: { user_id: 'SECRET_ACCOUNT', auth: 'SECRET_BODY' } }, { event: 'video-play' }];
  request(d, 'SECRET_REQUEST_1', JSON.stringify(events)); advance(1000);
  request(d, 'SECRET_REQUEST_2', 'data=' + encodeURIComponent(Buffer.from(JSON.stringify(events)).toString('base64')));
  const out = d.snapshot();
  assert.equal(out.debuggerAttached, true);
  assert.equal(out.requests, 2);
  assert.equal(out.minuteWatchedEvents, 2);
  assert.equal(out.lastMinuteWatchedAt, 2000);
  assert.equal(out.unclassifiedRequests, 0);
  assert.doesNotMatch(JSON.stringify(out), /SECRET|user_id|Authorization|https:|postData|video-play/);
});

test('only exact first-party HTTPS telemetry endpoints are observed', () => {
  const { d } = observer();
  for (const url of ['https://spade.twitch.tv.evil.test/track', 'https://spade.twitch.tv@evil.test/track',
    'http://spade.twitch.tv/track', 'https://spade.twitch.tv/other', 'https://gql.twitch.tv/gql']) {
    request(d, url, '[{"event":"minute-watched"}]', url);
  }
  assert.equal(d.snapshot().requests, 0);
  request(d, 'a', '[{"event":"minute-watched"}]', 'https://beacon.twitch.tv/track');
  request(d, 'b', '[{"event":"minute-watched"}]', 'https://spade.sci.twitch.tv/track');
  assert.equal(d.snapshot().minuteWatchedEvents, 2);
});

test('missing, malformed and oversized bodies are explicitly unclassified', () => {
  const { d } = observer();
  for (const [i, body] of [undefined, 'data=not-json', '{broken', 'x'.repeat(65537)].entries()) request(d, String(i), body);
  assert.equal(d.snapshot().requests, 4);
  assert.equal(d.snapshot().unclassifiedRequests, 4);
  assert.equal(d.snapshot().minuteWatchedEvents, 0);
  assert.doesNotThrow(() => d.observe('Network.requestWillBeSent', {}));
});

test('event inspection is bounded to the first100 items of a telemetry batch', () => {
  const { d } = observer();
  request(d, 'batch', JSON.stringify(Array.from({ length: 150 }, () => ({ event: 'minute-watched' }))));
  assert.equal(d.snapshot().minuteWatchedEvents, 100);
});

test('responses, HTTP errors and network failures remain associated with telemetry requests only', () => {
  const { d, advance } = observer();
  request(d, 'ok', '[{"event":"minute-watched"}]');
  d.observe('Network.responseReceived', { requestId: 'ok', response: { status: 204, url: 'SECRET_URL' } });
  d.observe('Network.responseReceived', { requestId: 'ok', response: { status: 204 } });
  d.observe('Network.loadingFinished', { requestId: 'ok' });
  advance(2000); request(d, 'error', 'data=unknown');
  d.observe('Network.responseReceived', { requestId: 'error', response: { status: 403 } });
  d.observe('Network.loadingFailed', { requestId: 'error', errorText: 'SECRET_FAILURE' });
  d.observe('Network.responseReceived', { requestId: 'unrelated', response: { status: 500 } });
  const out = d.snapshot();
  assert.equal(out.responses, 2);
  assert.equal(out.httpErrors, 1);
  assert.equal(out.networkFailures, 1);
  assert.equal(out.lastStatus, 403);
  assert.equal(out.lastResponseAt, 3000);
  assert.equal(out.pendingRequests, 0);
  assert.doesNotMatch(JSON.stringify(out), /SECRET/);
});

test('pending requests are bounded and navigation discards obsolete associations', () => {
  const { d } = observer();
  for (let i = 0; i < 140; i++) request(d, 'request-' + i, undefined);
  assert.equal(d.snapshot().pendingRequests, 128);
  d.observe('Network.responseReceived', { requestId: 'request-0', response: { status: 200 } });
  assert.equal(d.snapshot().responses, 0);
  d.observe('Network.responseReceived', { requestId: 'request-139', response: { status: 204 } });
  assert.equal(d.snapshot().responses, 1);
  d.navigation();
  d.observe('Network.loadingFailed', { requestId: 'request-138' });
  assert.equal(d.snapshot().pendingRequests, 0);
  assert.equal(d.snapshot().networkFailures, 0);
  assert.equal(d.snapshot().navigations, 1);
  d.attached(false);
  assert.equal(d.snapshot().debuggerAttached, false);
});

test('redirect responses are attributed once without following the redirected request', () => {
  const { d } = observer(); request(d, 'redirect', undefined);
  d.observe('Network.requestWillBeSent', { requestId: 'redirect', redirectResponse: { status: 302 },
    request: { method: 'GET', url: 'https://other.test/SECRET' } });
  d.observe('Network.responseReceived', { requestId: 'redirect', response: { status: 200 } });
  assert.equal(d.snapshot().requests, 1);
  assert.equal(d.snapshot().responses, 1);
  assert.equal(d.snapshot().lastStatus, 302);
  assert.equal(d.snapshot().pendingRequests, 0);
});

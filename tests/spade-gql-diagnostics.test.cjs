'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { createWatchDiagnostics } = require('../security/points-diagnostics');
const QUERY = 'mutation SendEvents($input:SendSpadeEventsInput!){sendSpadeEvents(input:$input){statusCode}}';
const event = (properties = {}) => ({ event: 'minute-watched', properties: {
  logged_in: true, user_id: '777', channel: 'rodil', channel_id: '123', is_live: true,
  is_ad_playing: false, playback_gated: false, muted: false, minutes_logged: 1,
  private: 'SECRET_EVENT', ...properties,
} });
const operation = events => ({ query: QUERY, variables: { input: {
  repository: 'twilight', encoding: 'GZIP_B64', data: gzipSync(JSON.stringify(events)).toString('base64'),
} } });
const response = value => ({ body: JSON.stringify(value), base64Encoded: false });
const accepted = () => response({ data: { sendSpadeEvents: { statusCode: 200 } } });
function fixture(extra = {}) {
  let now = 1000;
  const d = createWatchDiagnostics({ now: () => now, channel: 'rodil', getExpectedAccountId: () => '777',
    getExpectedChannelId: () => '123', readResponse: async () => accepted(), ...extra });
  return { d, advance(ms) { now += ms; } };
}
function send(d, id = 'SECRET_REQUEST', body = operation([event()]), url = 'https://gql.twitch.tv/gql') {
  d.observe('Network.requestWillBeSent', { requestId: id, request: { url, method: 'POST',
    postData: JSON.stringify(body), headers: { Authorization: 'SECRET_AUTH' } } });
}
async function finish(d, id = 'SECRET_REQUEST', status = 200) {
  d.observe('Network.responseReceived', { requestId: id, response: { status } });
  await d.observe('Network.loadingFinished', { requestId: id, encodedDataLength: 200 });
}

test('current SendEvents gzip batches expose watch metadata without retaining identities or payloads', async () => {
  const { d } = fixture(); send(d); await finish(d);
  const s = d.snapshot();
  assert.equal(s.graphqlRequests, 1, 'current Twitch telemetry transport is not observed');
  assert.equal(s.minuteWatchedEvents, 1);
  assert.equal(s.watchLoggedInEvents, 1);
  assert.equal(s.lastWatchLoggedIn, true);
  assert.equal(s.lastWatchAccountMatches, true);
  assert.equal(s.lastWatchChannelMatches, true);
  assert.equal(s.lastWatchLive, true);
  assert.equal(s.lastWatchAdPlaying, false);
  assert.equal(s.lastWatchPlaybackGated, false);
  assert.equal(s.lastWatchMuted, false);
  assert.equal(s.lastWatchMinutesLogged, 1);
  assert.equal(s.lastGraphqlHttpStatus, 200);
  assert.equal(s.lastSpadeStatusCode, 200);
  assert.equal(s.spadeAcceptedResponses, 1);
  assert.doesNotMatch(JSON.stringify(s), /SECRET|user_id|channel_id|Authorization|https:|postData|rodil|"777"/);
});

test('unrelated and spoofed GraphQL requests do not become watch telemetry', () => {
  const { d } = fixture();
  send(d, 'unrelated', { query: '{currentUser{id}}', variables: { secret: 'SECRET_OTHER' } });
  send(d, 'spoofed', operation([event()]), 'https://gql.twitch.tv.evil.test/gql');
  send(d, 'other-operation', { operationName: 'SendEvents', variables: { input: { data: 'SECRET_UNRELATED' } } });
  assert.equal(d.snapshot().requests, 0);
  send(d); assert.equal(d.snapshot().graphqlRequests, 1);
});

test('anonymous, wrong-account and different-channel watch metadata remains boolean evidence', () => {
  const { d } = fixture();
  send(d, 'anonymous', operation([event({ logged_in: false, user_id: null, is_live: false, is_ad_playing: true, playback_gated: true, muted: true })]));
  assert.equal(d.snapshot().watchLoggedOutEvents, 1);
  assert.equal(d.snapshot().lastWatchAccountMatches, null);
  assert.equal(d.snapshot().lastWatchLive, false);
  assert.equal(d.snapshot().lastWatchAdPlaying, true);
  send(d, 'mismatch', operation([event({ user_id: '888', channel: 'another', channel_id: '456' })]));
  assert.equal(d.snapshot().lastWatchAccountMatches, false);
  assert.equal(d.snapshot().lastWatchChannelMatches, false);
  assert.doesNotMatch(JSON.stringify(d.snapshot()), /another|"888"|"456"/);
});

test('gzip expansion and total inspected events across a batch are bounded', () => {
  const { d } = fixture();
  send(d, 'expansion', operation([event({ filler: 'x'.repeat(300000) })]));
  assert.equal(d.snapshot().graphqlRequests, 1);
  assert.equal(d.snapshot().minuteWatchedEvents, 0);
  assert.equal(d.snapshot().unclassifiedRequests, 1);
  const batch = Array.from({ length: 75 }, () => event());
  send(d, 'batch', [operation(batch), operation(batch)]);
  assert.equal(d.snapshot().minuteWatchedEvents, 100);
  assert.equal(d.snapshot().truncatedEventBatches, 1);
});

test('only telemetry results in mixed GraphQL response arrays are inspected', async () => {
  const { d } = fixture({ readResponse: async () => response([
    { data: { currentUser: { login: 'SECRET_LOGIN', id: 'SECRET_ID' } } },
    { data: { sendSpadeEvents: { statusCode: 200 } } },
  ]) });
  send(d, 'SECRET_REQUEST', [{ query: '{currentUser{id}}' }, operation([event()])]);
  await finish(d);
  assert.equal(d.snapshot().spadeAcceptedResponses, 1);
  assert.equal(d.snapshot().graphqlErrorResponses, 0);
  assert.doesNotMatch(JSON.stringify(d.snapshot()), /SECRET|currentUser/);
});

test('GraphQL integrity errors are classified without storing server messages', async () => {
  const { d } = fixture({ readResponse: async () => response({ errors: [
    { message: 'SECRET_MESSAGE', extensions: { code: 'INTEGRITY_CHECK_FAILED', token: 'SECRET_TOKEN' } },
  ] }) });
  send(d); await finish(d);
  assert.equal(d.snapshot().spadeRejectedResponses, 1);
  assert.equal(d.snapshot().graphqlErrorResponses, 1);
  assert.equal(d.snapshot().lastSpadeErrorClass, 'integrity');
  assert.equal(d.snapshot().lastSpadeStatusCode, null);
  assert.doesNotMatch(JSON.stringify(d.snapshot()), /SECRET|message|extensions/);
});

test('application-level rejections remain visible even under HTTP200', async () => {
  const { d } = fixture({ readResponse: async () => response({ data: { sendSpadeEvents: { statusCode: 429 } } }) });
  send(d); await finish(d);
  assert.equal(d.snapshot().lastGraphqlHttpStatus, 200);
  assert.equal(d.snapshot().lastSpadeStatusCode, 429);
  assert.equal(d.snapshot().lastSpadeErrorClass, 'rate-limit');
  assert.equal(d.snapshot().spadeRejectedResponses, 1);
  assert.equal(d.snapshot().spadeAcceptedResponses, 0);
});

test('missing, oversized and malformed responses are unknown rather than accepted', async () => {
  for (const value of [{}, { body: '{broken' }, { body: 'x'.repeat(65537) }, response({ data: { sendSpadeEvents: { statusCode: { token: 'SECRET_STATUS' } } } })]) {
    const { d } = fixture({ readResponse: async () => value }); send(d); await finish(d);
    assert.equal(d.snapshot().spadeUnavailableResponses, 1);
    assert.equal(d.snapshot().spadeAcceptedResponses, 0);
    assert.doesNotMatch(JSON.stringify(d.snapshot()), /SECRET/);
  }
});

test('response reads are bounded and obsolete navigation results are discarded', async () => {
  const release = []; let calls = 0;
  const { d } = fixture({ readResponse: () => { calls++; return new Promise(resolve => release.push(resolve)); } });
  const finished = [];
  for (let i = 0; i < 5; i++) { send(d, 'r' + i); finished.push(finish(d, 'r' + i)); }
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 4);
  assert.equal(d.snapshot().pendingResponseReads, 4);
  d.navigation(); release.forEach(resolve => resolve(accepted())); await Promise.all(finished);
  assert.equal(d.snapshot().spadeAcceptedResponses, 0);
  assert.equal(d.snapshot().pendingResponseReads, 0);
});

test('postDataEntries and base64 response bodies preserve the bounded data contract', async () => {
  const body = JSON.stringify(operation([event()]));
  const { d } = fixture({ readResponse: async () => ({ body: Buffer.from(accepted().body).toString('base64'), base64Encoded: true }) });
  d.observe('Network.requestWillBeSent', { requestId: 'SECRET_REQUEST', request: { url: 'https://gql.twitch.tv/gql', method: 'POST', hasPostData: true,
    postDataEntries: [{ bytes: Buffer.from(body).toString('base64') }] } });
  await finish(d);
  assert.equal(d.snapshot().minuteWatchedEvents, 1);
  assert.equal(d.snapshot().spadeAcceptedResponses, 1);
});

test('malformed request metadata cannot throw from the passive observer', () => {
  const { d } = fixture();
  assert.doesNotThrow(() => d.observe('Network.requestWillBeSent', null));
  assert.doesNotThrow(() => d.observe('Network.requestWillBeSent', { requestId: 'broken', request: {
    url: 'https://gql.twitch.tv/gql', method: 'POST', postDataEntries: [null],
  } }));
  assert.equal(d.snapshot().requests, 0);
});

test('a rejected telemetry result is not hidden by a later accepted result in one batch', async () => {
  const { d } = fixture({ readResponse: async () => response([
    { data: { sendSpadeEvents: { statusCode: 429 } } },
    { data: { sendSpadeEvents: { statusCode: 200 } } },
  ]) });
  send(d, 'SECRET_REQUEST', [operation([event()]), operation([event()])]); await finish(d);
  assert.equal(d.snapshot().spadeRejectedResponses, 1);
  assert.equal(d.snapshot().lastSpadeStatusCode, 429);
  assert.equal(d.snapshot().lastSpadeErrorClass, 'rate-limit');
});

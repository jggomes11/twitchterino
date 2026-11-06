'use strict';

const { gunzipSync } = require('node:zlib');
// Observe only events the official page already sends. Never send or retain content.
const HOSTS = new Set(['spade.twitch.tv', 'spade.sci.twitch.tv', 'beacon.twitch.tv']);
const MAX_INPUT = 64 * 1024;
const MAX_EXPANDED = 256 * 1024;
const MAX_EVENTS = 100;
const MAX_PENDING = 128;
const MAX_READS = 4;
const boolean = value => typeof value === 'boolean' ? value : null;
const idString = value => (typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value))
  || (Number.isSafeInteger(value) && value > 0) ? String(value) : null;
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

function endpoint(value) {
  if (typeof value !== 'string' || value.length > MAX_INPUT) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return null;
    const kind = url.hostname === 'gql.twitch.tv' && url.pathname === '/gql' ? 'graphql'
      : HOSTS.has(url.hostname) && url.pathname === '/track' ? 'legacy' : null;
    return kind ? { url, kind } : null;
  } catch { return null; }
}

function requestText(request, url) {
  if (typeof request.postData === 'string' && request.postData) {
    return request.postData.length <= MAX_INPUT && Buffer.byteLength(request.postData) <= MAX_INPUT ? request.postData : null;
  }
  if (Array.isArray(request.postDataEntries) && request.postDataEntries.length <= 16) {
    const chunks = []; let size = 0;
    for (const entry of request.postDataEntries) {
      if (typeof entry?.bytes !== 'string' || entry.bytes.length > MAX_INPUT * 2) return null;
      const bytes = Buffer.from(entry.bytes, 'base64'); size += bytes.length;
      if (size > MAX_INPUT) return null;
      chunks.push(bytes);
    }
    if (size) return Buffer.concat(chunks).toString('utf8');
  }
  const query = url.searchParams.toString();
  return query && Buffer.byteLength(query) <= MAX_INPUT ? query : null;
}

function legacyEvents(body) {
  if (!body) return null;
  try {
    if (body.trimStart().startsWith('[') || body.trimStart().startsWith('{')) return JSON.parse(body);
    const encoded = new URLSearchParams(body).get('data');
    if (!encoded || encoded.length > MAX_INPUT) return null;
    const decoded = Buffer.from(encoded, 'base64');
    return decoded.length <= MAX_INPUT ? JSON.parse(decoded.toString('utf8')) : null;
  } catch { return null; }
}

function errorClass(errors, code) {
  for (const error of errors.slice(0, 10)) {
    const text = (typeof error?.extensions?.code === 'string' ? error.extensions.code.slice(0, 256) : '')
      + ' ' + (typeof error?.message === 'string' ? error.message.slice(0, 1024) : '');
    if (/integrity|captcha|challenge/i.test(text)) return 'integrity';
    if (/unauthori[sz]ed|authentication|oauth/i.test(text)) return 'authentication';
    if (/rate.?limit|too many requests/i.test(text)) return 'rate-limit';
    if (/forbidden|permission/i.test(text)) return 'permission';
  }
  return code === 401 ? 'authentication' : code === 403 ? 'permission' : code === 429 ? 'rate-limit' : 'other';
}

function createWatchDiagnostics({ now = Date.now, channel = null, getExpectedChannelId = () => null,
  getExpectedAccountId = () => null, readResponse } = {}) {
  const pending = new Map(), reading = new Set();
  let epoch = 0;
  const counters = { debuggerAttached: false, networkEnabled: false, requests: 0, minuteWatchedEvents: 0, unclassifiedRequests: 0,
    responses: 0, httpErrors: 0, networkFailures: 0, lastStatus: null, lastRequestAt: null,
    lastMinuteWatchedAt: null, lastResponseAt: null, navigations: 0, lastNavigationAt: null,
    graphqlRequests: 0, graphqlResponses: 0, graphqlBodyUnavailableRequests: 0, graphqlErrorResponses: 0,
    spadeAcceptedResponses: 0, spadeRejectedResponses: 0, spadeUnavailableResponses: 0,
    lastGraphqlHttpStatus: null, lastSpadeStatusCode: null, lastSpadeErrorClass: null, lastSpadeResponseAt: null,
    watchLoggedInEvents: 0, watchLoggedOutEvents: 0, watchLoginUnknownEvents: 0, truncatedEventBatches: 0,
    lastWatchLoggedIn: null, lastWatchAccountMatches: null, lastWatchChannelMatches: null, lastWatchLive: null,
    lastWatchAdPlaying: null, lastWatchPlaybackGated: null, lastWatchMuted: null, lastWatchMinutesLogged: null,
    discardedResponseReads: 0 };

  function expected(reader) { try { return idString(reader()); } catch { return null; } }
  function consumeEvents(value, budget) {
    const events = Array.isArray(value) ? value : [value];
    let classified = false;
    for (const event of events.slice(0, budget)) {
      if (!event || typeof event.event !== 'string') continue;
      classified = true;
      if (event.event !== 'minute-watched') continue;
      const p = event.properties && typeof event.properties === 'object' ? event.properties : {};
      counters.minuteWatchedEvents++; counters.lastMinuteWatchedAt = now();
      const loggedIn = boolean(p.logged_in);
      counters.lastWatchLoggedIn = loggedIn;
      counters[loggedIn === true ? 'watchLoggedInEvents' : loggedIn === false ? 'watchLoggedOutEvents' : 'watchLoginUnknownEvents']++;
      const account = expected(getExpectedAccountId), observedAccount = idString(p.user_id);
      counters.lastWatchAccountMatches = account && observedAccount ? account === observedAccount : null;
      const expectedChannel = expected(getExpectedChannelId), observedChannel = idString(p.channel_id);
      const matches = [];
      if (expectedChannel && observedChannel) matches.push(expectedChannel === observedChannel);
      if (typeof channel === 'string' && typeof p.channel === 'string' && /^[a-z0-9_]{2,25}$/i.test(p.channel)) matches.push(channel.toLowerCase() === p.channel.toLowerCase());
      counters.lastWatchChannelMatches = matches.length ? matches.every(Boolean) : null;
      counters.lastWatchLive = boolean(p.is_live) ?? boolean(p.live);
      counters.lastWatchAdPlaying = boolean(p.is_ad_playing);
      counters.lastWatchPlaybackGated = boolean(p.playback_gated);
      counters.lastWatchMuted = boolean(p.muted);
      counters.lastWatchMinutesLogged = Number.isSafeInteger(p.minutes_logged) && p.minutes_logged >= 0 ? p.minutes_logged : null;
    }
    return { classified, used: Math.min(events.length, budget), truncated: events.length > budget };
  }

  function classify(request, location) {
    const body = requestText(request, location.url);
    if (location.kind === 'legacy') {
      const result = consumeEvents(legacyEvents(body), MAX_EVENTS);
      if (!result.classified) counters.unclassifiedRequests++;
      if (result.truncated) counters.truncatedEventBatches++;
      return { kind: 'legacy', indices: [] };
    }
    if (!body) { counters.graphqlBodyUnavailableRequests++; return null; }
    let ops, uninspectedTail = false;
    try {
      const json = JSON.parse(body), all = Array.isArray(json) ? json : [json];
      uninspectedTail = all.length > 10;
      ops = all.slice(0, 10);
      if (uninspectedTail) counters.graphqlBodyUnavailableRequests++;
    }
    catch { counters.graphqlBodyUnavailableRequests++; return null; }
    const indices = [];
    let budget = MAX_EVENTS, classified = false, failed = false, truncated = uninspectedTail;
    ops.forEach((op, index) => {
      if (typeof op?.query !== 'string' || !/\bsendSpadeEvents\s*\(/.test(op.query)) return;
      indices.push(index);
      if (budget === 0) { truncated = true; return; }
      try {
        const input = op.variables?.input;
        if (input?.encoding !== 'GZIP_B64' || typeof input.data !== 'string' || input.data.length > MAX_INPUT) throw new Error();
        const decoded = gunzipSync(Buffer.from(input.data, 'base64'), { maxOutputLength: MAX_EXPANDED });
        const result = consumeEvents(JSON.parse(decoded.toString('utf8')), budget);
        classified ||= result.classified; failed ||= !result.classified; truncated ||= result.truncated; budget -= result.used;
      } catch { failed = true; }
    });
    if (!indices.length) return null;
    if (!classified || failed || uninspectedTail) counters.unclassifiedRequests++;
    if (truncated) counters.truncatedEventBatches++;
    return { kind: 'graphql', indices, uninspectedTail };
  }

  function response(id, status) {
    const request = pending.get(id);
    if (!request || request.responded) return;
    request.responded = true; counters.responses++;
    counters.lastStatus = httpStatus(status);
    if (counters.lastStatus >= 400) counters.httpErrors++;
    counters.lastResponseAt = now();
    if (request.kind === 'graphql') { counters.graphqlResponses++; counters.lastGraphqlHttpStatus = counters.lastStatus; }
  }
  function unavailable() {
    counters.spadeUnavailableResponses++; counters.lastSpadeStatusCode = null;
    counters.lastSpadeErrorClass = 'unavailable'; counters.lastSpadeResponseAt = now();
  }
  function responseBody(result, indices) {
    if (typeof result?.body !== 'string' || result.body.length > MAX_INPUT * 2) return unavailable();
    let json;
    try {
      const bytes = result.base64Encoded === true ? Buffer.from(result.body, 'base64') : Buffer.from(result.body);
      if (bytes.length > MAX_INPUT) return unavailable();
      json = JSON.parse(bytes.toString('utf8'));
    } catch { return unavailable(); }
    const rows = Array.isArray(json) ? json : [json];
    let unknown = false, errors = false, lastCode = null, failure = null;
    for (const index of indices) {
      const item = rows[index];
      const raw = item?.data?.sendSpadeEvents?.statusCode;
      const code = httpStatus(typeof raw === 'string' && /^[1-5][0-9]{2}$/.test(raw) ? Number(raw) : raw);
      const problems = Array.isArray(item?.errors) ? item.errors : [];
      if (code !== null) lastCode = code; else unknown = true;
      if (item?.errors !== undefined && !Array.isArray(item.errors)) unknown = true;
      if (problems.length || (code !== null && (code < 200 || code >= 300))) {
        errors ||= problems.length > 0; failure ||= { code, category: errorClass(problems, code) };
      }
    }
    counters.lastSpadeResponseAt = now(); counters.lastSpadeStatusCode = failure ? failure.code : lastCode;
    if (errors) counters.graphqlErrorResponses++;
    if (failure) { counters.spadeRejectedResponses++; counters.lastSpadeErrorClass = failure.category; }
    else if (unknown) unavailable();
    else { counters.spadeAcceptedResponses++; counters.lastSpadeErrorClass = 'none'; }
  }
  async function read(id, request, length) {
    if (request.uninspectedTail || reading.size >= MAX_READS || length > MAX_INPUT || typeof readResponse !== 'function') return unavailable();
    const marker = {}; reading.add(marker);
    const started = epoch;
    try {
      const result = await readResponse(id);
      if (started !== epoch) { counters.discardedResponseReads++; return; }
      responseBody(result, request.indices);
    } catch {
      if (started === epoch) unavailable(); else counters.discardedResponseReads++;
    } finally { reading.delete(marker); }
  }

  function observe(method, params = {}) {
    if (!params || typeof params !== 'object') return;
    const id = params.requestId;
    if (method === 'Network.requestWillBeSent') {
      if (params.redirectResponse && pending.has(id)) { response(id, params.redirectResponse.status); pending.delete(id); }
      const request = params.request;
      const location = endpoint(request?.url);
      if (!location || !['GET', 'POST'].includes(request.method) || typeof id !== 'string' || pending.has(id)) return;
      const identified = classify(request, location);
      if (!identified) return;
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
      pending.set(id, { responded: false, kind: identified.kind, indices: identified.indices, uninspectedTail: identified.uninspectedTail === true });
      counters.requests++; counters.lastRequestAt = now();
      if (identified.kind === 'graphql') counters.graphqlRequests++;
    } else if (method === 'Network.responseReceived') response(id, params.response?.status);
    else if (method === 'Network.loadingFailed' && pending.has(id)) { counters.networkFailures++; pending.delete(id); }
    else if (method === 'Network.loadingFinished') {
      const request = pending.get(id); pending.delete(id);
      if (request?.kind === 'graphql') return read(id, request, params.encodedDataLength);
    }
  }

  return {
    observe,
    attached(value) { counters.debuggerAttached = value === true; if (!value) counters.networkEnabled = false; },
    enabled(value) { counters.networkEnabled = counters.debuggerAttached && value === true; },
    navigation() { epoch++; pending.clear(); counters.navigations++; counters.lastNavigationAt = now(); },
    snapshot() { return { ...counters, pendingRequests: pending.size, pendingResponseReads: reading.size }; },
  };
}

module.exports = { createWatchDiagnostics };

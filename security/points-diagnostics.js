'use strict';

// Observe the page's existing telemetry. Never send events or retain their content.
const HOSTS = new Set(['spade.twitch.tv', 'spade.sci.twitch.tv', 'beacon.twitch.tv']);
const MAX_INPUT = 64 * 1024;
const MAX_EVENTS = 100;
const MAX_PENDING = 128;

function watchEvents(body) {
  if (typeof body !== 'string' || !body || Buffer.byteLength(body) > MAX_INPUT) return null;
  try {
    let json;
    if (body.trimStart().startsWith('[') || body.trimStart().startsWith('{')) json = JSON.parse(body);
    else {
      const encoded = new URLSearchParams(body).get('data');
      if (!encoded || encoded.length > MAX_INPUT) return null;
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.length > MAX_INPUT) return null;
      json = JSON.parse(decoded.toString('utf8'));
    }
    const events = (Array.isArray(json) ? json : [json]).slice(0, MAX_EVENTS);
    if (!events.some(event => event && typeof event.event === 'string')) return null;
    return events.filter(event => event && event.event === 'minute-watched').length;
  } catch { return null; }
}

function trackingUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_INPUT) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (!url.port || url.port === '443')
      && HOSTS.has(url.hostname) && url.pathname === '/track' ? url : null;
  } catch { return null; }
}

function createWatchDiagnostics({ now = Date.now } = {}) {
  const pending = new Map();
  const counters = { debuggerAttached: false, networkEnabled: false, requests: 0, minuteWatchedEvents: 0, unclassifiedRequests: 0,
    responses: 0, httpErrors: 0, networkFailures: 0, lastStatus: null, lastRequestAt: null,
    lastMinuteWatchedAt: null, lastResponseAt: null, navigations: 0, lastNavigationAt: null };

  function response(id, status) {
    const request = pending.get(id);
    if (!request || request.responded) return;
    request.responded = true;
    counters.responses++;
    counters.lastStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    if (counters.lastStatus >= 400) counters.httpErrors++;
    counters.lastResponseAt = now();
  }

  function observe(method, params = {}) {
    const id = params.requestId;
    if (method === 'Network.requestWillBeSent') {
      if (params.redirectResponse && pending.has(id)) {
        response(id, params.redirectResponse.status);
        pending.delete(id);
      }
      const request = params.request;
      const url = trackingUrl(request && request.url);
      if (!url || !['GET', 'POST'].includes(request.method) || typeof id !== 'string' || pending.has(id)) return;
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
      pending.set(id, { responded: false });
      counters.requests++;
      counters.lastRequestAt = now();
      const count = watchEvents(request.postData || url.searchParams.toString());
      if (count === null) counters.unclassifiedRequests++;
      else if (count > 0) {
        counters.minuteWatchedEvents += count;
        counters.lastMinuteWatchedAt = now();
      }
    } else if (method === 'Network.responseReceived') response(id, params.response && params.response.status);
    else if (method === 'Network.loadingFailed' && pending.has(id)) {
      counters.networkFailures++;
      pending.delete(id);
    } else if (method === 'Network.loadingFinished') pending.delete(id);
  }

  return {
    observe,
    attached(value) { counters.debuggerAttached = value === true; if (!value) counters.networkEnabled = false; },
    enabled(value) { counters.networkEnabled = value === true; },
    navigation() { pending.clear(); counters.navigations++; counters.lastNavigationAt = now(); },
    snapshot() { return { ...counters, pendingRequests: pending.size }; },
  };
}

module.exports = { createWatchDiagnostics };

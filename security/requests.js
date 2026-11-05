'use strict';

class RequestFailure extends Error {}

async function readCookie(session, origin, name) {
  const cookies = await session.cookies.get({ url: origin, name });
  try { return cookies[0] ? decodeURIComponent(cookies[0].value) : ''; }
  catch { throw new RequestFailure('Invalid session cookie'); }
}

function createSessionClient({ getSession, getHeaders, resolveUrl, timeoutMs = 20000, maxResponseBytes = 2 * 1024 * 1024 }) {
  let generation = 0;
  let suspended = false;
  const pending = new Set();

  function invalidate() {
    generation++;
    for (const controller of pending) controller.abort();
  }

  async function request(input, { method = 'GET', body } = {}) {
    let url;
    try {
      url = resolveUrl(input);
      if (!['GET', 'POST'].includes(method)) throw new Error();
    } catch { throw new RequestFailure('Invalid request'); }
    if (suspended) throw new RequestFailure('Session unavailable');

    const started = generation;
    const controller = new AbortController();
    pending.add(controller);
    let expired = false;
    let tooLarge = false;
    const failure = () => new RequestFailure(started !== generation ? 'Session changed' : expired ? 'Request timed out' : tooLarge ? 'Response too large' : 'Request failed');
    const check = () => { if (controller.signal.aborted || generation !== started || suspended) throw failure(); };
    let onAbort;
    const aborted = new Promise((_, reject) => { onAbort = () => reject(failure()); controller.signal.addEventListener('abort', onAbort, { once: true }); });
    const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);

    async function perform() {
      const session = getSession();
      const headers = await getHeaders(session);
      check();
      const response = await session.fetch(url, {
        method, headers, credentials: 'include', redirect: 'error', signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      check();
      if (response.status >= 300 && response.status < 400) throw new RequestFailure('Request failed');
      const declared = Number(response.headers.get('content-length'));
      if (declared > maxResponseBytes) { tooLarge = true; controller.abort(); throw failure(); }
      const chunks = [];
      let size = 0;
      const reader = response.body && response.body.getReader();
      if (reader) {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            check();
            if (done) break;
            size += value.byteLength;
            if (size > maxResponseBytes) { tooLarge = true; controller.abort(); throw failure(); }
            chunks.push(Buffer.from(value));
          }
        } catch (error) {
          void reader.cancel().catch(() => {});
          throw error;
        } finally { reader.releaseLock(); }
      }
      check();
      let json = null;
      try { json = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch {}
      return { status: response.status, json };
    }

    try { return await Promise.race([perform(), aborted]); }
    catch (error) {
      if (error instanceof RequestFailure) throw error;
      if (generation !== started || expired) throw failure();
      throw new RequestFailure('Request failed');
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      pending.delete(controller);
    }
  }

  return {
    request, invalidate,
    suspend() { suspended = true; invalidate(); },
    resume() { suspended = false; },
    get generation() { return generation; },
  };
}

module.exports = { createSessionClient, readCookie };


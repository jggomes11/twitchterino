'use strict';
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), exceptions = [];
  let next = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Debug connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debug connection failed')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id); clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error('Debug connection closed')); }
    pending.clear();
  });
  return {
    exceptions,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debug command timed out: ' + method)); }, 10000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    }, close() { socket.close(); },
  };
}
async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function closePage(client) {
  try { await client.call('Page.close'); }
  catch (error) {
    // Chromium may detach a closing target before acknowledging Page.close.
    // A timeout or any other protocol error is still a failed check.
    if (error.message !== 'Debug connection closed') throw error;
  }
}
module.exports = { connect, evaluate, closePage };

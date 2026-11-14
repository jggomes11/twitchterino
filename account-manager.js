'use strict';
const { validateIpcArgs } = require('./security/ipc');
const ACCOUNT_IDS = Object.freeze(['account-1', 'account-2', 'account-3', 'account-4']);
function createAccountManager({ runtimes, initialAccountId = ACCOUNT_IDS[0] }) {
  const byId = new Map(runtimes.map(runtime => [runtime.id, runtime]));
  if (runtimes.length !== 4 || ACCOUNT_IDS.some(id => !byId.has(id))) throw new Error('Expected four account runtimes');
  let activeId = byId.has(initialAccountId) ? initialAccountId : ACCOUNT_IDS[0];
  const get = id => { if (!byId.has(id)) throw new Error('Invalid account'); return byId.get(id); };
  function contexts() { return Object.fromEntries(runtimes.map(r => [r.id, r.getIpcContext()])); }
  function summaries() {
    return runtimes.map((r,index)=>({...r.summary(),label:'Conta '+(index+1)}));
  }
  function snapshot(id = activeId, selected = get(id).snapshot()) {
    return { ...selected, accountId: id, accounts:summaries() };
  }
  return {
    contexts, snapshot, summaries, get activeId() { return activeId; },
    select(id) { get(id); activeId = id; return snapshot(); },
    acceptEvent(id) { return id === activeId; },
    async invoke(id, command, args, event) {
      const [checked] = validateIpcArgs('account:command', [{ accountId: id, command, args }], { platform: 'twitch', accounts: contexts() });
      const runtime = get(id); // Captured before any asynchronous account work.
      const result = await runtime.invoke(checked.command, event, checked.args);
      return { accountId: id, result: Array.isArray(result?.channels) ? snapshot(id,result) : result };
    },
  };
}
module.exports = { createAccountManager, ACCOUNT_IDS };

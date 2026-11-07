'use strict';
// A view epoch rejects delayed work even when the user switches A -> B -> A.
(function publish(root) {
  function createAccountViewGuard(initialAccountId = 'account-1') {
    let accountId = initialAccountId;
    let epoch = 0;
    let initialized = false;
    const current = () => ({ accountId, epoch });
    const isCurrent = ticket => ticket.accountId === accountId && ticket.epoch === epoch;
    return {
      current, isCurrent, get accountId() { return accountId; },
      select(id) {
        if (!/^account-[1-4]$/.test(id)) throw new Error('Invalid account');
        initialized = true; accountId = id; epoch++; return current();
      },
      accept(snapshot) {
        if (!snapshot || !/^account-[1-4]$/.test(snapshot.accountId)) return false;
        if (!initialized) { accountId = snapshot.accountId; initialized = true; }
        return snapshot.accountId === accountId;
      },
      async run(operation) {
        const ticket = current();
        const result = await operation();
        return isCurrent(ticket) ? result : null;
      },
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { createAccountViewGuard };
  else root.AccountView = Object.freeze({ createAccountViewGuard });
})(globalThis);

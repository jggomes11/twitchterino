'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function validationConfig(root, version, { watchAll = false } = {}) {
  const block = fs.readFileSync(path.join(root, 'account-runtime.js'), 'utf8').match(/channels:\s*(\[[\s\S]*?\])/);
  const channels = block ? [...block[1].matchAll(/'([a-z0-9_-]+)'/g)].map(match => match[1]) : [];
  assert(channels.length > 0, 'No validation channels were found');
  return {
    configVersion: 2, channels, seenDefaults: channels, farming: false, watchAll, maxWatchers: 2, rotation: true,
    autoChest: false, notifyBonus: false, notifyChest: false, notifyChat: false,
    lastSeenVersion: version, daily: {}, purchases: [],
  };
};

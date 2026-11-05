'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectReportAccount } = require('../security/accounts');

test('switching accounts archives and restores their own earnings without losing history', () => {
  const config = { reportAccount: 'id:1', daily: { day: 42 }, purchases: [{ t: 1 }], chestDaily: { day: 2 }, chestsClaimed: 2 };
  assert.equal(selectReportAccount(config, 'id:2'), true);
  assert.deepEqual(config.daily, {});
  assert.deepEqual(config.purchases, []);
  config.daily.day = 5;
  assert.equal(selectReportAccount(config, 'id:1'), true);
  assert.deepEqual(config.daily, { day: 42 });
  assert.deepEqual(config.purchases, [{ t: 1 }]);
  assert.deepEqual(config.chestDaily, { day: 2 });
  assert.equal(config.accountReports.find(report => report.account === 'id:2').daily.day, 5);
});

test('first verified identity adopts legacy reports and token rotation preserves them', () => {
  const config = { daily: { day: 42 }, purchases: [{ t: 1 }] };
  assert.equal(selectReportAccount(config, 'id:1'), false);
  assert.equal(selectReportAccount(config, 'id:1'), false);
  assert.deepEqual(config.daily, { day: 42 });
  assert.deepEqual(config.purchases, [{ t: 1 }]);
});


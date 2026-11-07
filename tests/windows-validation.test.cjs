'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp } = require('./helpers/app.cjs');
const pkg = require('../package.json');
const validationConfig = require('../scripts/validation-config.cjs');

test('manual validation starts paused with two-stream rotation selected after real startup migrations', async () => {
  const seed = validationConfig(path.resolve(__dirname, '..'), pkg.version);
  const app = loadApp({ configSeed: seed });
  await app.start();
  const actual = app.apiExports.snapshot();
  assert.equal(actual.farming, false);
  assert.equal(actual.watchAll, false);
  assert.equal(actual.maxWatchers, 2);
  assert.equal(actual.rotation, true);
  assert.equal(actual.notifyBonus, false);
  assert.equal(actual.notifyChat, false);
});

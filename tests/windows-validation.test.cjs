'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp } = require('./helpers/app.cjs');
const pkg = require('../package.json');
const validationConfig = require('../scripts/validation-config.cjs');

test('manual and CI validation profiles keep single-channel measurement settings after real startup migrations', async () => {
  const seed = validationConfig(path.resolve(__dirname, '..'), pkg.version);
  const app = loadApp({ configSeed: seed });
  await app.start();
  const actual = app.apiExports.snapshot();
  assert.equal(actual.farming, false);
  assert.equal(actual.maxWatchers, 1);
  assert.equal(actual.rotation, false);
  assert.equal(actual.notifyBonus, false);
  assert.equal(actual.notifyChat, false);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('publishing and repository metadata belong to this maintained fork', () => {
  assert.equal(pkg.repository, 'github:jggomes11/' + pkg.name);
  assert.equal(pkg.homepage, 'https://github.com/jggomes11/' + pkg.name + '#readme');
  assert.equal(pkg.build.publish[0].owner, 'jggomes11');
  assert.equal(pkg.build.publish[0].repo, pkg.name);
});

test('packaging carries the modules required by the main-process security boundary', () => {
  assert.ok(pkg.build.files.includes('security/**/*'));
  assert.equal(pkg.build.appId, 'com.vinniisaantos.' + pkg.name);
});


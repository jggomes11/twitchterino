'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');

assert.equal(process.platform, 'win32', 'Prepare release candidates on native Windows');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release-output');
assert(!fs.existsSync(output), 'Refusing to reuse existing release output');
fs.mkdirSync(output, { recursive: true });
const installer = 'Twitchterino-Setup.exe';
assert(fs.statSync(path.join(root, 'dist', installer)).size > 0, 'Missing release installer');
fs.copyFileSync(path.join(root, 'dist', installer), path.join(output, installer));
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(output, 'release-build-info.json'), JSON.stringify({
  version: pkg.version, sourceSha, signed: false, platform: 'win32', arch: 'x64',
  profile: 'default-user-data', accounts: 4, applicationWindows: 1, distribution: 'nsis-installer',
}, null, 2) + '\n');
console.log(`Prepared Windows release ${pkg.version} from ${sourceSha}`);

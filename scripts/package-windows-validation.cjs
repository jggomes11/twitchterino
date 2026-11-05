'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'validation-output');
const app = path.join(stage, 'app');
assert.equal(process.platform, 'win32', 'Package native Windows output on Windows');
const source = path.join(root, 'dist', 'win-unpacked');
assert(fs.existsSync(path.join(source, pkg.productName + '.exe')), 'Missing Windows executable');
fs.mkdirSync(stage, { recursive: true });
fs.rmSync(app, { recursive: true, force: true });
fs.cpSync(source, app, { recursive: true });
const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.isFile()) files.push({
      path: path.relative(app, full).split(path.sep).join('/'),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
    });
    else throw new Error('Unexpected non-file in packaged application');
  }
}
visit(app);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const variable = pkg.name === 'twitchterino' ? 'TWITCHTERINO_DATA' : 'KICKTERINO_DATA';
fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify({
  repository: pkg.name, executable: pkg.productName + '.exe', version: pkg.version, sourceSha,
  profileVariable: variable, signed: false, purpose: 'isolated manual validation, not a release',
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2) + '\n');
fs.writeFileSync(path.join(stage, 'validation-defaults.json'),
  JSON.stringify(require('./validation-config.cjs')(root, pkg.version), null, 2) + '\n');
fs.copyFileSync(path.join(root, 'scripts', 'Start-WindowsValidation.ps1'), path.join(stage, 'Start-WindowsValidation.ps1'));
fs.copyFileSync(path.join(root, 'docs', 'WINDOWS_VALIDATION.md'), path.join(stage, 'WINDOWS_VALIDATION.md'));
console.log('Prepared isolated Windows validation bundle for ' + pkg.name + ' at ' + sourceSha);


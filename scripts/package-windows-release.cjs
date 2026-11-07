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
fs.mkdirSync(path.join(output, 'portable'), { recursive: true });
for (const name of ['Twitchterino-Setup.exe']) {
  assert(fs.statSync(path.join(root, 'dist', name)).size > 0, 'Missing release executable: ' + name);
  fs.copyFileSync(path.join(root, 'dist', name), path.join(output, name));
}
// Directory portability avoids self-extractor cleanup races across processes.
fs.cpSync(path.join(root, 'dist', 'win-unpacked'), path.join(output, 'portable', 'app'), { recursive: true });
assert(fs.existsSync(path.join(output, 'portable', 'app', 'Twitchterino.exe')), 'Missing portable application');
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'portable', 'LICENSE.txt'));
const launcher = [
  '@echo off', 'setlocal',
  'set "ELECTRON_NO_ATTACH_CONSOLE=1"',
  'set "TWITCHTERINO_DATA=%LOCALAPPDATA%\\Twitchterino-Accounts"',
  'start "" "%~dp0app\\Twitchterino.exe"', 'endlocal', '',
].join('\r\n');
fs.writeFileSync(path.join(output, 'portable', 'Abrir-Twitchterino.cmd'), launcher, 'ascii');
const instructions = [
  `Twitchterino ${pkg.version} - quatro contas na mesma janela - Windows x64`, '',
  'Extraia TODO o ZIP e abra Abrir-Twitchterino.cmd uma vez.',
  'Selecione Conta 1, Conta 2, Conta 3 e Conta 4 na mesma janela.',
  'Faca login em uma conta diferente da Twitch em cada uma, somente na pagina oficial.',
  'Trocar a conta exibida mantem as outras coletando em segundo plano.',
  'Cada conta guarda sessao, canais, configuracoes e relatorios separados.',
  'Novas contas usam duas lives, Foco em bonus e Pegar bau sozinho ligados.',
  'A Twitch decide a elegibilidade dos pontos. Abrir mais lives nao aumenta o limite.',
  'Os dados deste pacote ficam em %LOCALAPPDATA%\\Twitchterino-Accounts.',
  'Perfis dos pacotes RC2/validacao nao sao importados: entre novamente nas contas.',
  'Use o mesmo atalho nas atualizacoes. Reabri-lo mostra a janela existente.',
  'Antes de substituir arquivos, feche o app pelo menu Sair da bandeja.',
  'Para testar pontos, mantenha apenas uma instancia por conta, incluindo versoes anteriores.',
  'O instalador mantem a identidade original e usa o perfil padrao separado deste ZIP.',
  'Executaveis sem assinatura digital; atualizacoes automaticas desligadas.',
  'Nao envie pastas de perfil, senhas, cookies ou tokens.', '',
  'Projeto original: https://github.com/ViinniSantoos/twitchterino (MIT)',
  'Fork: https://github.com/jggomes11/twitchterino', '',
].join('\r\n');
fs.writeFileSync(path.join(output, 'portable', 'LEIA-ME.txt'), instructions, 'ascii');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(output, 'release-build-info.json'), JSON.stringify({
  version: pkg.version, sourceSha, signed: false, platform: 'win32', arch: 'x64',
  profileRoot: '%LOCALAPPDATA%\\Twitchterino-Accounts', accounts: 4, applicationWindows: 1, portableFormat: 'directory-zip',
}, null, 2) + '\n');
console.log(`Prepared Windows release ${pkg.version} from ${sourceSha}`);

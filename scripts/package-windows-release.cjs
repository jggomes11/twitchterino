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
for (let profile = 1; profile <= 4; profile++) {
  const launcher = [
    '@echo off', 'setlocal',
    `set "TWITCHTERINO_DATA=%LOCALAPPDATA%\\Twitchterino-Profiles\\Conta-${profile}"`,
    'start "" "%~dp0app\\Twitchterino.exe"', 'endlocal', '',
  ].join('\r\n');
  fs.writeFileSync(path.join(output, 'portable', `Abrir-Conta-${profile}.cmd`), launcher, 'ascii');
}
const instructions = [
  `Twitchterino ${pkg.version} - quatro contas no Windows x64`, '',
  'Extraia TODO o ZIP. Abra Abrir-Conta-1.cmd, Abrir-Conta-2.cmd,',
  'Abrir-Conta-3.cmd e Abrir-Conta-4.cmd. Faca login em uma conta diferente em cada janela.',
  'Cada atalho usa uma pasta independente em %LOCALAPPDATA%\\Twitchterino-Profiles\\Conta-N.',
  'Use sempre o mesmo atalho para a mesma conta, inclusive depois de atualizar o pacote.',
  'Reabrir o mesmo atalho deve trazer a instancia existente, sem criar outra no mesmo perfil.',
  'Ative Todas as lives online e Juntar pontos em cada perfil conforme necessario.',
  'Os quatro perfis aumentam o consumo de memoria, CPU e rede. A Twitch decide a elegibilidade dos pontos.',
  'Feche pelo menu Sair da bandeja antes de substituir os arquivos do pacote.',
  'Os perfis de validacao anteriores nao sao copiados: entre novamente em cada conta.',
  'Abrir app\\Twitchterino.exe diretamente usa o perfil padrao, separado dos quatro atalhos.',
  'Executaveis sem assinatura digital; atualizacoes automaticas desligadas.',
  'Instalador e app original usam o mesmo identificador: o instalador nao cria uma instalacao lado a lado.',
  'Nao envie pastas de perfil, senhas, cookies ou tokens.', '',
  'Projeto original: https://github.com/ViinniSantoos/twitchterino (MIT)',
  'Fork: https://github.com/jggomes11/twitchterino', '',
].join('\r\n');
fs.writeFileSync(path.join(output, 'portable', 'LEIA-ME.txt'), instructions, 'ascii');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(output, 'release-build-info.json'), JSON.stringify({
  version: pkg.version, sourceSha, signed: false, platform: 'win32', arch: 'x64',
  profileRoot: '%LOCALAPPDATA%\\Twitchterino-Profiles', profiles: 4, portableFormat: 'directory-zip',
}, null, 2) + '\n');
console.log(`Prepared Windows release ${pkg.version} from ${sourceSha}`);

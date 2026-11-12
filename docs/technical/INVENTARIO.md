# Inventário rastreado — Twitchterino

Fonte: `git ls-files` e conteúdo em `622386ccd1d511814d3a77c8e96c06f10c509007`. **70 arquivos** classificados; dependências instaladas e saídas ignoradas não fazem parte desta contagem. Valores de linhas são do arquivo de origem; esta documentação foi adicionada depois. Hashes/bytes de todos os itens em [snapshot.json](snapshot.json). Não é uma auditoria de cada dependência transitiva nem de sites externos.

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| [.github/workflows/publish-verified-release.yml](../../.github/workflows/publish-verified-release.yml) | 37 | Workflow CI/release; descrito em VALIDAÇÃO E ENTREGA |
| [.github/workflows/windows-validation.yml](../../.github/workflows/windows-validation.yml) | 218 | Workflow CI/release; descrito em VALIDAÇÃO E ENTREGA |
| [.gitignore](../../.gitignore) | 12 | Exclusões de dependências, saídas de build e scratch |
| [LICENSE](../../LICENSE) | 21 | Licença MIT/autoria preservada |
| [README.md](../../README.md) | 70 | Guia do produto, instalação e limitações |
| [account-manager.js](../../account-manager.js) | 31 | Seleção/agregação/despacho dos quatro slots |
| [account-runtime.js](../../account-runtime.js) | 1527 | Comportamentos por conta, mídia, integração e regras |
| [build/ICON_SOURCE.md](../../build/ICON_SOURCE.md) | 15 | Recurso de empacotamento/ícone e sua procedência; não lógica de coleta |
| [build/icon.ico](../../build/icon.ico) | binário | Recurso de empacotamento/ícone e sua procedência; não lógica de coleta |
| [build/icon.png](../../build/icon.png) | binário | Recurso de empacotamento/ícone e sua procedência; não lógica de coleta |
| [build/twitch-glitch.svg](../../build/twitch-glitch.svg) | 21 | Recurso de empacotamento/ícone e sua procedência; não lógica de coleta |
| [docs/WINDOWS_VALIDATION.md](../../docs/WINDOWS_VALIDATION.md) | 50 | Guia de teste Windows e perfis isolados |
| [docs/app.png](../../docs/app.png) | binário | Imagem/documentação pública; não dados de usuário |
| [docs/icon.png](../../docs/icon.png) | binário | Imagem/documentação pública; não dados de usuário |
| [docs/index.html](../../docs/index.html) | 96 | Site estático de divulgação/download, separado da UI do app |
| [docs/parceiros.json](../../docs/parceiros.json) | 3 | Lista pública de parceiros do fork (runtime consulta upstream explicitamente) |
| [docs/releases/v0.1.3.pt-BR.md](../../docs/releases/v0.1.3.pt-BR.md) | 37 | Notas de versão históricas/publicadas |
| [docs/releases/v0.1.4.pt-BR.md](../../docs/releases/v0.1.4.pt-BR.md) | 18 | Notas de versão históricas/publicadas |
| [docs/releases/v0.1.5.pt-BR.md](../../docs/releases/v0.1.5.pt-BR.md) | 7 | Notas de versão históricas/publicadas |
| [docs/style.css](../../docs/style.css) | 81 | CSS do site estático |
| [docs/superpowers/plans/2026-11-04-security-hardening.md](../../docs/superpowers/plans/2026-11-04-security-hardening.md) | 68 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/plans/2026-11-05-session-and-all-live.md](../../docs/superpowers/plans/2026-11-05-session-and-all-live.md) | 57 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/plans/2026-11-07-four-account-release.md](../../docs/superpowers/plans/2026-11-07-four-account-release.md) | 46 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/plans/2026-11-07-multi-account-window.md](../../docs/superpowers/plans/2026-11-07-multi-account-window.md) | 59 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/specs/2026-11-04-security-hardening-design.md](../../docs/superpowers/specs/2026-11-04-security-hardening-design.md) | 81 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/specs/2026-11-05-session-and-all-live.md](../../docs/superpowers/specs/2026-11-05-session-and-all-live.md) | 19 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/specs/2026-11-07-four-account-release-design.md](../../docs/superpowers/specs/2026-11-07-four-account-release-design.md) | 17 | Plano/design histórico; confrontar intenção com código vigente |
| [docs/superpowers/specs/2026-11-07-multi-account-window-design.md](../../docs/superpowers/specs/2026-11-07-multi-account-window-design.md) | 25 | Plano/design histórico; confrontar intenção com código vigente |
| [main.js](../../main.js) | 146 | Shell Electron e ciclo global |
| [package-lock.json](../../package-lock.json) | 3566 | Resolução reprodutível de dependências de build |
| [package.json](../../package.json) | 94 | Manifesto, scripts, versões e empacotamento |
| [preload.js](../../preload.js) | 67 | Ponte IPC local e filtragem por conta |
| [renderer/features.css](../../renderer/features.css) | 88 | Estilos de bônus, relatórios e contas |
| [renderer/index.html](../../renderer/index.html) | 112 | Estrutura da UI e CSP |
| [renderer/renderer.js](../../renderer/renderer.js) | 836 | DOM/chat/controles/modais/notificações |
| [renderer/style.css](../../renderer/style.css) | 115 | Estilos base |
| [renderer/theme.css](../../renderer/theme.css) | 268 | Tema e disposição/responsividade |
| [scripts/Start-WindowsValidation.ps1](../../scripts/Start-WindowsValidation.ps1) | 39 | Launcher/perfil/verificação de integridade Windows |
| [scripts/account-fixture.cjs](../../scripts/account-fixture.cjs) | 20 | Asserções de defaults/partições e encerramento natural |
| [scripts/cdp-client.cjs](../../scripts/cdp-client.cjs) | 47 | Cliente CDP de teste e tratamento de desconexão |
| [scripts/diagnose-twitch-public.cjs](../../scripts/diagnose-twitch-public.cjs) | 36 | Probe Electron de GraphQL público |
| [scripts/package-windows-release.cjs](../../scripts/package-windows-release.cjs) | 21 | Preparação do instalador e metadados de origem |
| [scripts/package-windows-validation.cjs](../../scripts/package-windows-validation.cjs) | 42 | Bundle isolado com launcher/manifesto |
| [scripts/profile-process.cjs](../../scripts/profile-process.cjs) | 13 | Identificação/encerramento de processos de teste |
| [scripts/test-electron.cjs](../../scripts/test-electron.cjs) | 16 | Runner Electron isolado com perfil temporário |
| [scripts/validate-accounts.cjs](../../scripts/validate-accounts.cjs) | 142 | Validação nativa Windows do app empacotado |
| [scripts/validate-desktop.cjs](../../scripts/validate-desktop.cjs) | 306 | Validação de UI/login oficial empacotado sem credenciais |
| [scripts/validation-config.cjs](../../scripts/validation-config.cjs) | 15 | Defaults pausados/perfis da validação |
| [security/account-view.js](../../security/account-view.js) | 30 | Época da seleção e rejeição de respostas antigas |
| [security/accounts.js](../../security/accounts.js) | 25 | Adoção/arquivo de relatórios por identidade |
| [security/chest.js](../../security/chest.js) | 28 | Script estático de clique restrito do baú |
| [security/ipc.js](../../security/ipc.js) | 136 | Validação de origem/argumentos de comandos |
| [security/platform.js](../../security/platform.js) | 53 | Allowlist de endpoints e construção de headers |
| [security/requests.js](../../security/requests.js) | 97 | Transporte, abort, limite de corpo e cookies |
| [tests/account-fixture.test.cjs](../../tests/account-fixture.test.cjs) | 22 | Critérios da fixture de perfis e exigência de encerramento natural; falhas não viram sucesso por cleanup. |
| [tests/account-view.test.cjs](../../tests/account-view.test.cjs) | 77 | Respostas atrasadas, seleção A→B→A, ponte congelada, reload, notificações e captura de conta. |
| [tests/accounts.test.cjs](../../tests/accounts.test.cjs) | 26 | Arquivar/restaurar relatórios por identidade; adotar histórico legado. |
| [tests/application.test.cjs](../../tests/application.test.cjs) | 470 | Aplicação real carregada sob doubles Electron: transporte, identidade, logout e comandos; não é login real. |
| [tests/chest.test.cjs](../../tests/chest.test.cjs) | 171 | Clique restrito de bônus, fila, confirmação, sessão e falhas do baú. |
| [tests/electron-fixture.cjs](../../tests/electron-fixture.cjs) | 109 | Fixture/helper: ver contratos e efeitos simulados no arquivo |
| [tests/helpers/app.cjs](../../tests/helpers/app.cjs) | 140 | Fixture/helper: ver contratos e efeitos simulados no arquivo |
| [tests/ipc.test.cjs](../../tests/ipc.test.cjs) | 116 | Autenticação de origem/frame e validação de argumentos/limites. |
| [tests/multi-account.test.cjs](../../tests/multi-account.test.cjs) | 99 | Quatro runtimes/sessões, configs independentes, origem de comandos/popups e continuidade em background. |
| [tests/platform.test.cjs](../../tests/platform.test.cjs) | 57 | Destinos/cabeçalhos e caminhos permitidos do transporte; há casos das duas plataformas no módulo compartilhado. |
| [tests/policy.test.cjs](../../tests/policy.test.cjs) | 17 | Metadados do fork, inclusão de módulos e política de pacote/updater conforme asserções do arquivo. |
| [tests/profile-autostart.test.cjs](../../tests/profile-autostart.test.cjs) | 39 | Seleção de perfil alternativo e autostart sem tomar registro de outro perfil. |
| [tests/profile-process.test.cjs](../../tests/profile-process.test.cjs) | 16 | Ciclo de vida de processo/encerramento das ferramentas de validação. |
| [tests/requests.test.cjs](../../tests/requests.test.cjs) | 112 | Timeout/abort, redirects, limites, cookies malformados e invalidação do cliente. |
| [tests/rewards.test.cjs](../../tests/rewards.test.cjs) | 72 | Preço/ID de recompensa, gasto pendente e combinações ambíguas nas inferências de compra. |
| [tests/windows-validation.test.cjs](../../tests/windows-validation.test.cjs) | 20 | Pacote/launcher de validação, integridade, perfis e defaults de teste. |

## Documentação acrescentada por este levantamento

`README.md`, `ESTADO_ATUAL.md`, `REGRAS_NEGOCIO.md`, `DESEMPENHO.md`, `VALIDACAO_E_ENTREGA.md`, `INVENTARIO.md`, `COMPARATIVO.md`, `defaults.example.json`, `snapshot.json` nesta pasta. O README da raiz recebe um link de entrada. Não são contados recursivamente como arquivos da base anterior.

`defaults.example.json` é extraído da constante DEFAULT_CONFIG em código. É um exemplo público da versão atual, **não** um schema JSON validado pelo aplicativo nem uma exportação de perfil. Campos criados por migração/uso estão descritos no estado atual.

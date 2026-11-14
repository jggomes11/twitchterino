# Validação, operação e entrega — Twitchterino

## Evidência desta varredura

- Comando: `npm test`, diretório do projeto, Node 24.22.1, Linux do ambiente de desenvolvimento.
- Resultado observado: **86 testes, 86 passaram, 0 falhas**.
- Reexecutar suite não é medição de desempenho, teste de login real ou validação nativa Windows nova.
- Alterações desta tarefa são documentação e links no README; não houve mudança em código, dependências, empacotamento ou binários.

## Matriz de testes rastreados

| Arquivo | O que exercita |
| --- | --- |
| [tests/account-fixture.test.cjs](../../tests/account-fixture.test.cjs) | Critérios da fixture de perfis e exigência de encerramento natural; falhas não viram sucesso por cleanup. |
| [tests/account-view.test.cjs](../../tests/account-view.test.cjs) | Respostas atrasadas, seleção A→B→A, ponte congelada, reload, notificações e captura de conta. |
| [tests/accounts.test.cjs](../../tests/accounts.test.cjs) | Arquivar/restaurar relatórios por identidade; adotar histórico legado. |
| [tests/application.test.cjs](../../tests/application.test.cjs) | Aplicação real carregada sob doubles Electron: transporte, identidade, logout e comandos; não é login real. |
| [tests/chest.test.cjs](../../tests/chest.test.cjs) | Clique restrito de bônus, fila, confirmação, sessão e falhas do baú. |
| [tests/ipc.test.cjs](../../tests/ipc.test.cjs) | Autenticação de origem/frame e validação de argumentos/limites. |
| [tests/multi-account.test.cjs](../../tests/multi-account.test.cjs) | Quatro runtimes/sessões, configs independentes, origem de comandos/popups e continuidade em background. |
| [tests/platform.test.cjs](../../tests/platform.test.cjs) | Destinos/cabeçalhos e caminhos permitidos do transporte; há casos das duas plataformas no módulo compartilhado. |
| [tests/policy.test.cjs](../../tests/policy.test.cjs) | Metadados do fork, inclusão de módulos e política de pacote/updater conforme asserções do arquivo. |
| [tests/profile-autostart.test.cjs](../../tests/profile-autostart.test.cjs) | Seleção de perfil alternativo e autostart sem tomar registro de outro perfil. |
| [tests/profile-process.test.cjs](../../tests/profile-process.test.cjs) | Ciclo de vida de processo/encerramento das ferramentas de validação. |
| [tests/requests.test.cjs](../../tests/requests.test.cjs) | Timeout/abort, redirects, limites, cookies malformados e invalidação do cliente. |
| [tests/rewards.test.cjs](../../tests/rewards.test.cjs) | Preço/ID de recompensa, gasto pendente e combinações ambíguas nas inferências de compra. |
| [tests/windows-validation.test.cjs](../../tests/windows-validation.test.cjs) | Pacote/launcher de validação, integridade, perfis e defaults de teste. |

Doubles de Electron no helper rodam código do app em VM, capturam chamadas, janelas e efeitos; não reproduzem todos os comportamentos de Chromium/Windows. Testes de platform/ipc podem conter caminhos de ambas as plataformas por reaproveitamento; isso não prova que os dois produtos tenham as mesmas funções.

### Fixtures e ferramentas adicionais

- [tests/electron-fixture.cjs](../../tests/electron-fixture.cjs) via `npm run test:electron`: Electron real, servidor local e credenciais fictícias para transporte e proteção. Flags Linux headless/no-sandbox são confinadas ao runner de teste.
- [scripts/validate-accounts.cjs](../../scripts/validate-accounts.cjs): executável Windows real em perfil temporário, quatro janelas de login/partições com cookies fictícios, preferências, segunda execução e quit/reopen natural. Sem contas autenticadas e sem prova de pontos reais.
- `scripts/diagnose-twitch-public.cjs` testa GraphQL público sem conta; `scripts/validate-desktop.cjs` inspeciona UI empacotada e navegação oficial. O launcher PowerShell seleciona somente perfis isolados de validação.

## Pipeline vigente

O workflow principal é disparado por PR ou workflow_dispatch. Em Windows 2025 (ou 2022 pela entrada), usa Node24, `npm ci --ignore-scripts`, instala Electron pinado, executa suite, fixture Electron, diagnóstico GraphQL público, audits, build sem publish e validação empacotada de UI/login oficial. Prepara bundle isolado com launcher PowerShell e hashes. Com `release=true`, gera NSIS, copia candidato, valida quatro partições e calcula checksum. Sem release, valida o diretório unpacked. Publicação genérica do job dedicado exige main e entradas explícitas; upload de preview também tem guardas de origem e tag. Actions principais estão pinadas em SHA no workflow original.

Fonte: [.github/workflows/windows-validation.yml](../../.github/workflows/windows-validation.yml).

Há também [.github/workflows/publish-verified-release.yml](../../.github/workflows/publish-verified-release.yml), criado para publicar **esta versão específica**: branch explícita, filtro por mudança do próprio YAML, SOURCE/VERSION/run ID/nome de artefato fixos, validação de metadados e SHA256SUMS e upload com token do próprio repositório. Não é um serviço automático de update nem uma rotina genérica para novas versões. Não editar esse workflow incidentalmente durante documentação/migração, pois ele tem efeito externo de publicação.

## Release publicada e identidade do instalador

| Campo | Valor conferido |
| --- | --- |
| Release | [v0.1.5](https://github.com/jggomes11/twitchterino/releases/tag/v0.1.5) |
| Código usado no build | `a0942c6bb25a6a142fdab5a09c4b199a5b698e00` |
| Build/validação Windows | [Actions 43143531286](https://github.com/jggomes11/twitchterino/actions/runs/43143531286) — success |
| Publicação | [Actions 43146970068](https://github.com/jggomes11/twitchterino/actions/runs/43146970068) — publicação concluída nesta conversa |
| Executável | `Twitchterino-Setup.exe` |
| SHA-256 do instalador conferido | `e7eeea9c27adcfe35150cd1d2fb764829b14345dc6b28b8f69f73559aece2768` |
| Aplicação | `com.vinniisaantos.twitchterino`; mesmo userData padrão da instalação existente |
| Distribuição | NSIS, instalação por usuário/oneClick, atalhos de desktop/menu, inicia após instalar |
| Assinatura/update | Sem assinatura digital; sem verificação/download/instalação automática |
| Ícones | Glitch oficial Twitch: PNG do runtime/bandeja e ICO Windows multirresolução; procedência em build/ICON_SOURCE.md |

Os assets da release incluem instalador, `SHA256SUMS.txt`, `release-build-info.json` e `account-validation.json`. JSON/texto são evidências, não aplicativos portáteis. Arquivos de source code gerados pelo GitHub são separados do instalador. O pacote contém LICENSE, main/manager/runtime, preload, renderer, PNG e security/**; scripts de CI e perfis não entram no aplicativo.

O script package-windows-release.cjs exige Windows e copia um NSIS já construído para release-output, escrevendo versão/commit; checksum é produzido depois pelo workflow.

O campo sourceSha do relatório de partições corresponde ao commit de build na release.

## Execução local e manutenção

```sh
npm ci
npm test
npm run test:electron
npm start
```

Compilação de diretório Linux para inspeção: `npm run dist:linux -- --dir --publish never`. No ambiente restrito foi necessário usar caches graváveis/uma distribuição Electron local da mesma versão; isso é adaptação do ambiente, não alteração de produto. Para Windows, executar pipeline nativo ou `npm run dist -- --publish never` no Windows. Não publicar apenas por um build compilar: conferir origem, assertions e hashes.

Sempre sair pela bandeja antes de atualizar. Não importar automaticamente pastas de navegador; uma engine nova pode não ler armazenamento/cookies criptografados do Electron. Canais, preferências, relatórios e perfil precisam de plano de migração explícito. Não enviar perfis ou tokens a repositórios/relatórios.

## Lacunas e alcance da evidência

- Nenhum teste sintético prova que a plataforma credita pontos em contas reais ou garante suporte futuro dos endpoints.
- A conversa/README registra aceitação histórica de login/coleta/baú e duas contas reais no Twitchterino. Não reinterpretar isso como quatro contas reais verificadas ou nova execução ao preparar esta documentação.
- No Kickterino há medições históricas do projeto original sobre duas lives; não houve nova medição real neste levantamento.
- Regras de ranking, custo de longas sessões, compra externa, DST/relógio alterado, falhas de escrita/crash e crescimento de arquivos lógicos não têm equivalência integral garantida pelos totais de testes.
- Migração de cookies entre engines, funcionamento de login social e reprodução oculta precisam de investigação específica. Não há perfil de RAM/CPU/GPU/rede por cenário nesta base.
- Datas/duração de bônus usam relógio local e timestamp do PC; comportamento em alteração de relógio/fuso não é contrato formal validado.

Essas lacunas são entradas para a fase seguinte, não autorização para mudar regras de negócio silenciosamente.

# Electron Performance and Bonus Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir recursos ociosos do Electron mantendo regras e preparar paridade de bônus Kick/Twitch, com novas métricas comparáveis.

**Architecture:** Shell coordena métricas/estado e runtimes preservam contas, Session e credenciais independentes. Login passa a ser uma janela sob demanda, separada de consultas nativas. Política de bônus usa contrato canônico com adaptadores específicos; implementar a paridade Kick em uma entrega funcional separada do benchmark de otimização.

**Tech Stack:** Electron/Node/HTML/CSS/JS existentes; Windows x64; sem atualização de dependências nesta rodada.

**Spec:** [Auditoria e requisitos concretos](../../performance/2026-11-13-electron-review.md). O documento distingue evidências, hipóteses e dependências de integração. Este é um plano proposto; implementação pendente.

## Global Constraints

- Preservar quatro slots, cookies e perfis existentes, rotação/tokens, relatórios, lojas, chat e disposição da UI.
- Benchmark principal já medido: duas contas × duas lives, UI aberta; warmup600 s + observação1800 s. Não reduzir players para obter economia.
- Sessões e dados privados separados; apenas manifesto público pode compartilhar busca/cache.
- Não alterar flags de reprodução, qualidade efetiva ou versão Electron junto da primeira otimização.
- Novo build de teste identificado por commit; manter release de referência sem publicar uma nova estável nesta etapa.
- Não prometer economia com base em testes sintéticos. Kick exige sua própria coleta antes/depois.

## Review Focus

- Renovação da mesma identidade conserva referência de pontos; troca/logout invalida respostas, janelas e dados antigos.
- Slots vazios ou desconectados não bloqueiam a UI; login persistente funciona sem renderer de login.
- A→B→A, popups e respostas assíncronas mantêm a conta capturada na origem.
- Dispose cancela timers/listeners/retries e não ressuscita recursos; falha de rede não trava indefinidamente.
- Catálogo desconhecido não equivale a recompensa disponível; compra inferida não equivale a resgate confirmado.

## Task 1: Shell com métricas únicas e estado leve

**Files:** main.js; account-manager.js; account-runtime.js; tests/multi-account.test.cjs; tests/helpers/app.cjs; novo tests/performance.test.cjs.
**Interfaces:** runtime.summary() retorna somente id/username/loggedIn/sessionChecking/farming/watching/today; manager.summaries() usa esses resumos; snapshot da conta conserva os campos privados próprios. Shell injeta métricas globais uma vez por ciclo de emissão e agrupa pedidos de broadcast no mesmo turno; comandos mantêm respostas e identidade imediatas.

- [ ] Escrever testes que contam getAppMetrics em um snapshot global e comprovam que bandeja/resumos não chamam métricas nem constroem canais de contas ocultas; executar e observar falhas.
- [ ] Implementar summary/summaries, retirar leituras globais de snapshots por conta e centralizar timer de status no shell. Estado de autostart lido uma vez por agregado e atualizado após comando.
- [ ] Agrupar solicitações simultâneas de broadcast; atualizar menu/tooltip quando seus campos mudarem. Não atrasar captura da conta em comandos.
- [ ] Testar A→B→A, contas ocultas coletando, erro em comando e bandeja/retorno da janela. Executar npm test e revisão do diff; commit.

## Task 2: Login sob demanda e lifecycle

**Files:** account-runtime.js; tests/application.test.cjs; tests/multi-account.test.cjs; scripts/account-fixture.cjs; scripts/validate-accounts.cjs.
**Interfaces:** ensureLoginWindow() cria/reutiliza uma janela do slot; consultas e leitura de cookies usam Session mesmo quando apiWin é null. Fechar/liberar login preserva Session. Guardas de época/identidade continuam obrigatórias em toda continuação assíncrona.

- [ ] Escrever testes para partida com zero janelas de login, sessão persistida sem janela, criação/reuso no comando login e fechamento/cancelamento; observar RED antes da implementação.
- [ ] Tornar login sob demanda; remover dependências incorretas de apiWin em polling/cookies/retorno de suspensão/logout. Cancelar readiness/listeners/retries quando a janela for substituída ou destruída.
- [ ] Testar token renovado, troca de identidade e logout durante request, popup OAuth vinculado ao slot, loadURL rejeitado e retorno de rede.
- [ ] Validar nativamente quatro perfis, cookies persistentes após reinício, páginas remotas sem IPC, UI e encerramento natural. npm test e npm run test:electron; commit.

## Task 3: Trabalho público e timers

**Files:** account-runtime.js; novo security/timers.js e tests/timers.test.cjs (Twitch); adaptador de manifesto público e tests correspondentes; testes existentes de ciclo de vida.
**Interfaces:** withTimeout(promise, ms) limpa o timer em sucesso/erro; timers por runtime cancelados no dispose. Uma busca in-flight do manifesto público serve os slots, com aplicação independente e sem cookies/caches privados compartilhados.

- [ ] Testar timeout/sucesso/rejeição e stop seguido de callbacks tardios. Testar manifesto concorrente, falha e configuração independente de canais; observar RED.
- [ ] Twitch: corrigir withTimeout e registrar one-shots/reconnect/retries; Kick: conservar helper e cancelamento já corretos.
- [ ] Compartilhar somente a obtenção do manifesto público, com limite de resposta/timeout e intervalo já existente, mantendo seenDefaults e remoções por conta.
- [ ] Executar suíte completa e verificações nativas afetadas; commit.

## Task 4: Instrumentação e novo ensaio

**Files:** helper de diagnóstico opt-in; scripts/package-windows-validation.cjs; novo scripts/Measure-Application.ps1 (cópia do coletor validado); docs/performance.
**Interfaces:** inventário por janela registra accountId, papel, webContentsId, PID de renderer e estado, sem cookies/token/chat. Metadados identificam fonte/versão. O coletor externo permanece igual para antes/depois.

- [ ] Incorporar scripts/Measure-Application.ps1 a partir do Measure-Prototype.ps1 validado em Windows nos commits Twitch 0c3a62b / Kick 5c887d6, sem alterar a lógica de métricas. Executar os testes de seleção de processo por caminho/PID e de coleta nos dois PowerShells.
- [ ] Testar inventário com campos permitidos e rejeitar inclusão de segredos; implementar apenas modo de diagnóstico opt-in com tamanho limitado.
- [ ] Construir ZIP Windows de teste e validar hash/fonte, UI, isolamento e encerramento; revisão final independente.
- [ ] Medir no PC do usuário o cenário de quatro lives, mesmos canais/qualidade e UI aberta; conferir pontos nas quatro. Preservar summaries e CSVs e comparar mediana/p95/pico.
- [ ] Rodadas adicionais: uma conta/duas lives, bandeja, três repetições e >=8 h. Declarar resultados por cenário, sem extrapolar para outra plataforma.

## Task 5: Paridade de bônus Kick em entrega separada

**Files Kick:** account-runtime.js; renderer/index.html; renderer/renderer.js; security/ipc.js; security/accounts.js; novo módulo puro de política de bônus e testes com fixtures canônicas da Twitch. Twitch serve como referência de comportamento; não reescrever sua política junto da otimização.
**Interfaces:** alvo '' ou kind:hours; recompensa {id,kind,hours,cost,available,title}; catálogo known/unknown/error; compra preserva origem manual/confirmed/legacy-inferred.

- [ ] Validar fonte real do catálogo que a loja oficial apresenta ao espectador. Registrar payload redigido/schema e autoridade; não inventar endpoint nem assumir escopo de broadcaster.
- [ ] Criar casos canônicos para preços por canal, pacotes1/3/5/10h, estoque, custo ausente, desempate, margem50, cooldown30min e ausência de aviso no saldo inicial; exigir resultados iguais nas duas políticas.
- [ ] Migrar metas0/300/500/1000 de forma idempotente e históricos por identidade/slot; preservar valores antigos e origem inferida. Testar reabertura e schema misto.
- [ ] Adaptar UI/IPC/relatório/cronômetros/modo dormir ao contrato único, sem compra automática de recompensa paga e sem transportar baú Twitch para Kick.
- [ ] Testar catálogo desconhecido/erro, recompensas indisponíveis, identidade alterada e confirmação real de resgate. Sem fonte validada, manter o recurso marcado como não verificado e registrar a pendência de integração.
- [ ] Rodada de aceite funcional separada da medição de otimização; revisão e artefato Windows de teste.

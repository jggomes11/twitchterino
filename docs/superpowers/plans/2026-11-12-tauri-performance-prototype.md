# Tauri Performance Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar protótipos Windows separados de Twitchterino e Kickterino para comparar uma conta com duas lives contra as releases Electron.

**Architecture:** Cada repositório mantém o produto Electron e acrescenta `prototype/`, com UI copiada no build, ponte Tauri e backend Rust. Perfis WebView2 são separados por conta; somente slots usados criam recursos. Twitch e Kick têm adaptadores próprios e contratos comuns de identidade, saldo, cancelamento e ciclo de vida.

**Tech Stack:** Rust estável, Tauri 2, WebView2, HTML/CSS/JS existentes, reqwest, tokio, serde, CDP via API nativa Windows.

**Spec:** [Design aprovado para iniciar](../specs/2026-11-12-tauri-performance-prototype-design.md). Aprovação na conversa: “ok, podemos iniciar”.

## Global Constraints

- Somente Windows; alvo do ensaio Windows 10/11 x64.
- Duas lives simultâneas por conta; referência principal uma conta por app e quatro players com os dois apps.
- Quatro slots opcionais, com coleta independente da seleção de UI.
- Perfis, identificadores e executáveis próprios de protótipo; não alterar dados, autostart ou releases instaladas.
- Tokens ficam no código nativo e nunca aparecem em snapshots, renderer, logs ou manifests.
- Consultas: timeout 20 s, resposta até 2 MiB, destinos fixos e redirects recusados.
- Interface conserva a disposição aprovada; funções fora do escopo ficam desabilitadas e identificadas.
- Nenhum benchmark ou crédito real de pontos pode ser declarado a partir de fixtures.
- Entregar artefato de teste Windows; nenhuma release estável ou atualização automática.

## Review Focus

- Token renovado na mesma identidade deve conservar saldo de referência; outra identidade deve zerar referências e ocultar dados privados antigos (Task 1).
- Comando assíncrono A→B→A e logout durante consulta não podem aplicar resposta antiga (Tasks 1/2).
- Página remota e popup não podem invocar comandos nativos nem trocar o perfil da conta (Task 2).
- Live encerrada ou renderer perdido precisa liberar/recriar somente o player afetado e respeitar duas vagas automáticas (Tasks 1/3).
- Falta de rede, baú indisponível e API recusada precisam produzir erro/inconclusivo, sem pontos ou sucesso inventados (Tasks 3/4).

## Arquivos e responsabilidades

- `prototype/src-tauri/src/model.rs`: slots, configuração, identidade, saldo e geração.
- `prototype/src-tauri/src/platform.rs`: destinos, consultas, parsing Twitch/Kick e regras de foco.
- `prototype/src-tauri/src/windows.rs`: shell, comandos, janelas/perfis, bandeja e tarefas.
- `prototype/src-tauri/src/webview.rs`: CDP, menor qualidade, cookies e eventos de página.
- `prototype/src-tauri/src/chat.rs`: chat Twitch; parsing Kick fica no adaptador de eventos.
- `prototype/src-tauri/src/chest.rs`: baú Twitch restrito e confirmação.
- `prototype/src-tauri/src/lib.rs`, `main.rs`, `build.rs`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/main.json`: aplicação/build com plataforma definida pelo repositório.
- `prototype/bridge.js`, `prepare-ui.cjs`: ponte local e cópia/adaptação determinística do renderer.
- `prototype/tests/`: testes do contrato da ponte e preparação de UI.
- `prototype/Measure-Prototype.ps1`, `README.md`: medição externa Windows e roteiro manual de pontos.
- `.github/workflows/tauri-prototype.yml`: build e verificações Windows, artefato identificado por commit.

## Task 1: Domínio e transporte testáveis fora da GUI

**Interfaces:** `AccountId::parse(&str) -> Result<AccountId, String>`; `Account::adopt_identity(Identity)`; `Account::set_balance(slug: &str, points: u64, now: u64)`; `Account::ticket() -> u64`; `Account::invalidate()`; `Platform::request(path, method, credentials, body) -> Result<Value, String>`; snapshots sem credenciais.

- [ ] Criar testes Rust para slot inválido, baseline inicial, renovação da mesma identidade, mudança de identidade, resposta obsoleta e exatamente duas vagas automáticas.
- [ ] Executar `cargo test --manifest-path prototype/src-tauri/Cargo.toml` e observar falhas antes da implementação.
- [ ] Implementar domínio serializável e adaptadores com validação de destino, limite de corpo/timeout, rejeição de redirects e erros sem credenciais.
- [ ] Testar parsing realista de respostas Twitch/Kick, erro parcial, menor playlist e confirmação de baú insuficiente.
- [ ] Executar toda a suíte Rust; registrar resultado e commit.

## Task 2: Shell Windows, perfis e UI existente

**Interfaces:** comandos `snapshot`, `select_account(id)`, `account_command(id, command, args)`; eventos `status`, `chat`, `select`, `toast` com `accountId`. `open_remote(app, account, kind, slug)` mantém o perfil da conta; `close_account(app, id)` fecha todas as páginas/tarefas dessa conta.

- [ ] Escrever testes da ponte para captura de conta antes de await, seleção A→B→A e recusa de ação fora de escopo.
- [ ] Executar `node --test prototype/tests/*.test.cjs` e observar falhas antes de implementar a ponte.
- [ ] Copiar renderer e assets no build, conservar layout e desabilitar funções fora do escopo; nunca editar os arquivos da release Electron.
- [ ] Implementar quatro slots, IPC exclusivo da UI local, login oficial/popups, armazenamento de teste, persistência, criação sob demanda e logout restrito.
- [ ] Implementar bandeja/fechar UI/Sair e instância única por app de protótipo.
- [ ] Executar testes da ponte e checagem/build nativo Windows; registrar resultado e commit.

## Task 3: Coleta, reprodução e integrações das duas plataformas

**Interfaces:** `poll_account(app, id)` captura geração e credenciais antes de await; `reconcile(app, id)` aplica duas vagas e prioridade atual; `instrument(window, id, slug)` acompanha CDP e deixa de emitir após invalidação.

- [ ] Testar rotação com sub, margem de 50 pontos, cooldown de 30 min, erro de rede e resposta antiga durante logout.
- [ ] Implementar consultas de identidade/canais/saldo, baseline correto e eventos incrementais para a UI.
- [ ] Implementar players de páginas oficiais, menor qualidade, inspeção/recuperação, player manual e loja, cookies nativos e geração de sessão.
- [ ] Implementar leitura/envio Twitch IRC e leitura/envio Kick conforme o contrato existente; testes reais não enviam mensagens sem instrução explícita do usuário.
- [ ] Implementar baú Twitch com clique estático restrito e confirmação por API na mesma identidade, fila por slot e retry de 90 s.
- [ ] Executar suíte completa e smoke Windows sem credenciais; registrar resultado e commit. Login/coleta real permanecem para ensaio do usuário.

## Task 4: Artefatos Windows, medição e revisão

**Interfaces:** build produz executável/instalador de protótipo, `build-info.json` e SHA256; coletor PowerShell recebe PID raiz, duração e caminho de saída, sem ler credenciais.

- [ ] Criar CI Windows com Rust/dependências fixadas em lockfile, preparo da UI, testes, build e smoke de quatro perfis com cookies fictícios isolados e encerramento natural.
- [ ] Implementar medição de árvore de processos a cada 5 s, memória privada/working set e CPU; indicar GPU/rede indisponíveis quando não houver medição confiável.
- [ ] Documentar rodadas de >=10 min de estabilização, >=30 min de observação, três repetições e >=8 h, incluindo pontos por live e eventos que alteram saldo.
- [ ] Gerar build dos dois repositórios e verificar identidade dos artefatos; executar suites Electron para comprovar preservação do produto.
- [ ] Pedir revisão técnica final independente; corrigir falhas relevantes e repetir somente verificações afetadas.
- [ ] Entregar links dos artefatos e limites observados, sem afirmar economia ainda não medida no PC alvo.

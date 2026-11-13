# Auditoria Electron — Twitchterino

Data: 13/11/2026. Código revisado: 0ba7749 (produção v0.1.5 mais documentação). Avaliação estática; nenhuma alteração de produto nesta etapa. `npm test`: 86 passaram, zero falhas.

## Referência medida

Cenário confirmado: duas contas, duas lives por conta, mesmos canais/qualidade, UI aberta e pontos aumentando. Dez minutos de estabilização e trinta de medição, uma rodada por implementação, Windows 11 / Ryzen 9 5900X / 32 GB / RTX 5060 Ti.

| Mediana | Electron atual | Protótipo Tauri |
|---|---:|---:|
| RAM privada residente | 2,11 GiB | 2,88 GiB |
| Memória privada comprometida | 2,85 GiB | 3,97 GiB |
| CPU total do PC | 5,34% | 5,07% |
| Processos (faixa) | 13–16 | 44–46 |

Decisão do usuário: manter Electron e avaliar melhorias de implementação. Tauri consumiu 36,6% mais RAM residente nessa rodada. Uma comparação não caracteriza toda a tecnologia. GPU/rede e deltas auditáveis de pontos não foram coletados.

## Achados e prioridades

| Prioridade | Evidência | Proposta e limite da conclusão |
|---|---|---|
| Alta: páginas de login permanentes | `account-runtime.js:1488–1502` inicia quatro runtimes; `:219–235` cria uma BrowserWindow/slot e conserva robots.txt. `:244–246` já consulta GQL no main via Session. | Criar a janela oficial apenas ao pedir login; fechar/liberar a página após conclusão/cancelamento, preservando Session e cookies. A quantidade de janelas é comprovada no código; economia de RAM ainda é hipótese. |
| Alta: estado global multiplicado | `account-runtime.js:1229–1262` consulta métricas globais e autostart dentro de cada snapshot; `account-manager.js:10–18` constrói quatro snapshots; `main.js:80–83` descarta o snapshot de status do emissor e recalcula o agregado. | Um estado global por ciclo do shell, resumo leve por conta e agrupamento de notificações de estado. Quatro timers de 15 s produzem até vinte leituras globais por rodada lógica, antes da bandeja. Custo em CPU precisa ser medido. |
| Média: menu da bandeja reconstruído | `main.js:69–78` usa snapshot completo, cria template e menu a cada chamada; cada conta chama updateTray. | Atualizar menu/tooltip somente quando os respectivos campos mudarem; não exigir canais, relatório e app metrics para obter nomes/contadores. |
| Média: timers e listeners após conclusão | `account-runtime.js:209–216` Promise.race não limpa timeout; loadApi acumula once até o próximo carregamento; `:226`, `:842`, `:1342`, `:1464`, `:1501` incluem one-shots sem cancelamento central em stop. | Helper de timeout com finally e registro de timers por runtime; rejeitar trabalho posterior a dispose. Kick já tem helper que limpa timeout e rastreia timers: usar como referência, não copiar defeitos. |
| Média: quatro buscas públicas iguais | `account-runtime.js:523–539`, `:1501–1502` consultam o mesmo manifesto por conta. | Compartilhar somente busca pública/in-flight e aplicar slugs separadamente a cada configuração. Nunca compartilhar respostas autenticadas, pontos ou credenciais. |
| Posterior: IRC duplicado | `account-runtime.js:829–850`, `:1496` mantém quatro sockets anônimos lendo listas iguais, mesmo sem conta. | Medir bytes/CPU e avaliar ativação sob demanda preservando chat anônimo e menções por identidade. Não faz parte da primeira rodada. |
| Posterior: reconstrução de UI | `renderer/renderer.js:473–515` refaz contas/abas/cabeçalho/painel a cada snapshot; `:77–90` mantém até 400 nós por canal da conta exibida. | Medir heap e custo de render; aplicar diferenças depois de eliminar broadcasts redundantes. Manter foco, seleção, mensagens e contadores. |
| Posterior: disco/relatórios | saveConfig e logs são síncronos; relatório percorre minutos/intervalos. | Instrumentar atrasos antes de alterar atomicidade, retenção ou formato. |

## Primeira rodada proposta

1. Estado e métricas no shell, resumos por conta e bandeja sem reconstrução redundante.
2. Janela de login sob demanda, com guardas de autenticação revisadas e verificação nativa de cookies persistentes sem página oculta.
3. Cancelamento correto de timeouts, retries e callbacks encerrados; busca pública compartilhada.
4. Build Windows de teste com inventário opt-in de recursos: papel da janela, slot, PID, estado e versão, sem dados de login/chat. Medir novamente o mesmo cenário.

Cada etapa precisa ser testável e atribuível. Não reduzir a quantidade de lives, alterar a disposição da UI, remover baús/histórico ou mudar a qualidade/flags de reprodução para obter números melhores. Não atualizar Electron/dependências junto desta rodada. Mudanças em players, áudio, throttling, ciclo de baús e chat ficam para experimentos específicos.

## Riscos de autenticação a cobrir

A janela de login hoje aparece em guardas de cookies (`:155`), falhas de poll (`:1296`), retorno de suspensão (`:1341`) e logout (`:1441`), apesar de a API ser nativa. Não basta remover createApiWindow de start: isso poderia bloquear cookieCheckPending ou quebrar o logout. Exigir testes para sessão persistida, renovação da mesma identidade, troca de identidade, A→B→A, logout durante request, popups OAuth do slot, janela fechada, falha de rede e encerramento natural.

## Comparação futura

Referência principal: esta coleta Electron de quatro lives. Rodar o candidato no mesmo PC, mesmas contas/canais/qualidade, UI aberta, warmup600 s e observação1800 s, usando o mesmo coletor e diretório novo. Registrar pontos por live e eventos de baú/compra. Depois repetir em bandeja e três vezes; teste de >=8 h para longa duração. RAM residente e commit separados; CPU mediana/p95/pico; quantidade/papel de recursos; sem somar working sets compartilhados.

A implementação ainda precisa ser feita e validada; nenhuma economia foi prometida. Os resultados medidos anteriores estão preservados no relatório comparativo e nos arquivos enviados pelo usuário.

## Rastreabilidade da coleta

Electron (arquivos originais recebidos do usuário; SHA256):

- summary: `3598a20cb8a2429de837816621fd0107d0c77eee4db527bb3112ac3f50aa9e68`
- totals: `9168149398897acdbfe5705438a378eb6298dbdc2e37e50c7fae30b33144765b`
- processes: `fb9ca90c9a3bb0108178d9bb3098a72b1ad8507f81ad0d873077597986f898d9`
- environment: `456da3ddacd013615383a27f04e15cf048fc99ddf9d67c39d35d563922d38687`

Tauri (arquivos originais recebidos do usuário; SHA256):

- summary: `ab1d7b6e70fc6e9ce9cfb4b99840369cbe3ec16641e0aea091d342a5df77a0d1`
- totals: `f38bd7a64047e4a7f4d673e5937026a4edf07cdbaef5acb15102e392e86e382a`
- processes: `2aad4599155c58f1b0f99f2a4d352b049c4a88f8fb53e219c5084a3c4fd6bdb3`
- environment: `a78d438ea4670b4508e1c7d486b7590dbac61d6799cf06e6b93a35f87766787c`

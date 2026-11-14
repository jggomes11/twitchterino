# Desempenho e baseline — Twitchterino

## O que sabemos e o que ainda não sabemos

**Nenhum benchmark de RAM/CPU/GPU/rede com contas reais foi executado neste levantamento.** Esta seção é um mapa do código e um protocolo para a próxima etapa. Não há percentual de economia comprovado, meta numérica acordada nem escolha de novo framework.

### Recursos criados pela implementação

| Recurso | Cardinalidade lógica por app | Evidência |
| --- | --- | --- |
| UI principal | 1 BrowserWindow | [main.js · mainWin = new BrowserWindow](../../main.js#L127) |
| Login/página leve | 4 BrowserWindows, uma por runtime iniciado, mesmo vazio | [account-runtime.js · function createApiWindow](../../account-runtime.js#L219) |
| Players | Um BrowserWindow por canal em watchers | [account-runtime.js · function startWatcher](../../account-runtime.js#L936) |
| Lojas | Um por canal aberto em cada slot, reutilizado enquanto existe | [account-runtime.js · function openStore](../../account-runtime.js#L979) |
| Baús | Uma janela temporária por tentativa ativa/slot; fila serial por slot, até quatro no app | [account-runtime.js · async function claimChest](../../account-runtime.js#L716) |
| Popups de login | Adicionais, por fluxo oficial | [main.js · app.on('web-contents-created'](../../main.js#L100) |
| Chat | 4 sockets IRC de leitura ao iniciar os runtimes, inclusive sem login; até 4 sockets de envio sob demanda; mais conexões das páginas | [account-runtime.js · function connectChat](../../account-runtime.js#L829) |
| Histórico/UI | Maps, conjuntos e até 400 mensagens/nós por canal da conta exibida | [renderer/renderer.js · const MAX_MESSAGES](../../renderer/renderer.js#L3) |

Com quatro contas verificadas e duas lives de coleta por conta, o modelo nominal é **1 UI + 4 logins + 8 players = 13 BrowserWindows por app**, antes de lojas/baús/popups. Usar os dois apps nesse cenário soma 26 janelas lógicas, com 16 players e 8 logins. Isso **não** significa 26 processos ou determinado número de MB. Com apenas uma conta usada, os outros runtimes/login ainda são inicializados. Players manuais, teste de limite e watchAll podem superar o cenário nominal.

### Agendamento e multiplicação de trabalho

| Rotina | Frequência configurada | Observações |
| --- | --- | --- |
| Poll de dados | 60 s por runtime | Grupos sequenciais de 10 canais; primeiro inclui identidade |
| Status da UI | 15 s por runtime | Snapshot do emissor é construído antes do shell produzir outro agregado |
| Fim de bônus + bandeja | 30 s por runtime | Pode reconstruir menu e snapshots mesmo sem UI visível |
| Parceiros | 30 s após start e depois 6 h por runtime | Endpoint público igual repetido por quatro slots; sem compartilhamento entre apps |
| Cronômetros no renderer | 20 s | Recria caixa de bônus se painel não estiver hidden |
| Verificação de player | Dentro de cada poll, timeout 30 s por player consultado | Não é um timer independente executado a cada 30 s |
| Recuperação de suspensão | Poll após 15 s | Fecha players não mostrados manualmente antes de reconstruir |

Cada `manager.snapshot()` chama snapshots de quatro runtimes; cada snapshot chama `app.getAppMetrics()`, que mede o app inteiro, não um slot. No caminho normal do timer de status de um slot, há um snapshot do emissor + quatro do agregado. Quatro timers de 15 s podem assim produzir **20 leituras de métricas por rodada lógica**, fora poll/bandeja. É uma contagem de chamadas derivada do código, não medição de custo em tempo/RAM. Fonte: [account-manager.js · function snapshot](../../account-manager.js#L10), [main.js · function emit](../../main.js#L80), [account-runtime.js · function snapshot](../../account-runtime.js#L1229).

O GraphQL normal usa ceil(canais válidos/10) chamadas por slot/poll; baús e lojas podem adicionar consultas. Para listas vazias, não há primeiro grupo/currentUser em refreshAll.

## Indicador de RAM existente

`memoryMB = round(sum(app.getAppMetrics().memory.workingSetSize) / 1024)` em snapshot. O campo é agregado por app e rotulado MB na UI, com escala aproximada de MiB. Não oferece série temporal completa, memória privada por conta, picos, GPU dedicada, tráfego ou atribuição por canal. Não somar os quatro campos de slot como se fossem quatro apps; são leituras do mesmo total. O log de pontos não registra esse total.

## Hipóteses a testar, sem promessa de ganho

| Candidato | Evidência estática | Experimento necessário / regressão a evitar |
| --- | --- | --- |
| Custo das páginas reais | Players carregam o site inteiro e mantêm mídia ativa | Separar custo por player, UI e slot; conferir pontos reais ao simplificar página/engine |
| Slots vazios | Quatro logins, timers e IRC de leitura iniciam sempre | Comparar inicialização preguiçosa; preservar login persistente, seleção e autostart |
| Atualização de estado | Snapshots globais e DOM completo são reconstruídos com frequência | Medir CPU, heap e tráfego IPC; avaliar atualizações incrementais/coalescência |
| Polling duplicado | Metadados e parceiros consultados por slot | Medir volume; separar cache público de dados privados, sem contaminar sessão |
| Baixa qualidade/CDP | Playlist/resposta podem ser copiadas entre Chromium, main e base64 | Medir banda, decoder/GPU e pico de memória; não assumir que 160p elimina custo do site |
| I/O e relatório | JSON/logs síncronos no main; relatório percorre ~10.080 minutos e intervalos | Medir pausas ao salvar/reportar; não perder atomicidade/dados ao mudar persistência |
| Longa duração | Recicla players em 6 h; históricos, conjuntos e arquivos lógicos têm retenções distintas | Testar >=8 h; comparar antes/depois de ciclos e logout repetido |
| Energia | Bloqueio de suspensão depende só de farming, inclusive slot vazio | Distinguir comportamento desejado de mecanismo; não confundir economia de energia com coleta interrompida |

As flags globais que desligam throttling/background suspension e o `backgroundThrottling:false` das páginas mantêm coleta, mas podem aumentar atividade em segundo plano. Mudar essas flags sem medir crédito real de pontos é arriscado para a equivalência funcional. A semiespaço V8 de 1 MiB é somente parâmetro de geração jovem do GC, não teto de memória do app.

## Protocolo proposto de medição (a executar)

Usar os instaladores da release e PC Windows representativo. Fixar versão de SO/driver/GPU, RAM instalada, plano de energia, rede, canais, qualidade, número de contas e quantidade de players efetivos; anotar outras aplicações e outros clientes da mesma conta. Não publicar perfis, cookies, tokens ou chat privado.

| Cenário | Contas/players | Fase |
| --- | --- | --- |
| B0 | Sem login, UI aberta e depois bandeja | Overhead de shell, quatro slots e logins |
| B1 | 1 conta, coleta pausada | Login/chat/configuração sem reprodução automática |
| B2 | 1 conta × 2 lives | Operação típica, comparar UI aberta e bandeja |
| B3 | 2 contas × 2 lives | Isolamento e operação simultânea |
| B4 | 4 contas × 2 lives | Oito players do app, somente quando houver quatro contas de teste autorizadas |
| B5 | Dois apps simultâneos com a mesma matriz | Total do PC; não somar campos internos por slot |
| B6 | Lojas, relatório, baús e trocas de conta | Picos e responsividade |
| B7 | >=8 h e suspensão/retorno | Crescimento, reciclagem de 6 h, recuperação e persistência |

Para cada cenário: registrar partida fria, estabilização de pelo menos 10 min e janela de observação de pelo menos 30 min, ampliada se não houver créditos suficientes para validar pontos. Amostrar a cada 5 s: PID/tipo, working set, memória privada/commit, CPU, GPU/decoder quando disponível, rede acumulada, quantidade/tipo de janelas e players. Essa cadência é proposta de teste, não uma instrumentação já implementada.

Relatório comparável deve conter mediana, percentil 95 e pico; partida fria; atraso de comandos/troca de conta; MB/h de rede; deltas de saldo por canal e eventos externos que possam alterá-los. Registrar fórmulas/unidades e tempo real decorrido. Repetir cenários ao menos três vezes. Contas fictícias validam a arquitetura, **não** o consumo real de mídia nem os créditos da plataforma.

### Resultados nesta captura

| Métrica de produção | Resultado |
| --- | --- |
| RAM/CPU/GPU/rede por cenário | **Não medidos** |
| Crescimento em 8 h | **Não medido** |
| Economia de outra engine | **Não demonstrada** |
| Limite atual de lives que recebem pontos | **Não revalidado** |
| Metas de desempenho da migração | **Ainda não definidas com o usuário** |

Aceitar uma alternativa somente após comparar os mesmos cenários, preservando os contratos de negócio e verificando ganho real. Reduzir RAM fechando players ou interrompendo coleta não é melhoria equivalente.

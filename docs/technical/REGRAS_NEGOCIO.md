# Regras observadas — Twitchterino

Base: `622386ccd1d511814d3a77c8e96c06f10c509007`, release `0.1.5`. IDs BG são comuns aos dois produtos; TW/KK descrevem particularidades. As regras relatam a versão atual. Parâmetros de API e comentários sobre taxas são hipóteses operacionais a revalidar com as plataformas.

## Matriz de rastreabilidade

| ID | Comportamento vigente | Fonte principal | Evidência disponível |
| --- | --- | --- | --- |
| BG-01 | Quatro slots opcionais numa janela; cada um mantém cookies, canais, configuração, players e relatórios separados. Alternar exibição não pausa os outros. | [main.js · const runtimes](../../main.js#L85); [tests/multi-account.test.cjs](../../tests/multi-account.test.cjs) | Código + teste fictício |
| BG-02 | Login pela página oficial; nova coleta automática exige sessão verificada. Logout limpa somente o slot, preservando canais e preferências. | [account-runtime.js · handleIpc('logout'](../../account-runtime.js#L1432); [tests/application.test.cjs](../../tests/application.test.cjs) | Código + testes; login real é evidência separada |
| BG-03 | Mesmo usuário com token renovado conserva baseline de saldo; outra identidade não herda ganhos da sessão anterior e arquiva/restaura relatórios. | [security/accounts.js](../../security/accounts.js); [tests/accounts.test.cjs](../../tests/accounts.test.cjs); [tests/application.test.cjs](../../tests/application.test.cjs) | Código + teste |
| BG-04 | Saldo inicial não conta como ganho; aumentos posteriores entram em daily/gainedTotal. Quedas podem indicar compras, não ganhos negativos. | [account-runtime.js · function updateChannelBalance](../../account-runtime.js#L621) | Código; atribuição do aumento à reprodução é estimativa |
| BG-05 | Por padrão, duas lives por conta, em baixa qualidade e com foco em bônus. Configuração existente prevalece, exceto migração explicitada abaixo. | [account-runtime.js · const DEFAULT_CONFIG](../../account-runtime.js#L61) | Código |
| BG-06 | Canal offline/removido deixa de coletar; players abertos manualmente têm tratamento próprio e podem ultrapassar o limite automático. | [account-runtime.js · function reconcileWatchers](../../account-runtime.js#L1115) | Código; não usar maxWatchers como teto absoluto de janelas |
| BG-07 | Conteúdo adulto exige ação da pessoa na página; o app sinaliza o gate e não o confirma automaticamente. | [account-runtime.js · async function checkPlayers](../../account-runtime.js#L1012) | Código; seletores DOM sujeitos a mudança |
| BG-08 | Foco prioriza canais por assinatura, meta alcançada e pontos restantes; evita troca por diferenças pequenas e respeita cooldown. | [account-runtime.js · function worthSwitching](../../account-runtime.js#L1099) | Código; algoritmo específico abaixo |
| BG-09 | Compra de recompensa paga é feita pela pessoa na loja oficial; compra manual no painel registra histórico/cronômetro, não executa resgate remoto. | [account-runtime.js · handleIpc('purchase:add'](../../account-runtime.js#L1376); [account-runtime.js · function openStore](../../account-runtime.js#L979) | Código |
| BG-10 | Horas compradas do mesmo bônus são empilhadas; tipos diferentes têm cronômetros independentes. Aviso nos 5 minutos finais quando habilitado. | [account-runtime.js · function bonusIntervals](../../account-runtime.js#L450); [account-runtime.js · function checkBonusEnding](../../account-runtime.js#L471) | Código |
| BG-11 | Modo antes de dormir é opcional e abre lojas em sequência; fechar a atual avança. Cancelar/logout precisa impedir a próxima abertura. | [account-runtime.js · function openNextStore](../../account-runtime.js#L1000); [tests/application.test.cjs](../../tests/application.test.cjs) | Código + teste de cancelamento |
| BG-12 | Favoritos recebem destaque e aviso ao entrar ao vivo; menções e sorteios têm destaque e notificações conforme preferências. | [renderer/renderer.js · function chatAlert](../../renderer/renderer.js#L686); [account-runtime.js · function notify](../../account-runtime.js#L288) | Código; notificação nativa depende do SO |
| BG-13 | Relatório usa sete datas locais, cobertura de qualquer bônus e linha de 24 h; exportação é PNG do card, escolhido em diálogo nativo. | [account-runtime.js · function weeklyReport](../../account-runtime.js#L487); [renderer/renderer.js · async function showReport](../../renderer/renderer.js#L620) | Código; imagem é representação da UI |
| BG-14 | Fechar UI mantém coleta na bandeja; Sair encerra todas as contas. Atualizações de executável são manuais e perfil instalado deve ser preservado. | [main.js · function quitApp](../../main.js#L65); [package.json](../../package.json) | Código + política de distribuição |
| BG-15 | Teste de lives compara ganhos por etapa, preserva configuração anterior para cancelamento e aplica a menor concorrência que rende >=90% do melhor resultado. | [account-runtime.js · function advanceLimitTest](../../account-runtime.js#L1189) | Código; heurística não certifica limite da plataforma |

## Parâmetros locais e algoritmos

| Parâmetro | Valor implementado | Interpretação |
| --- | --- | --- |
| Slots | 4 fixos, uso opcional | Não existe criar slot arbitrário pela UI |
| Coleta inicial | 2 players por conta | Não é limite garantido da plataforma |
| Limite ajustável na UI | 1–10 | watchAll ignora esse limite |
| Qualidade | Menor variante disponível por BANDWIDTH | Frequentemente 160p; não garante resolução fixa se a playlist não a oferece |
| Margem de troca | 50 pontos | Candidato no mesmo estágio precisa estar mais de 50 pontos mais perto |
| Janela de ganho | 13 min | Sem watcher=null; ganho recente=earning; início recente=warming; restante=idle |
| Cooldown por idle | 30 min | Rebaixa prioridade; não proíbe preencher vaga se só houver candidatos nesse estado |
| Reciclagem de player | 6 h | Aplicada durante reconciliação; player mostrado manualmente é excluído |
| Bônus | 1 h por unidade; pacotes 1/3/5/10 h | Mesmo tipo empilha duração |
| Retenção de compras | 10 dias ao inserir | Não existe purga contínua garantida sem novas compras |
| Teste de limite | 20 min/etapa; aquecimento 7 min | Tempo usa relógio local; ganhos não corrigidos por baús/subs/ações externas |

No foco, ordenar por: cooldown por último; sub primeiro; canal com bônus disponível primeiro; menor estágio de meta; menor falta para a próxima meta. Um sub atual não é trocado apenas por um não-sub melhor posicionado; candidato em cooldown não força troca. Sem rotação, preencher conforme ordem de canais. Ajustar limite/rotação encerra o teste em andamento; iniciar teste substitui temporariamente limite e desliga rotação.

O teste estima concorrência por `pontos / (minutos × 2)`. Na primeira etapa, se rende >=85% do número de players, encerra a exploração; caso contrário restringe próximos degraus a até `ceil(contagem)+2`, respeitado mínimo de corte 3. O resultado escolhe o menor número com >=90% do melhor ganho bruto. Primeira etapa limitada a 10; degraus 2,3,4,6,8,10.

Uma leitura inicial apenas cria referência. Diferença positiva pode incluir baú ou ganho ocorrido em outro cliente, e diferença negativa pode esconder ganhos simultâneos. Portanto `gainedTotal`, cronômetro de bônus e teste de limite são estimadores baseados em saldo, não uma auditoria financeira ou prova de tempo assistido.

### Particularidades Twitch

- **TW-01 — Todas as lives online:** `watchAll=true` ignora maxWatchers, foco e indisponibilidade de pontos ao iniciar canais online da lista; continua abrindo recém-online. O teste de limite não inicia nesse modo. A reciclagem de seis horas continua; rotação por ausência de ganho é desativada nesse modo. Não há teto de 10 players imposto por watchAll.
- **TW-02 — Preço por canal:** catálogo GraphQL é filtrado por nomes de XP/Capture/Lure e indicação de bônus/PokeIdle/15%; somente recompensas habilitadas, não pausadas e em estoque são disponíveis. ID de recompensa identifica resgates. Sem recompensa compatível o canal fica por último, com indicação de bônus em breve.
- **TW-03 — Pacotes:** tipos xp/capture/lure e horas 1/3/5/10. Um pacote usa preço exato disponível; na falta dele estima `preço por hora × horas`. Preços base 300/500/1000 são fallback local, não promessa de preço atual. Mudança de preço aparece por até um dia.
- **TW-04 — Detecção de compra:** lê requisição/resposta `RedeemCustomReward` nas janelas de loja/player; sucesso confirmado identifica rewardID primeiro, fallback por título. `pendingSpent` evita duplicar a mesma despesa na próxima queda de saldo. Compra externa é inferida por até quatro recompensas, tolerância de 60 pontos, menor número de resgates; combinações igualmente plausíveis de tipos/horas são descartadas. Isso não é uma confirmação de compra feita fora do app.
- **TW-05 — Baú de +50:** automático opcional, uma tentativa por vez em cada runtime (até quatro runtimes ao mesmo tempo). Requer identidade/digest verificados, claim disponível e não confirmado antes. Abre popout temporário e clica somente `.claimable-bonus__icon` dentro de botão permitido na origem/caminho esperados. Não clica recompensa paga.
- **TW-06 — Confirmação do baú:** até cinco consultas read-only exigem mesma identidade, claim antigo indisponível/substituído e saldo >= saldo anterior+50. Conta sucesso, salva histórico e fecha janela somente após confirmação. Retry por canal com espera mínima de 90 s. IDs confirmados retidos em conjunto limitado a 256. Sem automático, aviso agregado no máximo a cada 15 min, seguido de abertura manual da loja.
- **TW-07 — Chat:** leitura anônima pode funcionar sem conta e sem player; envia somente com token/nome disponíveis, por conexão autenticada sob demanda. API/UI limitam mensagem a 500 caracteres e canal conhecido.

Fontes: [preços e compras](../../account-runtime.js#L251), [fila de baús](../../account-runtime.js#L638), [script de clique](../../security/chest.js), [IRC](../../account-runtime.js#L772), [testes de recompensas](../../tests/rewards.test.cjs), [testes de baú](../../tests/chest.test.cjs).

## Contratos que não devem ser perdidos ao reduzir recursos

| Cenário de aceitação | Resultado esperado para a futura implementação |
| --- | --- |
| A e B conectadas, exibir B | Coleta de A continua; configuração/comando/resposta de A não aparece em B |
| Logout A durante consulta/fila | Trabalho antigo não reabre janelas nem mistura estado em B; cookies de B intactos |
| Token renovado da mesma identidade | Preservar referência de saldo e relatório, sem contabilizar saldo inteiro como ganho |
| Outra identidade no mesmo slot | Separar históricos e reiniciar referências de saldo/canal |
| Fechar UI e reabrir | Não interromper coleta; não criar uma segunda instância do mesmo perfil |
| Mostrar player/voltar para coleta | Manter sessão do slot, restaurar áudio/qualidade conforme ação e não confundir visibilidade com ganho real |
| Falha de rede/página/selector | Estado de falha compreensível; nenhuma exposição de token nem sucesso de pontos/baú inventado |
| Reiniciar app atualizado | Preservar configuração e sessões dentro das possibilidades técnicas; mudança de engine pode exigir novo login, a decidir na migração |

Essa tabela define o que precisa ser discutido/validado antes de aceitar uma substituição. Detalhes como flags Chromium, divisão de arquivos, existência de janela por player e caminho de implementação de IPC são mecanismos atuais, não obrigações tecnológicas futuras.

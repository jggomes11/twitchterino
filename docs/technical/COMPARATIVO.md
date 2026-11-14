# Comparativo técnico — Twitchterino × Kickterino

Esta comparação corresponde aos snapshots descritos no README de cada projeto. As duas cópias de COMPARATIVO.md são deliberadamente idênticas para cada repositório ser consultável isoladamente. Código comum foi copiado/adaptado; **não existe pacote de domínio compartilhado** entre os produtos.

| Aspecto | Twitchterino 0.1.5 | Kickterino 0.3.1 |
| --- | --- | --- |
| Fonte da release | a0942c6 | 90aaf81 |
| Engine/build | Electron45.2.1, builder26.18.0, Node>=22.13 | Mesmo conjunto declarado |
| Slots | 4 closures + 4 sessões; primeiro perfil legado | Mesmo modelo com partitions Kick |
| API principal | GraphQL, grupos de 10 canais | REST: identidade + até 3 GETs por canal, sequenciais |
| Token de consulta | auth-token/unique_id, headers no main | session_token/XSRF, headers no main |
| Identidade | currentUser por primeiro grupo; ID ou fallback login | /api/v1/user ou /api/v2/user; ID positivo obrigatório |
| Renovação de cookies | Debounce100ms; mesmo digest pode restabelecer verificação sem reiniciar players; consultas capturam geração | Evento invalida epoch, fecha players/lojas e agenda250ms; fingerprint também conferido no poll |
| Chat recebido | IRC anônimo próprio por runtime, independentemente de players | Frames dos players oficiais por CDP; sem página não há chat do canal |
| Chat enviado | IRC autenticado sob demanda | REST do chatroom conhecido |
| Todas as lives online | Existe; ignora limite automático, pode abrir todos os canais online | Não existe |
| Limite de configuração | 1–10; default2 | 1–30; default2; primeira etapa do teste usa todas online |
| Foco | Sub, bônus disponível, estágio, falta, margem50, cooldown | Sub, estágio, falta, margem50, cooldown |
| Recompensas | Catálogo/preço/ID por canal; pacotes1/3/5/10h | Custos fixos300/500/1000; registros de1h |
| Detecção de compra | Observa resgate confirmado; fallback saldo evita ambiguidade | Inferência por queda de saldo; evento de resgate no chat só mostra mensagem |
| Baú +50 | Fila serial por conta, popout temporário, confirmação por API | Sem worker de baú |
| Player visível | Mostra watcher existente sem reload explícito no handler | Mostra e recarrega watcher |
| Falha de inspeção de player | 3 timeouts consecutivos e mais de3min antes de fechar | Timeout fecha watcher correspondente |
| Limite de poll preso | Nova rodada após5min ou mudança de geração; sequence evita liberar lock de rodada nova | Constante5min remanescente sem efeito: `if(polling)` não libera rodada pelo relógio |
| Keep-awake | farming=true já adquire blocker, inclusive slot vazio | Exige farming, login e slot não suspenso/parado |
| Telemetria em points-log | Canal, saldo, ganho/estado, vídeo, watchtime; sem memoryMB | Acrescenta memória global e foco/minimização |
| Timeout auxiliar | Promise.race sem limpar timer nem cancelar underlying promise | Limpa timer em finally; também não aborta a operação externa genericamente |
| Relatórios na UI sem confirmação | Snapshot omite bônus/compras/ganhos quando conta não confirmada | Snapshot ainda devolve bônus/compras/daily do config, mesmo com loggedIn=false |
| Ativação de origem | showMain(id) envia evento de seleção; depende da UI para atualizar manager | showMain(id) seleciona manager antes de enviar evento |
| Exportação de relatório | Captura/diálogo sem guarda explícita de seleção/generation no runtime | Checa epoch e conta selecionada antes do diálogo e da escrita |
| Limpeza de timers | Lista de intervalos + authRefreshTimer; outros timeouts distribuídos | Sets para later/repeat; withTimeout próprio ainda tem outro mecanismo |
| UI estreita | Tema herdado pode ocultar busca/add/offline <=900px; painel fixed pode cobrir contas/modal | Controles preservados em820px; painel dentro de main, modal acima; fixture cobre |
| Testes nesta captura | 86/86 Node; CI nativa da release passou | 51/51 Node; CI nativa da release passou |
| Distribuição atual | Instalador NSIS sem update automático | Mesmo modelo |

## Núcleo comum que pode informar um futuro desenho

Instância única, seleção de conta, guarda de comandos, identidade de relatórios, configuração por slot, agendamento, abstração de player, eventos e coleta de métricas são candidatos a interfaces comuns. **Candidato não significa decisão de extração ou implementação aprovada.** API, autenticação, parsing de recompensas, chat, confirmação de baú e particularidades de reprodução precisam de adaptadores específicos.

`security/ipc.js`, `security/account-view.js` e `security/accounts.js` são byte a byte iguais nos snapshots. `main.js`, `account-manager.js`, `preload.js`, `security/requests.js` e `security/platform.js` diferem; não assumir que uma correção em um já existe no outro. O helper de relatórios comum conserva campos chestDaily/chestsClaimed no Kick, mas não implementa baú Kick.

## Pontos a decidir antes de uma reimplementação

- Preservar contratos de negócio sem congelar falhas/limitações acima como requisitos.
- Definir se o produto continuará exclusivamente Windows ou terá suporte Linux formal; hoje há targets Linux, mas a principal evidência de entrega é Windows.
- Definir matriz real de contas/lives e limites de recurso com o usuário. Quatro slots opcionais não equivalem a quatro players sempre necessários.
- Separar overhead da UI, slot vazio, player e operações transitórias. Migrar só o shell não elimina a necessidade de engine e mídia das páginas oficiais.
- Estabelecer se cookies podem ser reaproveitados com segurança numa engine candidata; preservar configs/relatórios e prever novo login sem coletar/exportar segredos.
- Verificar políticas e capacidades atuais das plataformas antes de propor outro transporte de mídia/chat. Nenhuma garantia de crédito ou economia vem apenas de trocar Electron por outro nome.

## Evidência e limitações

As diferenças acima vêm do código rastreado, não de um benchmark ou novo ensaio real de login/coleta. Ver ESTADO_ATUAL para contratos, REGRAS_NEGOCIO para rastreabilidade e DESEMPENHO para protocolo ainda não executado. Comparação não altera produtos, não escolhe engine e não promete porcentagem de redução de RAM.

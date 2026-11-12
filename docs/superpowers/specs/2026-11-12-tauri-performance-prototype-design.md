# Protótipo de desempenho com Tauri — Twitchterino e Kickterino

Data: 2026-11-12. Estado: início do protótipo aprovado pelo usuário na conversa (“ok, podemos iniciar”); migração definitiva ainda não decidida.

Este documento tem cópia idêntica nos dois repositórios. Complementa o levantamento de [estado atual](../../technical/ESTADO_ATUAL.md), [regras](../../technical/REGRAS_NEGOCIO.md), [desempenho](../../technical/DESEMPENHO.md) e [diferenças entre plataformas](../../technical/COMPARATIVO.md). O levantamento permanece um registro histórico, sem resultados de benchmark.

## Intenção e decisões da conversa

O usuário quer reduzir o consumo dos dois aplicativos, preservando suas regras de negócio e a disposição de interface já aprovada. O alvo é somente Windows. Foi escolhido avaliar primeiro Tauri com Rust, pelo reaproveitamento da interface web e pelo retrabalho adicional de reconstruí-la em C#/WPF. A expectativa de desempenho parecido entre as alternativas é uma hipótese, não uma medição.

O usuário definiu **duas lives simultâneas por conta** como cenário de teste, mantendo a referência de operação atual. Esse número fixa a carga do ensaio; o recebimento efetivo de pontos nas duas lives será verificado em cada plataforma. Os quatro slots opcionais continuam fazendo parte dos produtos.

O resultado desta etapa será um protótipo descartável e um relatório comparativo. Não representa autorização para substituir as releases ou para uma migração completa. A continuidade depende das evidências de funcionamento e consumo. O reaproveitamento futuro do código do protótipo precisará de uma decisão própria.

## Abordagens consideradas

| Abordagem | O que aproveita | Custo e limite | Decisão |
| --- | --- | --- | --- |
| Otimizar o Electron atual | UI, integrações e ferramentas existentes | Mantém o runtime atual; parte dos desperdícios pode ser corrigida independentemente da tecnologia | Alternativa de retorno e referência funcional |
| Tauri + Rust + WebView2 | Boa parte do HTML/CSS/JS e disposição aprovada | Reescreve a parte principal e a ponte Electron; controle avançado do WebView2 exige validação | Primeira opção para o protótipo, alinhada com o usuário |
| C#/.NET + WPF + WebView2 | Regras e especificações existentes | Reconstrução da interface; acesso direto às APIs .NET do WebView2 | Alternativa se o protótipo expuser obstáculos relevantes |

Tauri e WPF/WebView2 continuam usando Chromium nas páginas oficiais e nos players. Tamanho do instalador não substitui medição da memória do conjunto de processos. Não há promessa de percentual de economia nem evidência de equivalência de desempenho entre Rust e C# neste uso.

## Escopo e ordem propostos

Escolhas abaixo são propostas técnicas do autor para o protótipo; não decisões já dadas pelo usuário.

1. Preparar o procedimento de medição das releases atuais, sem alterar o produto instalado.
2. Provar sessões, transporte autenticado e reprodução com WebView2/Tauri no Twitchterino, incluindo o caminho de confirmação do baú.
3. Provar a integração do Kickterino, especialmente chat por eventos da página e consultas autenticadas. Sucesso na Twitch não comprova sucesso no Kick.
4. Aplicar os mesmos cenários de medição em cada app e depois com os dois simultaneamente.
5. Apresentar resultados, obstáculos e custo estimado da migração antes de escolher o produto definitivo.

O protótipo deve permitir login/logout, seleção dos quatro slots, lista de canais, limite de players, coleta/pausa, baixa qualidade, abertura manual de player/loja, bandeja e encerramento. Preservar a disposição aprovada dos controles implementados, sem redesenho visual. Controles de funções ainda não portadas devem ficar desabilitados com indicação clara, nunca aparentar sucesso. Criar somente a parte do domínio necessária a esses fluxos e às provas de identidade, saldo, chat e baú.

Relatórios completos e sua exportação PNG, modo antes de dormir, notificações completas, inferências de compra, teste automático de limite, watchAll e migração de perfis instalados ficam fora do protótipo. Continuam obrigatórios na avaliação de uma futura substituição. A regra de rotação/prioridade existente deve ser aplicada nos cenários que a exercitam; as medições principais usam canais estáveis e configuração equivalente. Features omitidas impedem declarar equivalência completa ou entregar o protótipo como sucessor.

## Estrutura proposta

- **Interface:** HTML/CSS/JavaScript existentes, sem introduzir framework de UI. Adaptador explícito para comandos e eventos Tauri substitui a ponte Electron, conservando os campos necessários aos fluxos implementados. Reaproveitamento de JS depende de retirar dependências específicas do Electron.
- **Coordenação em Rust:** seleção de conta, configuração de teste, ciclo de vida, cancelamento, geração de autenticação, agendamento e registro de observações. Não manter um processo Node auxiliar somente para executar o código anterior.
- **Integrações separadas:** módulos Twitch e Kick para identidade, saldo, chat, recompensas e particularidades de reprodução. Compartilhar conceitos estáveis; não forçar uma implementação única para diferenças documentadas.
- **Camada Windows/WebView2:** criação e encerramento de controles, cookies, popups oficiais, eventos de rede/CDP e ciclo da mídia. Empregar APIs públicas estáveis; fixar versões compatíveis quando acessar o WebView2 nativo por Rust.
- **Medição externa:** identificar o processo principal e todos os processos WebView2 associados. Registrar observações em arquivos separados dos dados do usuário. Diagnóstico técnico pertence ao relatório, sem ocupar os fluxos normais da interface.

Para o ensaio, o alvo proposto é Windows 10/11 x64, em versão compatível com as dependências estáveis escolhidas. Fixar e registrar SO, GPU/driver, versão Tauri/Rust, dependências e WebView2 Runtime usado em cada rodada. Suporte a ARM e versões antigas do Windows não faz parte desta prova.

## Contas, autenticação e segurança

Quatro slots opcionais continuam disponíveis. Cada um conserva cookies/dados da plataforma, configuração, canais e estado separados. Compartilhar um ambiente WebView2 com perfis nomeados por slot é uma hipótese de organização a provar na versão estável escolhida, incluindo popups e logout. Não presumir que o construtor Tauri expõe todas as opções de perfil existentes no WebView2. Se forem necessários diretórios separados e grupos adicionais de processos, registrar e medir esse custo; não considerar o problema resolvido apenas porque os logins funcionaram.

Slots vazios não devem iniciar players, consultas periódicas ou janelas de login permanentes. A criação ocorre quando necessária ao uso do slot; slots persistidos autenticados e com coleta habilitada precisam retomar independentemente da conta exibida. Eliminar a janela permanente de login só é aceitável se observação de cookies e renovação de sessão continuarem funcionando.

O perfil WebView2 é a fonte de cookies. O código nativo consulta somente os cookies necessários e mantém credenciais fora do renderer, snapshots, logs e relatórios. O transporte deve provar compatibilidade com os endpoints existentes, incluindo respostas inesperadas/challenges: não assumir que trocar o cliente HTTP preserva o comportamento. Conservar endpoints permitidos, validação de argumentos, timeout de 20 s, corpo limitado a 2 MiB e política de redirects das consultas atuais; esses limites não representam limite global das páginas e mídia.

Somente a UI local autorizada pode enviar comandos nativos. Páginas de login, players, lojas e popups não recebem permissões da aplicação. Comandos capturam o slot antes de qualquer espera; respostas e eventos carregam origem e geração. Troca A→B→A rejeita respostas de seleção antiga. Logout/invalidação cancela trabalho pendente e impede reabertura tardia de players/lojas/baús. Renovação do token da mesma identidade conserva baseline; identidade diferente separa históricos e referências de saldo.

Novo login será realizado pelo usuário na página oficial em perfis de teste separados. Não copiar cookies do Electron, coletar senhas ou registrar tokens. Verificações e consentimentos da plataforma continuam manuais.

## Reprodução e particularidades obrigatórias na prova

- Manter páginas oficiais e o número efetivo de players de cada cenário. Selecionar a menor qualidade disponível conforme a regra atual; registrar qualidade efetiva. Uma economia obtida interrompendo coleta ou reduzindo concorrência não é equivalente.
- Conferir comportamento com UI aberta, minimizada e na bandeja. WebView oculto pode se comportar de maneira diferente: flags e visibilidade atuais não constituem prova de crédito no WebView2.
- Testar rede interrompida, navegação com erro, renderer encerrado e suspensão/retorno do PC. Recuperar ou mostrar falha observável, sem creditar pontos artificialmente e sem multiplicar players.
- Twitch: provar consulta de identidade/saldo, leitura de chat IRC sem depender de player e envio autenticado; observar resgate confirmado na loja quando realizado manualmente. Exercitar baú opcional com fila serial por conta, clique restrito ao bônus gratuito e confirmação por saldo/claim na mesma identidade. Preservar as guardas TW-05/TW-06 e não clicar recompensas pagas.
- Kick: provar identidade/saldo e chat recebido pelos eventos dos players oficiais, deduplicação e envio para o chatroom da conta/canal corretos. Não introduzir um worker de baú.
- O player estar reproduzindo e uma fixture local passar não comprovam recebimento de pontos. Usar deltas reais da plataforma e registrar baús, compras e outros eventos que possam afetá-los.

## Perfis de teste e entrega

Executáveis do protótipo usam nome, identificador, diretório de dados e mutex separados das releases. Não disputar o autostart ou assumir a instalação existente. Usar configurações novas de teste; qualquer carga de configuração sanitizada é explícita e não contém credenciais. Não escrever nos perfis instalados. Encerramento deve fechar controles, conexões e tarefas naturalmente; uma limpeza forçada externa não é resultado de teste bem-sucedido.

Entregar builds Windows identificados como protótipo, commits e dependências registrados, instruções curtas de execução/remoção e arquivos de medição sem segredos. Não criar release estável, substituir binários publicados ou habilitar atualização automática nesta etapa.

## Comparação de desempenho

Referências: Twitchterino v0.1.5, fonte `a0942c6bb25a6a142fdab5a09c4b199a5b698e00`; Kickterino v0.3.1, fonte `90aaf8176ada0aef4f8cbe244e48fea764538643`. Conferir integridade pelos manifests publicados. As branches main consultadas na base técnica não contêm todas as alterações das releases.

Usar o protocolo de [DESEMPENHO.md](../../technical/DESEMPENHO.md): estabilização >=10 min, observação >=30 min, amostras a cada 5 s, pelo menos três rodadas, teste prolongado >=8 h. Ampliar a janela quando os pontos não permitirem conclusão. Alternar a ordem das versões e evitar que Electron e protótipo disputem a mesma conta/canal durante a comparação individual.

O cenário principal é **uma conta autenticada com duas lives simultâneas em cada aplicativo**, comparando Electron e Tauri separadamente. Uma conta como referência unitária é uma escolha técnica do autor; não presume quantas contas o usuário usará no dia a dia. Medir com UI aberta e na bandeja, e usar a mesma carga no ensaio prolongado. Na rodada com os dois apps simultâneos, usar uma conta e duas lives em cada app, totalizando quatro players no PC. Ensaios com mais contas são complementares para isolamento e escala e mantêm duas lives por conta; não ampliar a concorrência por conta para procurar pontos adicionais.

| Cenário | Papel no ensaio | Objetivo |
| --- | --- | --- |
| Sem login, UI e bandeja | Controle | Medir shell, slots vazios e atualização de interface |
| Uma conta autenticada, coleta pausada | Controle | Separar sessão/chat do custo da mídia |
| Uma conta × duas lives por app | Principal | Comparar consumo, qualidade efetiva e pontos recebidos nas duas lives |
| Duas contas × duas lives por conta | Complementar | Verificar isolamento, concorrência e troca de seleção |
| Quatro contas × duas lives por conta | Complementar, conforme disponibilidade | Avaliar oito players por app quando houver contas disponíveis para o ensaio |
| Dois apps simultâneos, uma conta × duas lives em cada | Principal combinado | Medir consumo combinado e interferência com quatro players no PC |
| Falhas, transientes e >=8 h, uma conta × duas lives por app | Principal prolongado | Observar recuperação, picos e crescimento de memória |

A carga de duas lives por conta foi definida pelo usuário. A quantidade habitual de contas e a disponibilidade de contas reais para os cenários complementares não foram informadas; isso não impede priorizar a comparação unitária acima. A falta de quatro contas reais não pode ser substituída por contas fictícias numa conclusão sobre consumo de mídia ou pontos.

Registrar memória privada/commit e working set por árvore de processos, CPU, GPU/decoder quando disponível, tráfego de rede, quantidade efetiva de players, início frio e responsividade. Definir unidades e método; apresentar mediana, p95, pico e dispersão entre rodadas. Não somar várias vezes memória compartilhada nem somar campos globais repetidos por slot. Anotar recursos indisponíveis na coleta, em vez de preencher zero.

O candidato combina mudança de runtime com criação sob demanda e agendamento mais econômico. O relatório deve distinguir o que foi alterado e não atribuir toda economia ao Rust. Uma comparação adicional com Electron otimizado pode ser proposta se o resultado sugerir que melhorias da arquitetura explicam a maior parte do benefício; não faz parte da comparação inicial.

## Evidência necessária e decisão de continuidade

1. Guardas de conta, token, origem e cancelamento verificadas em cenários controlados; login e reprodução demonstrados no Windows.
2. Confirmação real de pontos nas duas lives simultâneas da mesma conta e comportamento de chat em cada plataforma; baú Twitch confirmado quando disponível. Não concluir sucesso somente porque uma das lives recebeu pontos. Caso uma live não receba pontos, investigar e registrar a falha ou limitação observada. Janela sem evidência suficiente ou sem baú disponível produz resultado inconclusivo na verificação correspondente, sem inventar créditos.
3. Redução reproduzível de memória no cenário relevante, além da variação entre rodadas, sem regressão material observada em CPU, GPU, responsividade ou coleta. Mostrar dados brutos e limites da comparação; um saldo sem aumento em ambas as versões exige investigação, não aprovação automática.
4. Sessões isoladas e persistentes, UI/bandeja, recuperação e encerramento funcionando dentro do escopo. Funcionalidade ainda não portada continua explicitamente pendente.
5. Usuário avalia benefício medido e esforço restante antes de autorizar migração completa. Nenhuma meta percentual ou limite de MB foi acordado; a escolha de um ganho mínimo satisfatório fica para a leitura dos resultados, com os dados expostos.

Resultados possíveis: seguir com Tauri; ajustar a organização e repetir somente as provas afetadas; permanecer no Electron com otimizações; ou avaliar C#/WPF se um obstáculo específico justificar. Uma prova que não produz economia útil ou perde regras de negócio também é um resultado válido.

## Questões em aberto e escolhas deixadas à implementação

- **Definido pelo usuário:** duas lives simultâneas por conta como carga do teste, mantendo a referência de operação atual em cada plataforma.
- **Informações a registrar no ensaio:** características do PC alvo e disponibilidade de contas para verificações complementares. A quantidade habitual de contas não foi informada; não presumir quatro contas em uso só porque existem quatro slots.
- **Propostas do autor sujeitas à revisão:** Twitch antes de Kick, escopo reduzido do protótipo, Windows 10/11 x64, novos logins em perfis separados, referência principal de uma conta por app e ensaios complementares com mais contas.
- **Da implementação:** versões estáveis exatas, organização de crates, bibliotecas de transporte/serialização, ferramenta de coleta Windows e forma de acessar APIs nativas. Registrar as escolhas antes de medir e manter o núcleo do protótipo descartável.
- **A provar, não a decidir por suposição:** isolamento com perfis/ambiente WebView2, captura dos eventos necessários, compatibilidade de login/requisições e crédito efetivo com reprodução em segundo plano.

## Fontes das capacidades candidatas

- [Tauri — WebView2 no Windows](https://v2.tauri.app/reference/webview-versions/).
- [Tauri — acesso ao WebView nativo](https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html#method.with_webview).
- [Tauri — permissões e capabilities](https://v2.tauri.app/security/capabilities/).
- [Microsoft — perfis WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/multi-profile-support).
- [Microsoft — processos WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model).

Essas fontes demonstram capacidades gerais. Não são evidência de que a integração dos dois aplicativos ou a economia pretendida já foi validada.

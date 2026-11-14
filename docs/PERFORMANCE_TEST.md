# Teste Electron otimizado — Windows

Build experimental, identificado por commit em build-info.json. Referência anterior: Twitchterino0.1.5, duas contas e quatro lives, RAM privada residente mediana2,11GiB e CPU total mediana5,34%. Economia do novo build ainda precisa ser medida. Este pacote usa um perfil próprio, sem copiar cookies do aplicativo instalado.

## Preparar uma vez

1. Extraia o ZIP completo. Encerre outras versões de teste e a versão instalada pelo menu da bandeja.
2. Na pasta extraída, execute `./Start-WindowsValidation.ps1`. O script confere os hashes e abre app/Twitchterino.exe com perfil isolado. Novos slots de teste começam pausados.
3. Faça login oficial nas mesmas duas contas. Configure duas lives por conta, os mesmos canais e a mesma qualidade efetiva da rodada anterior; mantenha a interface aberta. Confirme os quatro canais que estão efetivamente tocando.
4. Ative a coleta e confira créditos. O estado “aquecendo” não adia o registro de créditos reais. Canal sub online tem prioridade nas vagas automáticas mesmo após a meta, respeitando pausa, limite de vagas e janelas manuais. Se isso mudar os canais selecionados frente à referência, registre a diferença: a comparação deixa de ter canais idênticos.
5. Confira resgates reais feitos por você na loja do aplicativo: XP Boost e Capture XP Boost devem entrar no contador correspondente e na duração correta, sem duplicar quando o saldo atualizar. O aplicativo não realiza compras automáticas de recompensas pagas.
6. Encerre pelo menu da bandeja para salvar a preparação. O PowerShell volta ao prompt. Reabra este mesmo pacote para reutilizar o perfil.

## Medir

Com a preparação salva e o aplicativo encerrado, execute na mesma pasta:

```powershell
.\Start-WindowsValidation.ps1 -Measure -Diagnostics
```

O launcher abre o executável verificado, obtém seu PID e inicia o coletor sem exigir uma variável copiada manualmente. Ele aguarda10min e mede30min, em intervalos efetivos próximos de5s. Mantenha quatro lives ativas e a janela principal aberta. Ao final, aparece a pasta medicao-twitchterino-AAAAmmdd-HHMMSS. A janela do app continua aberta para conferência e deve ser encerrada pela bandeja.

Se a instância do perfil já estiver aberta, o launcher interrompe a tentativa em vez de medir um processo secundário que saiu. Para uma rodada posterior sem perder os logins de outro build, `-ProfileCommit abcdef123456` aceita apenas um perfil de teste existente deste aplicativo; o build-info identifica o commit completo de cada pacote.

Para retornar à versão instalada, encerre este teste pela bandeja e abra seu atalho habitual. O histórico e os dados originais permanecem nos perfis da versão instalada.

## Arquivos para análise

- Na pasta de medição: summary.json, environment.json, totals.csv, processes.csv.
- No perfil isolado mostrado pelo launcher: resources-log.jsonl e, se houver rotação, resources-log.jsonl.old. Esse inventário é opt-in, registra apenas papéis de janela/slot/PIDs/visibilidade e grava quando a topologia muda; não registra URLs, cookies, tokens ou chat. Vários controles podem compartilhar um PID; não somar o mesmo processo duas vezes ao atribuir memória.
- points-log.jsonl de cada conta permite conferir saldo, estado de ganho, qualidade efetiva e horários. Registre saldos inicial/final, resgates e baús por canal para distinguir eventos externos de créditos de audiência.

RAM privada residente é diferente de memória comprometida. O coletor conserva a fórmula usada na referência anterior; não soma working sets compartilhados como memória única. GPU/decoder e rede continuam sem medição pelo script.

Primeira rodada: uma repetição comparável. Depois, repetir três vezes, janela/bandeja e uma sessão de>=8h para avaliar estabilidade. Testes automáticos com fixtures não comprovam crédito real nem economia no seu PC.

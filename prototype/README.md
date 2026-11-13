# Protótipo Tauri para Windows

Build experimental, separado dos aplicativos Electron. A interface mantém a disposição atual; relatórios, compras/histórico, modo antes de dormir, notificações, autostart e teste de várias lives estão desabilitados. Cada slot usa seu próprio diretório WebView2; esse isolamento pode criar grupos adicionais de processos e seu custo precisa ser medido.

## Executar

1. Extraia o artefato Windows completo. Confira o executável pelo `SHA256SUMS.txt` e o commit em `build-info.json`.
2. Execute `Twitchterino-Tauri-Prototype.exe` ou `Kickterino-Tauri-Prototype.exe`. É necessário o [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/); o executável de teste não instala o runtime automaticamente.
3. Selecione a conta e faça login pela página oficial. Os perfis de teste são novos: não copiam cookies, senhas ou dados do Electron.
4. O protótipo inicia com coleta pausada e duas vagas. Confirme dois canais ao vivo e ative **Juntar pontos**. Confira o saldo de cada live antes e depois; vídeo reproduzindo não comprova pontos.
5. Fechar a interface mantém a coleta na bandeja. Use **Sair** no menu da bandeja ou **Fechar o app** nas configurações para encerrar.

Perfis próprios em `%APPDATA%/com.jggomes11.twitchterino.prototype` ou `%APPDATA%/com.jggomes11.kickterino.prototype` (a localização efetiva depende do Windows/Tauri). Encerrar e remover esses diretórios descarta apenas os dados de teste. A versão Electron e seus dados continuam nos diretórios originais.

Os contadores de ganhos e baús deste protótipo são da execução atual; o histórico completo ainda não foi portado. Compare pelos saldos inicial/final de cada live.

O protótipo permite até quatro contas; o ensaio principal usa uma conta e duas lives por aplicativo. Slots sem uso não criam janelas de login ou players. Ao selecionar outra conta, a coleta das contas conectadas continua. Renovações de token precisam manter a referência de saldo; outra identidade deve iniciar referência própria. Ao testar logout, confira que as outras contas continuam conectadas.

## Comparar com Electron

- Referências: Twitchterino v0.1.5 e Kickterino v0.3.1. Use os instaladores publicados e seus manifests.
- Mesma máquina, rede, canais, qualidade efetiva e quantidade de players. Execute versões alternadamente; evite outro cliente coletando com a mesma conta durante a rodada.
- Uma conta × duas lives em cada app separadamente. Depois, dois apps simultâneos, com quatro players no PC.
- Estabilize por pelo menos 10 minutos, observe por pelo menos 30 minutos e repita três vezes. Faça também uma rodada de pelo menos 8 horas para observar crescimento e recuperação.
- Registre por live: saldo inicial/final, horários dos créditos, baús, compras e intervenções externas. Baú Twitch só conta como confirmado com mudança do claim e saldo correspondente. Se não surgir baú, a prova continua pendente.
- Compare UI aberta e bandeja, interrupção de rede, player encerrado e suspensão/retorno do PC.

Abra o `.exe` normalmente, faça login e ative duas lives. Depois, abra o PowerShell na pasta extraída e execute o coletor pelo caminho do executável aberto:

```powershell
.\Measure-Prototype.ps1 -ExecutablePath '.\Twitchterino-Tauri-Prototype.exe' -WarmupSeconds 600 -DurationSeconds 1800 -OutputDirectory '.\medicao-twitch-tauri-01'
```

Para Kick, troque o executável por `Kickterino-Tauri-Prototype.exe` e use outra pasta de saída. O coletor mostra o PID encontrado, espera os 10 minutos de estabilização e mede por 30 minutos; mantenha o PowerShell aberto. Ele exige exatamente um processo com o mesmo caminho do arquivo indicado. Se não encontrar o aplicativo ou encontrar mais de um, interrompe com orientação antes de criar os arquivos. A opção `-RootProcessId` continua disponível para informar o PID pelo Gerenciador de Tarefas.

O coletor registra memória privada comprometida (`privateBytes`), RAM privada residente (`residentPrivateBytes`, quando o contador Windows está disponível), working set por processo e CPU da árvore em intervalos de 5 s. O resumo agrega memória privada; working set permanece por processo para evitar tratar páginas compartilhadas somadas como memória única. GPU/decoder e rede ficam explicitamente sem medição pelo script; use ferramentas Windows apropriadas se disponíveis e registre o método. Não publicar perfis, cookies, tokens ou mensagens privadas.

O arquivo `observations.jsonl` de cada slot registra saldo, ganho observado, qualidade efetiva do vídeo e versão do WebView2, sem tokens ou chat. A observação de resgates manuais Twitch não implementa o histórico de bônus. Os arquivos giram ao ultrapassar 5 MiB; preserve uma cópia ao encerrar cada rodada prolongada.

## O que a validação automática comprova

Testes Rust e da ponte: baseline, isolamento lógico, geração e seleção. Smoke Windows: quatro perfis com cookies fictícios separados, persistência desses cookies após reiniciar, acesso nativo negado às páginas remotas e encerramento natural do executável. **Não comprova login real, pontos, baús reais ou economia de RAM.** O arquivo `native-smoke.json` identifica exatamente a evidência obtida.

## Desenvolvimento

Requer Node 24, Rust estável e ferramentas MSVC no Windows:

```powershell
node prototype/prepare-ui.cjs
node --test prototype/tests/*.test.cjs
cargo test --locked --manifest-path prototype/src-tauri/Cargo.toml
cargo build --release --locked --manifest-path prototype/src-tauri/Cargo.toml
```

O renderer e os assets são copiados para `prototype/ui` no preparo. Os arquivos Electron de produção não são editados. O projeto Rust mantém as regras testáveis no Linux; shell e integrações WebView2 só são compilados/executados no Windows. A atribuição MIT do projeto original permanece em `LICENSE`.

# Controles de conexão por conta

Remover os controles de conexão da barra superior e o logout global. Cada cartão conectado terá uma engrenagem à direita com a ação **Desconectar**. O botão de seleção será separado da engrenagem, sem botões aninhados. Slots desconectados mostrarão **Adicionar conta** e abrirão o login do respectivo perfil; durante a verificação da sessão, mostrarão o estado de espera.

A desconexão deve capturar o ID do cartão, preservar a conta selecionada e continuar apontando para o mesmo perfil caso o usuário troque de conta durante a confirmação. Reutilizar a confirmação e a limpeza de sessão existentes, sem mostrar a janela de login. Fechar menus ao clicar fora, pressionar Escape ou desconectar. Preservar foco, navegação pelo teclado e os dados das outras contas.

Usar um componente de cartões independente da plataforma, incluído nos renderers dos dois apps, com callbacks para selecionar, conectar e desconectar. Ambos os apps possuem quatro perfis na base atualizada do remoto (Twitch 0.1.6 e Kick 0.3.2). Preservar as melhorias de título e de cabeçalho feitas neste chat, sem alterar os preços dos bônus.

Remover o controle “Juntar pontos” da barra superior. Iniciar a coleta automaticamente ao abrir o app com uma conta conectada, reativando perfis anteriormente pausados e preservando as demais preferências. Atualizar a documentação e os roteiros de validação para o novo comportamento.

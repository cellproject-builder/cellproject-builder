# Abas e janelas dos estúdios visuais

O Estúdio 3D (incluindo diagramas) e a busca de imagens têm abas integradas à superfície do painel. Cada aba mantém seu pedido, referências, anexos, progresso e resultados. O botão **+** começa um pedido vazio; não há limite de três abas.

Arrastar uma aba para fora da barra destaca o pedido em outra janela da aplicação. Soltar na barra de uma janela da mesma ferramenta reúne ou reordena as abas. O botão **Destacar aba** oferece a mesma ação por teclado e em telas de toque. As janelas continuam móveis e redimensionáveis.

## Execução e contexto

- Trocar de aba, destacar, reunir e minimizar preservam os pedidos em andamento.
- Fechar uma janela ou aba em processamento recolhe a janela para o dock. **Cancelar**, no pedido, interrompe somente aquela operação.
- Vários pedidos podem executar simultaneamente. Limites e erros do provedor continuam valendo individualmente; não há repetição automática de chamadas pagas.
- As respostas ficam na aba de origem, mesmo chegando fora de ordem. Uma resposta em outra aba não muda a seleção atual.
- Gerações concluídas pelo chat entram em uma aba própria. Usar uma imagem como base inicia outro pedido e preserva as buscas existentes.
- O modo de aprovação/aplicação automática continua sendo uma configuração do projeto. Aplicar propostas mantém as verificações existentes de projeto e referências.

## Ciclo de vida

As abas e o layout são estado temporário da sessão. Ao atualizar a página, sair do construtor ou trocar de projeto, os processos são encerrados; não se promete retomada de uma chamada ao provedor. O último rascunho de cada ferramenta e as propostas já armazenadas seguem a persistência do projeto, incluindo a criptografia quando o cofre está ativo. Os demais rascunhos de abas não são restaurados após recarregar.

## Organização do código

- `sessionStore.ts`: pedidos e organização das janelas, sem controllers ou acesso a provedores.
- `TabbedVisualExplorer.tsx`: lista plana de sessões com chaves estáveis; mover uma aba altera seu frame sem remontar o conteúdo ou reiniciar o pedido.
- `VisualExplorer.tsx`: composição, busca/refinamento/geração e resultados de cada sessão.
- `PopupTabs.tsx` e `FloatingPopup.tsx`: apresentação, arrasto, destaque, teclado e redimensionamento.
- `controller.ts` e `search.ts`: operações independentes e handoff de resultados externos, sem cancelamento global de buscas.

Os testes cobrem três gerações e três buscas simultâneas, respostas fora de ordem, identidade do compositor ao destacar/reunir, fechamento durante execução, cancelamento explícito, histórico e resultado vindo do chat. A apresentação também foi conferida no navegador local, incluindo largura de 390 px.

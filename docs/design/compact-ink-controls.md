# Controles compactos de tinta

O Plan Builder e o Dynamic Board compartilham uma barra de tinta orientada pelo canvas: coluna na borda lateral de superfícies largas e linha no topo das superfícies altas. Em landscape com menos de 340 px de altura, a barra também usa o topo para preservar o espaço das escolhas e do histórico. A orientação acompanha o tamanho da superfície, sem alterar coordenadas, pressão ou histórico dos traços.

A barra mantém o botão da ferramenta atual, Desfazer e a saída disponíveis com as escolhas recolhidas. Desfazer permanece visível, desabilitado quando não há operação disponível. Refazer aparece quando há uma operação para refazer. Clique, Enter ou Espaço revelam as escolhas; hover e foco isolado não as abrem. Escape recolhe e devolve o foco ao botão. Um ponteiro fora da barra recolhe as escolhas sem capturar o foco do destino.

`InkToolbar` mostra dois botões: caneta atual e Ajustar traço. O primeiro abre as cinco canetas; escolher uma aplica seu preset, preserva a cor e fecha o seletor. O segundo abre cor, espessura, opacidade e a prévia. Os popovers permanecem dentro do canvas e fora da faixa rolável. Não há favoritos ou uma coleção permanente de cinco botões de caneta.

Os controles usam 36 px em desktop e 44 px em superfícies touch ou estreitas. Somente a área de escolhas rola; o histórico fica fora dela. Conteúdo, geração e importação pertencem às ações do canvas e não aos filhos da barra de tinta.

## Contrato de integração

`InkPalette` preserva `label`, `children`, `preview`, `english`, `className`, `variant` e `dock`. As variantes `panel` e `strip` compartilham a barra compacta. `dock="auto"` é o padrão; `left`, `right`, `top` e `bottom` continuam disponíveis.

As novas propriedades são opcionais:

| Propriedade | Uso |
| --- | --- |
| `onUndo`, `canUndo` | Ação sempre visível quando existe callback; habilitada quando `canUndo` é verdadeiro. |
| `onRedo`, `canRedo` | Ação visível quando existem callback e operação para refazer. |
| `onExit`, `exitLabel` | Saída da tinta, com nome acessível configurável. |
| `disabled` | Desabilita o seletor e as ações persistentes durante uma interação protegida. |
| `onKeyDown` | Encaminha atalhos da barra para o canvas. O planner usa isso para desfazer/refazer e sair, inclusive com foco no botão recolhido. |

Os filhos recebem apenas controles necessários ao modo atual, sem duplicar histórico ou saída. Para desenho com dedo, usar um label contendo o input acessível, `HandIcon` e texto em `span`; o texto fica visualmente recolhido. Labels antigos sem ícone conservam um checkbox visível.

O elemento posicionado é `.ink-palette-rail`. Os elementos `.ink-palette-trigger` e `.ink-palette-controls` ficam no fluxo. `[data-ink-brush-trigger]` identifica o seletor atual; `[data-ink-brush-option]` só existe enquanto o seletor está aberto.

`InkToolbar` mantém `value`, `onChange`, `english`, `disabled` e `className`. Não possui estado persistido de favoritos e não altera o roteamento de ponteiros nem o modelo de tinta.

## Verificação

Os testes de `InkPalette` e `InkToolbar` cobrem escolhas recolhidas, histórico persistente, foco/Escape, fechamento externo, isolamento de ponteiros, cinco presets e ajustes controlados. Os popovers também são exercitados nos quatro lados e em uma superfície pequena após rolagem e resize.

As regressões adjacentes preservam a verificação dos dados de tinta, undo/redo, gestos de toque/caneta, renderização e notas. Os testes que escolhem uma caneta abrem explicitamente seu seletor antes da escolha.

O relatório `docs/reports/compact-ink-palette-2026-10-11.md` registra uma implementação anterior, com abertura por hover e mais controles expostos. Suas medidas e capturas não validam esta reconstrução. A revisão visual da integração e um ensaio físico de tablet são verificações separadas dos testes automatizados.

A [revisão da reconstrução](../reports/canvas-controls-attachments-2026-10-11.md) registra os testes e as capturas desta versão.

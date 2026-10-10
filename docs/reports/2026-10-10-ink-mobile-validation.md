# Tinta e adaptação ao celular — 10 de outubro de 2026

Esta rodada reúne o desenho nos três espaços, a biblioteca de notas e a adaptação dos controles ao telefone. Não representa deploy nem ensaio com caneta/tablet físico.

## Implementação

- `src/ink`: cinco instrumentos, pressão e direção da ponta, contorno contínuo, marca-texto sem acumular transparência em cada amostra e textura determinística de lápis. A borracha percorre segmentos completos, incluindo eventos coalescidos; movimentos rápidos não dependem de acertar um ponto amostrado.
- Notas: tinta livre sobre a escrita, com âncoras de conteúdo, e caderno independente opcional. Barra junto ao topo do editor e ajustes de espessura/opacidade sob demanda. Pasta virtual Projetos → projeto, recentes e ordem alfabética, sem mover pastas pessoais.
- Board e plano: instrumentos compartilhados, seleção, régua e histórico próprios. O Board bloqueia aplicação de snapshot durante arrasto/resize e invalida histórico anterior ao receber um documento externo, evitando remover itens remotos ao desfazer.
- `src/workspace/mobile.css`, `src/components/planner-mobile.css` e estilos das ferramentas/pop-ups: áreas de toque de 40–44 px, campos de 16 px, filtros em duas colunas, navegação por drawer e barras reordenadas. O canvas mantém suas coordenadas e seu zoom. A barra horizontal do Board permite rolar até as ferramentas adicionais.
- Pop-ups: enquadramento na `visualViewport` para teclado virtual, mantendo o tamanho preferido e o rascunho. Zoom e atalhos visuais do mapa ocupam linhas separadas à esquerda; a paleta aberta usa esse espaço sem sobreposição.
- Ícones: família compartilhada Lucide, preservando IDs e cores dos projetos existentes.

## Evidência desta rodada

| Verificação | Resultado |
| --- | --- |
| `npm test -- --reporter=dot` | 1.432 passaram, 8 ignorados; 159 arquivos passaram e 2 foram ignorados. |
| `npm run test:gateway` | 143 passaram, zero falhas. |
| `npm run build` | TypeScript e build concluídos; permanece aviso de chunks acima de 500 kB. |
| `npm run check:bundle` | Sem módulos de funcionalidades carregados antecipadamente; orçamento validado. |
| Navegador, 390 × 844 e 320 × 740 CSS px | Notas, Board e estúdio dentro da largura da página; texto de edição de 16 px. |
| Fluxo de tinta real no navegador | Nota sintética preservou o texto ao receber um traço de bico de pena; Board sintético desenhou um traço e desfez/refez com contagem de objetos 1 → 0 → 1. |
| Controles do mapa | Colisão entre zoom e imagem/3D reproduzida e corrigida; controles de 44 px. |

Capturas de conferência foram salvas fora do repositório, na pasta de visualizações da sessão. As notas/quadros com prefixo QA são dados sintéticos de conferência local.

## Limites

A sincronização tem [contrato e limites próprios](../modules/ink-live-sync.md): prévias cifradas, mesma conta/cofre aberto, relay em um processo, snapshots CAS e ausência de CRDT. A suíte cobre transporte e aplicação de revisões; não houve demonstração nesta rodada com dois aparelhos físicos. Pressão, rejeição de palma e latência de hardware ainda precisam de ensaio real. Fontes de um diagrama ou nó dentro do mundo do canvas dependem do zoom escolhido; a adaptação mobile aumenta os controles da interface sem alterar a geometria do conteúdo.

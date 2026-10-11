# Layout completo de execução — 11/10/2026

Revisão de Kanban, lista e Scrum após a distinção explícita entre aparência dos cards e composição da tela. Base local: `de61d29fd513a2ea0a12a9d786a4850ed9c5672c`. A implementação anterior permanece documentada no [relatório de apresentação](execution-workspace-design-2026-10-11.md); este registro não substitui suas evidências.

## Referência e decisão

Fonte conferida: [Mega-Vale-Transportes/workspace-megavale](https://github.com/Mega-Vale-Transportes/workspace-megavale/tree/f3be27e9b4dc96153af46062ec8e22be9f4375e9), commit `f3be27e9b4dc96153af46062ec8e22be9f4375e9`. Foram lidos shell, `BoardHeader`, `ViewBar`, `TaskBoard`, `TaskGroupSection`, `TaskList`, `CronogramaView`, `SprintPanel` e estilos de coleções, Gantt e responsividade. Os screenshots versionados do repositório mostram uma composição anterior; o código desse commit foi a referência para o cabeçalho integrado. Não foi feita comparação autenticada da aplicação corporativa em produção.

O padrão aproveitado é uma moldura principal contínua, controles compactos fora da rolagem e hierarquia de coleções. No Scrum, o ciclo selecionado precede calendário e tarefas. Foram mantidos os temas, dados e regras do Dynamic Diary; não foram introduzidos responsáveis, saúde de sprint ou burn-up fictícios.

## Alterações

- `ExecutionHeader` reúne projeto, título, busca, visualização, filtros e criação. O quadro usa uma faixa; lista e Scrum usam toolbar e faixa secundária no desktop. Em containers até 1000px, as opções secundárias ficam num popover; até 620px, a busca abre no cabeçalho e controles têm alvos de 44px.
- A moldura de execução fica no `main`. Cabeçalho e conteúdo rolável são irmãos, evitando deslocar controles ao percorrer tarefas. Nenhum portal ou nova biblioteca foi adicionado.
- Kanban usa colunas de 320px alinhadas pelo topo, canvas de 12/14px, gap de 10px, contagem compacta e divisória. Cards distribuem referência/origem/status, título e metadados/prioridade em três níveis.
- Lista usa faixas de grupo de 36px e linhas desktop de 44px. Ordem: estado, prioridade, referência, título/sinais e prazo. A composição móvel preserva título e ações sem extravasar a página.
- Scrum abre na sprint em andamento, depois primeira planejada ou histórico disponível. Picker/anterior/próxima percorrem somente ciclos persistidos. O painel contém nome, datas, objetivo, ação, progresso e contagem dos estados; seguem timeline compacta, tarefas selecionadas, backlog e histórico.
- Escolher quadro/lista mantém a preferência do aparelho. Alterar visualização não altera tarefas. Fechar opções devolve foco ao gatilho visível; navegar entre tarefas e Scrum restaura foco no cabeçalho de destino após a remontagem.

## Verificação executada

Ambiente: Windows, Node/npm do workspace, Chromium do navegador integrado. A inspeção usou componentes reais do `Workspace`, estilos globais e dados sintéticos em origem local separada na porta 5195, sem dados da conta ou chamadas de IA. O localhost principal na porta 5190 foi preservado.

| Verificação | Resultado |
| --- | --- |
| Header, Board e Scrum direcionados | 20 testes passaram: busca/foco, Escape, clique externo, troca/remontagem, filtros, atribuição, progresso e histórico |
| `npm test` | 217 arquivos passaram, 2 ignorados; 2.353 testes passaram, 8 ignorados; 132,73s |
| `npm run lint` | Passou (`tsc -b`) |
| `npm run build` | Passou; 2.588 módulos transformados |
| `npm run check:bundle` | Passou; nenhum módulo de recurso entrou no bootstrap ansioso |

O navegador verificou larguras de 320, 390, 760, 1024 e 1440px em recortes das três telas. Em 390px, os controles principais mediram 44×44px e o header 54px. Busca e prioridade funcionaram juntas; a opção de lista fechou o popover e devolveu foco ao gatilho. A navegação para Scrum preservou foco no destino. O painel mudou de sprint ao usar próxima, preservando os dados.

OLED, cinza e claro foram inspecionados. Uma coleção sintética de 88 tarefas exercitou rolagem da lista e colunas independentes do Kanban: cabeçalho fixo, conteúdo acessível e nenhuma rolagem horizontal no documento. A rolagem horizontal intencional fica dentro do quadro/timeline. Isso verifica composição e alcance do conteúdo; não é benchmark de fluidez ou ensaio físico com caneta.

A revisão independente encontrou perda de foco ao fechar opções e ao navegar para outra superfície. Ambas foram corrigidas e cobertas por regressões antes desta entrega. A inspeção no navegador também encontrou toggles de busca/opções aparecendo no desktop por precedência de CSS global; a especificidade foi corrigida e a tela conferida novamente.

## Evidências visuais

Capturas sem edição de pixels; a escala do Windows gera imagens de 1,5× a dimensão CSS.

- [Kanban desktop OLED](assets/execution-layout-2026-10-11/kanban-desktop.png)
- [Lista desktop OLED](assets/execution-layout-2026-10-11/list-desktop.png)
- [Scrum desktop OLED](assets/execution-layout-2026-10-11/scrum-desktop.png)
- [Kanban móvel](assets/execution-layout-2026-10-11/kanban-mobile.png)
- [Opções móveis](assets/execution-layout-2026-10-11/execution-options-mobile.png)
- [Lista móvel](assets/execution-layout-2026-10-11/list-mobile.png)
- [Scrum móvel](assets/execution-layout-2026-10-11/scrum-mobile.png)
- [Lista no tema cinza](assets/execution-layout-2026-10-11/list-desktop-gray.png)
- [Scrum em 320px](assets/execution-layout-2026-10-11/scrum-phone-320-gray.png)
- [Rolagem com volume no tema claro](assets/execution-layout-2026-10-11/kanban-volume-light.png)

O build ainda informa chunks acima de 500kB, incluindo App e Three.js. Esta rodada não substitui a avaliação de desempenho ou um teste em tablet físico. Os oito testes ignorados dependem de serviços externos e não foram apresentados como aprovados. Não houve mudança no esquema de persistência ou configuração de autenticação.

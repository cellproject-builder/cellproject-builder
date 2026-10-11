# Dynamic Board

Visão canônica do módulo, conferida no código em 10/10/2026. O nome do produto é Dynamic Diary; os nomes `cellproject-*` ainda usados na persistência são contratos de compatibilidade. Este documento descreve implementação e limites observáveis, sem substituir o [desenho original](../superpowers/specs/2026-10-10-dynamic-board-design.md) ou afirmar eficácia em pesquisa.

## Finalidade e estado

O Dynamic Board é um espaço livre para escrever, desenhar e relacionar ideias antes de existir um plano. Um quadro tem identidade própria. Criá-lo não cria projeto, nota, tarefa ou nó do planner.

| Estado | O que pertence ao módulo |
| --- | --- |
| Implementado | Biblioteca de quadros nomeados; busca pelo título; arquivamento e restauração; canvas com pan/zoom; cartões, texto, traços livres, imagens, diagramas SVG e modelos 3D; conexões opcionais; seleção, movimento, redimensionamento, cópia, duplicação, remoção e desfazer/refazer. |
| Implementado | Cinco instrumentos de tinta compartilhados, cor, espessura, opacidade, régua, borracha de traço e laço de seleção; prévia temporária entre dispositivos quando o canal cifrado está disponível. |
| Implementado, dependente de serviços | Compositor de IA para diagrama, 3D, busca de imagens e aprimoramento de um texto. Requer a configuração/capacidade correspondente. O resultado aparece como proposta antes da inserção. |
| Experimental no sentido de uso | Diagramas e modelos gerados são representações exploratórias. Validação de schema não transforma uma ilustração em ensaio, medição ou prova de compatibilidade física. |
| Planejado | Transformar um quadro em plano por uma ação explícita. Não há conversão automática entregue. |

O quadro livre também é diferente do [Kanban de tarefas](../../src/workspace/Board.tsx). O uso do nome `Board` nesses dois contextos não indica que compartilhem os mesmos objetos de domínio.

## Fluxo da pessoa

1. Abrir Dynamic Board na navegação e criar ou reabrir um quadro. A biblioteca mostra objetos e data de atualização; quadros arquivados ficam numa lista recuperável.
2. Inserir cartão/texto, desenhar, colar/importar imagens ou colar artefatos compatíveis. Posições pertencem ao espaço do canvas, inclusive coordenadas negativas.
3. Mover, redimensionar e conectar objetos. Texto aceita formatação por Markdown; desenhos são traços vetoriais. Conexões são relações livres, sem hierarquia de plano ou significado físico automático.
4. Opcionalmente abrir o compositor, escrever o pedido e escolher se o conteúdo do quadro entra no contexto. Referências `@` são objetos do próprio quadro.
5. Examinar a prévia e seus controles. Inserir/aplicar exige uma ação explícita. Minimizar mantém a geração; fechar cancela. Uma proposta desatualizada não pode ser aplicada.
6. Voltar à biblioteca ou arquivar o quadro. Arquivar preserva identidade e conteúdo.

Atalhos e foco ficam no canvas, preservando campos de edição. `Ctrl+D` duplica a seleção; desfazer/refazer percorrem até 30 documentos anteriores na sessão do canvas. O histórico de desfazer não é persistido. Pan/zoom é salvo sem entrar nesse histórico; desfazer preserva o viewport atual.

Como esse histórico guarda documentos completos, a chegada de um documento externo invalida as operações anteriores da sessão. Isso impede que desfazer uma ação antiga apague um item recebido do outro dispositivo; novas ações iniciam um histórico sobre a versão recebida. Durante arrasto ou redimensionamento, um guard impede a substituição por snapshots remotos e é liberado na conclusão, cancelamento ou saída da superfície.

## Desenho e paleta

Desde 11/10/2026, as ferramentas do desenho abrem numa faixa única: coluna na lateral de um canvas largo e linha no topo de um canvas alto. A faixa acompanha o tamanho da superfície, mantém alvos de 44 px e rola no próprio eixo. Canetas e régua aparecem primeiro; espessura/opacidade abrem num popover dentro do canvas, sem aumentar a faixa. Recolher permanece acessível durante a rolagem. O [relatório da paleta compacta](../reports/compact-ink-palette-2026-10-11.md) registra as verificações e os limites do ensaio responsivo.

A paleta reutiliza [InkToolbar](../../src/ink/InkToolbar.tsx) e o renderer [InkStroke](../../src/ink/InkStroke.tsx). Os instrumentos são caneta, bico de pena, monoline, lápis e marca-texto. Cor e instrumento ficam à mão; espessura e opacidade aparecem no ajuste de traço. Pontos de pressão e eventos coalescidos são usados quando fornecidos pelo navegador. O bico de pena usa orientação fixa e o lápis uma textura determinística; não são simuladores completos de materiais ou sensores físicos.

Cada gesto concluído cria um item de desenho. Cancelar não salva a prévia. A borracha remove traços atingidos pelo caminho, inclusive entre amostras afastadas; não recorta apenas um pedaço do traço. O laço seleciona objetos para as ações existentes do quadro. A régua restringe o novo traço a um segmento reto.

O [transporte ao vivo](ink-live-sync.md) envia prévias cifradas do escopo `board:<id>` para outros dispositivos da mesma conta/cofre. O traço definitivo continua sendo salvo pelo store, e o snapshot confirmado substitui a prévia. O relay SSE do servidor Node não usa Supabase Broadcast. Atualizações de documento preservam o viewport local e respeitam revisão CAS, edição em andamento e conflitos; não há CRDT nem mesclagem automática de dois desenhos simultâneos.

## Pipeline e fronteiras

| Etapa | Responsável e contrato |
| --- | --- |
| Navegação | [Workspace.tsx](../../src/workspace/Workspace.tsx) carrega a superfície `boards` sob demanda e suspende o chat geral nessa superfície. |
| Biblioteca | [DynamicBoards.tsx](../../src/boards/DynamicBoards.tsx) seleciona quadros, busca títulos e chama ações de arquivar/restaurar. |
| Interação | [BoardCanvas.tsx](../../src/boards/BoardCanvas.tsx) adapta documentos ao React Flow, coordena gestos, clipboard, histórico local, imagens e compositor. |
| Objetos | [BoardItemNode.tsx](../../src/boards/BoardItemNode.tsx) implementa edição e ferramentas por tipo; [BoardText.tsx](../../src/boards/BoardText.tsx) controla texto/formatação. |
| Operações puras | [operations.ts](../../src/boards/operations.ts) copia seleções, remapeia IDs/relações na colagem, remove conexões incidentes e converte traços para coordenadas locais. |
| IA e revisão | [BoardComposer.tsx](../../src/boards/BoardComposer.tsx) mantém prévia e aplicação; [generation.ts](../../src/boards/generation.ts) gera/busca sem mutar o quadro. |
| Renderização compartilhada | Diagramas usam [DiagramView.tsx](../../src/visuals/diagram/DiagramView.tsx). Modelos usam a camada Three.js existente; [BoardModelPreview.tsx](../../src/boards/BoardModelPreview.tsx) oferece prévia independente com renderização sob demanda e fallback sem WebGL 2. |
| Mutação e persistência | `createBoard`, `openBoard`, `updateBoard` em [workspace/store.ts](../../src/workspace/store.ts) validam o registro e o orçamento agregado antes de substituir o estado. |

O reuso do renderer e dos schemas visuais não liga o quadro ao planner. Diagramas independentes usam `nodeId` ausente/nulo; colagens compatíveis removem vínculos de nós do plano. Modelos entram como cenas declarativas validadas, sem executar código produzido pela IA.

## Dados e persistência

O contrato está em [model.ts](../../src/boards/model.ts):

- `BoardRecord`: `id`, `title`, `document`, `archived`, `createdAt`, `updatedAt`; sem `projectId` ou `noteId`.
- `BoardDocument` versão 1: `items`, `edges`, `viewport`. Cada item tem ID, tipo, posição e tamanho. Os tipos são `card`, `text`, `drawing`, `image`, `diagram` e `model`.
- Diagrama guarda documento declarativo e valores atuais dos parâmetros; modelo guarda `SceneV1`; imagem guarda raster inline e rótulo; desenho guarda pontos locais, cor, espessura e, opcionalmente, instrumento, opacidade e pressão por ponto. Campos opcionais preservam a forma e a aparência de documentos legados.
- Até 200 itens, 500 conexões, 4.096 pontos por desenho e 100 mil pontos de desenho por quadro. Conexões precisam apontar para itens presentes; IDs duplicados são rejeitados.
- Até 6 MiB de caracteres de fontes de imagem por quadro e 16 MiB agregados entre quadros e cadernos. Essas cotas medem strings serializadas, não equivalem ao tamanho bruto de arquivos.
- O schema aceita zoom de `.05` a `8`; o controle React Flow limita a interação normal até `4`. São limites distintos de documento e interface.

`boards` viaja no envelope `cellproject-workspace`, versão 2, junto aos demais dados do workspace. `activeBoardId` e seleção/histórico do canvas não são persistidos. A ausência de `boards` é aceita para envelopes antigos. Um quadro incompatível faz a hidratação falhar com preservação da origem; não é descartado silenciosamente.

O [repositório selecionado](../../src/data/workspaceRepository.ts) delega ao armazenamento local ou ao runtime de nuvem configurado. Quadros não criam um backend próprio. [workspaceTransfer.ts](../../src/data/workspaceTransfer.ts) inclui quadros em backup e exportação por linhas. Cofre, autenticação, conflitos e transporte pertencem à infraestrutura existente; a presença desse caminho no código não comprova sincronização ou implantação remota no momento da leitura.

## Contexto de IA e integração de imagens

O compositor lê somente o quadro solicitado e as referências autorizadas. `useContent` compartilha título, semântica dos itens e relações; não inclui implicitamente plano ativo, outras notas, coordenadas ou tinta. O contexto serializado é limitado a 24 mil bytes, priorizando referências explícitas.

O quadro possui uma exceção explícita para visão: imagens selecionadas com `@` podem enviar pixels à geração de diagrama/modelo, com limite de quatro imagens e 4 MiB decodificados. O contexto geral do quadro leva rótulos de imagens. Isso difere do caderno de notas, que não envia pixels implicitamente nesse fluxo.

`boardAISignature` acompanha identidade e conteúdo semântico autorizado. Mudança de conteúdo, exclusão ou troca de quadro invalida a operação; mover, redimensionar, estilizar e desenhar não a invalidam. O guard observa alterações durante a chamada, inclusive uma alteração posteriormente revertida.

A busca consulta `/api/visuals/capabilities` e registra sessão com escopo `board:<id>` em `/api/visuals/reference-sessions`. Candidatos precisam usar mídia registrada no gateway. A imagem escolhida é buscada pelo caminho autorizado, decodificada e reencodada pelo [serviço raster](../../src/workspace/noteImages.ts), tornando-se inline. Ela não depende do coletor de mídia do planner após a inserção. Importações usam [registerDataIngestion](../../src/cloud/activity.ts) durante leitura, conversão e mutação, com liberação no cancelamento/erro.

O assistente geral não oferece CRUD de quadros em `workspace_read`/`workspace_action`; esses schemas em [workspaceTools.ts](../../src/ai/workspaceTools.ts) listam projetos, tarefas, sprints, notas, pastas e comentários. A IA do quadro é um compositor específico, sem autonomia de agente Dairo.

## Evidência de software e limites

Os arquivos abaixo são evidência de contratos exercitados por testes, não resultados de um estudo com usuários. Esta revisão documental não executou chamadas externas nem repetiu ensaios físicos.

| Evidência | O que cobre |
| --- | --- |
| [model.test.ts](../../src/boards/model.test.ts), [store.test.ts](../../src/boards/store.test.ts) | Independência, validação, todas as variantes, cotas compartilhadas, roundtrip no armazenamento, legado e rejeição de envelope remoto inválido. |
| [operations.test.ts](../../src/boards/operations.test.ts), [BoardCanvas.test.tsx](../../src/boards/BoardCanvas.test.tsx) | Clipboard, IDs, relações, desenho, duplicação, desfazer, coordenadas, redimensionamento, foco, maximização e ciclo da importação/cancelamento. |
| [DynamicBoards.test.tsx](../../src/boards/DynamicBoards.test.tsx), [BoardItemNode.test.tsx](../../src/boards/BoardItemNode.test.tsx) | Biblioteca sem criar projetos/notas, arquivo recuperável, texto seguro, parâmetros SVG, desenho proporcional e interação 3D. |
| [generation.test.ts](../../src/boards/generation.test.ts), [BoardComposer.test.tsx](../../src/boards/BoardComposer.test.tsx) | Contexto restrito, invalidação semântica, geração declarativa, mídia registrada, prévia, inserção explícita e minimização/cancelamento. |
| [BoardModelPreview.test.tsx](../../src/boards/BoardModelPreview.test.tsx) | Renderização sob demanda, teclado, zoom, visibilidade, restauração de contexto e liberação de GPU. |
| [geometry.test.ts](../../src/ink/geometry.test.ts), [InkToolbar.test.tsx](../../src/ink/InkToolbar.test.tsx), [live.test.ts](../../src/ink/live.test.ts) | Geometria/estilos de tinta, controles compactos e frames cifrados; integração do gesto e cancelamento também pertence a `BoardCanvas.test.tsx`. |

Muitos testes de interface simulam eventos/serviços; testes de geração controlam respostas. Isso não demonstra fidelidade das respostas reais do provedor, desempenho em todo dispositivo ou usabilidade em campo. Não há resultado de comparação científica deste módulo registrado aqui.

## Lacunas e diagnóstico de modularização

O módulo já separa modelo, operações puras, geração e apresentação. A maior concentração está em `BoardCanvas.tsx`: ele possui clipboard, importação assíncrona, proteção de transições, histórico e adaptação React Flow. A evidência são os imports de `readVisualMedia`, `importNoteImage`, `registerDataIngestion` e os handlers `ingestImages`, `paste`, `save` e `travel` no mesmo componente.

Uma extração pequena candidata é um controlador de importação/clipboard do quadro, preservando o contrato `BoardDocument` e o guard até a aplicação. Não é necessário dividir o store ou unir os dois canvases para isso. O serviço raster hoje vive sob `workspace/noteImages.ts`, mas é reutilizado por quadros: uma futura localização neutra deve preservar as cotas específicas de cada documento. Nenhuma extração foi implementada nesta revisão.

Lacunas funcionais explícitas: conversão quadro→plano, CRUD de quadros pelo chat geral, histórico de desfazer persistente e avaliação empírica de uso. O primeiro 3D não certifica decomposição física, dimensões reais ou fabricabilidade.

## Perguntas e evidências possíveis para artigos

| Pergunta candidata | Evidência a coletar antes de concluir |
| --- | --- |
| Um espaço livre ajuda a explicitar alternativas antes da decomposição em plano? | Sequência de versões, relações criadas, alternativas abandonadas e comparação de tarefas equivalentes com/sem quadro. |
| Uma prévia explícita reduz aplicação de conteúdo desatualizado? | Tentativas de aplicação, invalidações, correções humanas e revisão independente da pertinência do resultado. |
| Diagramas interativos ajudam a examinar premissas? | Previsão anterior à manipulação, interpretação do controle, confronto com medição real e revisão justificada. Valores sintéticos precisam permanecer identificados. |

Para o artigo SENAI, o quadro é suporte exploratório. O ciclo de premissa, critério, ensaio, observação e revisão continua definido no [objetivo do artigo](../OBJETIVO_DO_ARTIGO.md) e no [módulo de projetos/planner](./planner-projects.md).

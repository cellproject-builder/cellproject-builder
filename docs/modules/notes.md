# Notas e caderno visual

Visão canônica do módulo, conferida no código em 10/10/2026. A descrição detalhada da entrega e de sua validação histórica está em [notes-visual-notebook.md](../notes-visual-notebook.md); este documento organiza responsabilidades, dados e limites para manutenção e uso em artigos.

## Finalidade e estado

Notas permitem registrar texto e explorar uma ideia com desenho, imagens e diagramas na mesma unidade. Podem ser pessoais ou vinculadas a projeto/tarefa. Uma nota não exige um plano ativo.

| Estado | Capacidade |
| --- | --- |
| Implementado | Biblioteca unificada, pastas pessoais, agrupamento virtual por projeto, busca por título e blocos, filtro de recentes, ordenação por nome/atualização, fixação, lixeira/restauração, vínculos opcionais, editor de blocos e maximização. |
| Implementado | Caderno vetorial opcional com seleção, caneta, borracha, régua, texto livre, imagens raster, diagramas SVG interativos, zoom e desfazer/refazer de operações. |
| Implementado | Desenho livre sobre título e blocos de texto em `NoteInkOverlay`, sem substituir ou desmontar a escrita. Caneta, bico de pena, monoline, lápis e marca-texto usam o motor compartilhado `src/ink`; cotas e persistência da nota continuam próprias. |
| Implementado, dependente de IA | Reescrita de trecho/parágrafo e geração de diagrama com prévia e aplicação explícita. |
| Experimental no sentido de uso | Modelos/diagramas ilustrativos e suas fórmulas são materiais de exploração. O aplicativo não verifica automaticamente a validade física ou o aprendizado produzido. |
| Planejado em outro módulo | Memórias duradouras automáticas do Dairo, segregadas das notas e com origem editável/apagável. Não são uma funcionalidade entregue por este editor. |

O caderno é uma folha de coordenadas delimitadas dentro de uma nota. O [Dynamic Board](./dynamic-board.md) é um documento independente com canvas livre e conexões entre objetos; os dois não são variantes do mesmo registro.

## Fluxo da pessoa

1. Abrir o Diário geral ou as notas de um projeto. O filtro geral pode incluir notas vinculadas; o filtro de projeto limita a lista àquele `projectId`.
2. Criar uma nota geral, diretamente numa pasta pessoal ou no subgrupo de um projeto. Escrever título e blocos `text`, `heading`, `bullet` ou `check`; aplicar negrito/itálico e marcar checklists.
3. Opcionalmente ligar a nota a projeto/tarefa e pasta. Trocar o projeto remove o vínculo anterior de tarefa para impedir referência cruzada.
4. Abrir o lápis/caderno. Desenhar, apagar, usar régua, inserir texto ou colar/importar imagens. Expandir mantém o mesmo editor; zoom muda a visualização, não as coordenadas salvas.
5. Para IA, selecionar trecho/parágrafo e pedir uma reescrita, ou abrir o compositor de diagrama e escolher se o conteúdo da nota entra no contexto. Examinar a prévia antes de aplicar/inserir.
6. Fixar, buscar, mover de pasta, enviar à lixeira ou restaurar. A nota na lixeira é apresentada como somente leitura; remover uma pasta preserva suas notas sem pasta.

A busca normal da biblioteca considera título e texto dos blocos, não OCR dos desenhos/imagens ou todas as legendas internas do caderno. A seleção do editor continua aberta quando uma edição deixa de corresponder à busca. Excluir uma tarefa não exclui a nota: o store limpa `taskId`.

### Organização da biblioteca

Na biblioteca geral, **Projetos** é uma pasta virtual com um subgrupo para cada projeto. Cada subgrupo usa o ícone e a cor do projeto. Notas com `projectId` aparecem nesse ramo; as notas pessoais aparecem em **Sem pasta** ou nas pastas pessoais. Uma nota aparece uma única vez. Uma nota de projeto que já tem `folderId` conserva esse valor, embora seja apresentada sob o projeto na biblioteca geral.

Abrir as notas de um projeto restringe todos os filtros e a busca ao seu `projectId` e mantém a organização por pastas dentro desse escopo. Criar pelo botão do subgrupo do projeto preenche `projectId` e deixa `folderId` nulo; criar numa pasta pessoal ou pelo botão geral não vincula um projeto quando o escopo é geral. A pasta virtual não é um registro `Folder` e não oferece exclusão de pasta.

**Recentes** mostra notas ativas atualizadas nos últimos sete dias, segundo `updatedAt` e o relógio do cliente, mantendo a busca e o escopo atuais. A lixeira continua separada. **Mais recentes** ordena cada grupo por atualização decrescente; **Nome A–Z** usa comparação de nomes adequada ao idioma, sem distinguir maiúsculas e acentos, e com ordenação numérica. Os nomes dos projetos também são ordenados alfabeticamente. Filtros, ordem e grupos abertos são estado da interface: não alteram o conteúdo nem `updatedAt` das notas.

As ações e a navegação usam a família SVG compartilhada de [SoftIcons.tsx](../../src/components/ui/SoftIcons.tsx), com traços e junções arredondados. Os IDs e cores de aparência dos projetos seguem o contrato de [aparência](../project-appearance.md).

## Pipeline e fronteiras

| Etapa | Código responsável |
| --- | --- |
| Escopo e navegação | [Workspace.tsx](../../src/workspace/Workspace.tsx) escolhe Diário ou escopo de projeto e entrega a nota solicitada. |
| Biblioteca e editor | [Notes.tsx](../../src/workspace/Notes.tsx) coordena seleção, filtros, editor, vínculos, lixeira, salvamento e maximização; [NotesLibrary.tsx](../../src/workspace/NotesLibrary.tsx) organiza grupos e prévias. |
| Texto assistido | [NoteTextActions.tsx](../../src/workspace/NoteTextActions.tsx) captura a seleção; [NoteRewriteDialog.tsx](../../src/workspace/NoteRewriteDialog.tsx) controla pedido/prévia; [ai/noteRewrite.ts](../../src/ai/noteRewrite.ts) faz uma geração pontual sem ferramentas. |
| Integração do caderno | [NoteNotebook.tsx](../../src/workspace/NoteNotebook.tsx) controla colagem, importação, leitura de mídia, cancelamento e inserção independente de diagramas. |
| Gestos e apresentação | [NoteCanvas.tsx](../../src/workspace/NoteCanvas.tsx) renderiza SVG/itens, transforma coordenadas, coordena seleção, gestos, teclado, zoom e histórico de operações. |
| Diagrama com IA | [NoteDiagramComposer.tsx](../../src/workspace/NoteDiagramComposer.tsx) controla a prévia; [noteDiagram.ts](../../src/workspace/noteDiagram.ts) limita contexto, observa alterações e valida o documento retornado. |
| Contratos | [types.ts](../../src/workspace/types.ts), [noteCanvasModel.ts](../../src/workspace/noteCanvasModel.ts), [noteCanvasPersistence.ts](../../src/workspace/noteCanvasPersistence.ts) e [noteImages.ts](../../src/workspace/noteImages.ts). |
| Estado persistente | [workspace/store.ts](../../src/workspace/store.ts) contém ações compartilhadas de nota/pasta e valida vínculos, caderno e orçamento de imagens. |

Os diagramas reutilizam [DiagramView.tsx](../../src/visuals/diagram/DiagramView.tsx) e o [modelo declarativo](../../src/visuals/diagram/model.ts). Não há execução de JSX, JavaScript ou HTML retornado pelo modelo. Colar um diagrama do planner cria uma cópia independente, limpa os `nodeId` e mantém os valores atuais dos parâmetros.

## Contratos e persistência

`Note` guarda `id`, `title`, `blocks`, `projectId`, `taskId`, `folderId`, `pinned`, `deletedAt`, `createdAt` e `updatedAt`. `canvas` é opcional para manter notas antigas válidas. Os blocos guardam tipo, texto, marcação de checklist e formatação básica; não formam um editor HTML arbitrário.

`NoteCanvasDocument` versão 1 guarda largura/altura lógicas, tipo de folha (`plain`, `dots`, `grid`, `lines`), traços e itens. A folha inicial tem 1.200×900 unidades; a régua só produz segmentos retos e não define escala física.

| Limite validado | Valor atual |
| --- | --- |
| Folha | Largura de 320 a 5.000; altura de 300 a 10.000 unidades. |
| Traços | Até 2.000; até 4.096 pontos por traço e 100 mil pontos no total; pressão opcional de 0 a 1. |
| Itens | Até 100 imagens/textos/diagramas; IDs únicos também entre traços e itens; geometria contida na folha. |
| Parâmetros de diagrama | Até seis overrides, numéricos e dentro dos intervalos declarados. |
| Raster de entrada | PNG/JPEG/WebP, até 10 MiB e 16 milhões de pixels, com assinatura de arquivo conferida antes da decodificação. |
| Raster incorporado | Redução para até 1.600 px no maior lado, reencodificação WebP e até 1 MiB por imagem processada. |
| Orçamento serializado | Até 6 MiB de caracteres de fontes de imagem por caderno e 16 MiB agregados de quadros+cadernos no workspace. |

Os limites de orçamento medem strings inline serializadas; não devem ser descritos como a soma dos bytes originais dos arquivos. `noteImageSourceSchema` aceita somente raster inline com assinatura compatível, sem URL remota, SVG ativo ou markup.

Notas e pastas são parte do envelope `cellproject-workspace` versão 2. [workspaceRepository.ts](../../src/data/workspaceRepository.ts) seleciona a infraestrutura de armazenamento existente; [workspaceTransfer.ts](../../src/data/workspaceTransfer.ts) conserva o caderno no backup/exportação. A validação de hidratação aceita notas antigas sem `canvas` e rejeita cadernos incompatíveis antes de substituir os dados em uso. A organização virtual da biblioteca reutiliza `projectId` e `folderId`: não migra notas, não cria IDs de pasta novos e não muda o formato de backup. Isso descreve o caminho implementado; não é confirmação de nuvem/cofre ativos numa sessão.

O documento do caderno persiste; ferramentas selecionadas, zoom e pilhas de desfazer são estado da interface. `NoteCanvas` aplica apenas campos tocados pela operação ao documento mais recente. Assim, desfazer um traço não deve apagar uma imagem ou diagrama inserido por outro fluxo depois dele. A cobertura correspondente fica em `NoteCanvas.test.tsx`.

## IA, contexto e integração com chat

A reescrita recebe apenas `instruction` e o texto selecionado/parágrafo. Não lê outras notas nem chama ações de aplicação. O diálogo verifica se o trecho original permanece válido antes de substituir e mantém a decisão de aplicar com a pessoa. Há `maxRetries: 0`; cancelamento ou resposta incompleta não viram uma substituição automática.

A geração de diagrama recebe pedido de até 4.000 caracteres e, com `useContent`, uma representação semântica da nota: título, blocos, textos livres, rótulos de imagens e labels/parâmetros dos diagramas. Há orçamento textual de 24 mil caracteres e limites de blocos/itens. Bytes raster, pontos de desenho, geometria, outras notas e projetos ficam fora desse contexto. O schema retornado contém formas e cálculos declarativos, com nós do planner ausentes/nulos.

`noteDiagramSignature` é estável quando a pessoa muda posição, tamanho, tinta, papel ou metadados de organização. Mudança do conteúdo compartilhado invalida/cancela o resultado, inclusive se o texto for posteriormente restaurado; excluir a nota também invalida. Com contexto desmarcado, alterações não compartilhadas não cancelam por si sós.

O chat pode ler e alterar blocos/metadados por [workspaceTools.ts](../../src/ai/workspaceTools.ts). `workspace_read` retorna resumos limitados do caderno via [noteCanvasSummary.ts](../../src/workspace/noteCanvasSummary.ts), sem pixels, pontos ou internals dos diagramas. Uma referência de nota selecionada no `@` do [chat](./chat-and-dairo.md) contém título/blocos; não incorpora o caderno inteiro. São contratos diferentes de leitura, não uma memória automática de todas as notas.

Importações usam `registerDataIngestion` desde a primeira leitura até conversão/inserção. Sair da nota cancela o fluxo e impede aplicar seu resultado atrasado; transições de dados, como backup/logout, respeitam a atividade em andamento. Copiar imagem do planner exige que a mídia ainda esteja disponível para leitura; após a incorporação a nota guarda seu próprio raster.

## Evidência de software e limites

| Testes existentes | Comportamentos examinados |
| --- | --- |
| [NotesLibrary.test.tsx](../../src/workspace/NotesLibrary.test.tsx), [Notes.test.tsx](../../src/workspace/Notes.test.tsx) | Pastas pessoais e virtuais, ausência de duplicação, criação contextual, recentes de sete dias, ordem alfabética, busca, escopo, seleção, editor maximizado, manutenção de foco e comunicação de erro ao salvar. |
| [SoftIcons.test.tsx](../../src/components/ui/SoftIcons.test.tsx) | Consistência da família SVG, dimensões, refs, nomes acessíveis e preservação de aparência legada. |
| [NoteTextActions.test.tsx](../../src/workspace/NoteTextActions.test.tsx), [noteRewrite.test.ts](../../src/ai/noteRewrite.test.ts) | Seleção/parágrafo, formatação, prévia, descarte, contexto alterado, falha/cancelamento e ausência de retries. |
| [NoteCanvas.test.tsx](../../src/workspace/NoteCanvas.test.tsx) | Pressão, régua, borracha, coordenadas lógicas, movimento/tamanho, teclado, zoom, somente leitura e desfazer preservando inserções concorrentes. |
| [noteCanvasModel.test.ts](../../src/workspace/noteCanvasModel.test.ts), [noteImages.test.ts](../../src/workspace/noteImages.test.ts), [noteCanvasPersistence.test.ts](../../src/workspace/noteCanvasPersistence.test.ts) | Schemas, assinaturas raster, cotas, parâmetros, geometria, legado e rejeição de conteúdo inválido. |
| [Notes.canvas.test.tsx](../../src/workspace/Notes.canvas.test.tsx) | Colagem nativa/artefato, independência do plano, backup+hidratação, lixeira, cancelamento e guard de ingestão. |
| [noteDiagram.test.ts](../../src/workspace/noteDiagram.test.ts), [NoteDiagramComposer.test.tsx](../../src/workspace/NoteDiagramComposer.test.tsx) | Contexto autorizado, exclusão de pixels, assinaturas semânticas, prévia, aplicação explícita, cancelamento e retenção de prévia quando a inserção falha. |

O [registro histórico de validação](../notes-visual-notebook.md#validação) distingue testes simulados, verificações no navegador e uma chamada real com pedido sintético. A contagem de suíte registrada ali corresponde àquela entrega, não a uma nova execução nesta revisão documental. Toque/caneta tiveram eventos simulados; isso não equivale a teste de hardware físico. O diagrama sintético de alavanca não comprova um ensaio mecânico.

## Lacunas e diagnóstico de modularização

`NoteCanvas.tsx` concentra hit testing, transformações, gestos, renderização e histórico. Já existe uma função interna `rebaseDocument` que aplica mudanças de uma operação sobre a versão atual e protege inserções concorrentes. Uma extração pequena candidata é esse cálculo puro de rebasing/histórico, conservando os testes de desfazer concorrente como critério de equivalência. Não há motivo para unificar notas e quadros em um único store de canvas apenas por terem SVG/imagens.

O serviço `noteImages.ts` também é consumido por Dynamic Board; sua reutilização indica uma fronteira de mídia raster mais ampla que o nome atual. Uma mudança futura de localização deve deixar explícitas as cotas por nota, por quadro e globais. Nenhuma dessas extrações foi implementada nesta revisão.

Lacunas: não há OCR do desenho, certificação dimensional, avaliação científica de aprendizagem ou memória duradoura automática neste módulo. O caderno não possui o tipo 3D nativo do Dynamic Board. A interface bloqueia edição de notas na lixeira; isso não deve ser generalizado como bloqueio de todas as ações programáticas do store/chat, cujos contratos têm escopos distintos.

## Perguntas e evidências possíveis para artigos

| Pergunta candidata | Evidência necessária |
| --- | --- |
| Texto e desenho na mesma nota ajudam a explicitar uma premissa? | Nota antes/depois, explicação da pessoa, classificação independente das premissas e comparação com registro só textual. |
| A previsão registrada antes de manipular um diagrama melhora a interpretação? | Previsão temporalmente anterior, interações, interpretação posterior e confronto com observação real. |
| Reescrita assistida preserva fatos e autoria do registro? | Texto original, instrução, proposta, decisão humana e análise de omissões/invenções por avaliador independente. |
| Contexto explicitamente escolhido reduz compartilhamento indevido? | Inventário das fontes autorizadas, payloads controlados e tentativas de inclusão de informações não selecionadas. |

Essas perguntas são propostas de avaliação. Para o artigo SENAI, notas podem guardar relatos e referências; um relato em nota não substitui a verificação das evidências exigida pelo [objetivo do artigo](../OBJETIVO_DO_ARTIGO.md).

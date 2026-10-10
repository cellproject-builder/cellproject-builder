# Projetos e planner

Visão canônica do módulo, conferida no código em 10/10/2026. O aplicativo se chama Dynamic Diary; `cellproject-workspace` e referências históricas a Cellproject permanecem em contratos e documentação. O [objetivo do artigo](../OBJETIVO_DO_ARTIGO.md) é a referência para o recorte científico: desenvolver e avaliar um método de desconstrução de planos por evidências físicas. A presença do suporte no aplicativo não comprova que a avaliação ou a construção do robô ocorreram.

## Finalidade e estado

Projetos organizam objetivo, plano, tarefas e notas ligadas à execução. O planner mantém a árvore examinável de partes, decisões, premissas, critérios e propostas da IA. Um projeto pode existir sem IA e sem árvore gerada.

| Estado | Capacidade |
| --- | --- |
| Implementado | Lista de projetos, criação/edição, objetivo, aparência individual, arquivamento recuperável, visão geral e acesso às superfícies do projeto. |
| Implementado | Ponte entre vários projetos gerenciados e um editor de grafo, preservando snapshots de cada projeto, rascunhos e propostas. |
| Implementado, dependente de IA | Esboços e expansão de plano, explicação, decomposição, crítica, pesquisa e replanejamento com contratos validados. |
| Implementado | Registro de critério próprio, observação, referências, falha e histórico; propostas de alteração aceitas/rejeitadas pela pessoa. |
| Implementado como apoio à execução | Importação explícita de folhas acionáveis para tarefas, com origem e proteção contra duplicação. Kanban/Scrum continuam sendo superfícies de tarefas. |
| Implementado como apoio visual | Tinta livre no mapa com cinco instrumentos, régua, borracha e histórico próprio, sem alterar a estrutura do plano. |
| Proposto para avaliação | Comparação entre chat comum e fluxo estruturado com o mesmo LLM e tarefas equivalentes; avaliação de transferência sem IA. |
| Futuro, fora do recorte atual | Controle físico de robô, comunicação com hardware e automação de ensaios. |

Arquivar um projeto não exclui suas tarefas ou notas. Personalização de ícone/cor é apresentação, não evidência ou prioridade inferida. O estudo do robô é um ponto de partida revisável; criar seu projeto não comprova compra, montagem ou funcionamento físico.

## Fluxo da pessoa

1. Criar um projeto a partir de um objetivo ou reabrir um projeto salvo. A interface permite começar sem um nome separado do objetivo.
2. Abrir o planner. Sem árvore, editar intenção, abordagem, restrições e referências, solicitar esboços e expandir uma alternativa escolhida. Com árvore, continuar a versão do próprio projeto.
3. Selecionar uma parte no grafo ou tutor, examinar o que fazer e por quê, explicar relações e decompor o que ainda precisa ser compreendido.
4. Para confrontar uma premissa, registrar o critério próprio antes da revelação do critério da IA; realizar o ensaio fora do aplicativo e registrar o observado.
5. Quando o resultado contrariar a expectativa, registrar falha e pedir replanejamento. Examinar o diagnóstico e as subpartes propostas; aceitar/rejeitar com atenção à evidência que justifica a revisão.
6. Opcionalmente importar ações para tarefas e acompanhar execução em Kanban/Scrum. Voltar da tarefa ao nó de origem quando seu plano e nó ainda existirem.

O ciclo de investigação e o acompanhamento de tarefas são relacionados por referências. Mudar uma tarefa para `done` não confirma um nó. Uma tarefa concluída pode descrever trabalho administrativo; um nó pode ser tomado como conhecido sem possuir observação física.

## Pipeline e fronteiras

| Camada | Responsabilidade |
| --- | --- |
| Entrada e shell | [Projects.tsx](../../src/workspace/Projects.tsx) apresenta projetos e formulários; [Workspace.tsx](../../src/workspace/Workspace.tsx) coordena superfícies, visão geral, navegação e retorno à origem das tarefas. |
| Modelo gerenciado | [workspace/types.ts](../../src/workspace/types.ts) define `ManagedProject`, `PlannerSnapshot`, `Task`, `Sprint`, `Note` e `Surface`; [workspace/store.ts](../../src/workspace/store.ts) oferece ações persistentes compartilhadas. |
| Ponte de ownership | [workspace/planner.ts](../../src/workspace/planner.ts) captura, lê, inicializa, abre e conecta o snapshot ao editor único de grafo. |
| Modelo do plano | [types.ts](../../src/types.ts) define `Project`, `ConceptNodeData`, arestas, referências, histórico e contratos de planos sugeridos; [store.ts](../../src/store.ts) controla estado, transições e regras do planner. |
| Helpers de árvore | [treeIndex.ts](../../src/graph/treeIndex.ts) ordena e indexa filhos por pai; [treeLayout.ts](../../src/graph/treeLayout.ts) calcula o layout inicial persistido e a grade de folhas. [autoLayout.ts](../../src/graph/autoLayout.ts) conserva o layout adaptativo ao viewport. São funções independentes da interface e do store. |
| Superfícies do plano | [ObjectiveScreen.tsx](../../src/components/ObjectiveScreen.tsx), [GraphCanvas.tsx](../../src/components/GraphCanvas.tsx), [DetailPanel.tsx](../../src/components/DetailPanel.tsx), [TutorMode.tsx](../../src/components/TutorMode.tsx) e [GroundTruth.tsx](../../src/components/GroundTruth.tsx). |
| Serviços de IA | [ai/service.ts](../../src/ai/service.ts), [ai/schemas.ts](../../src/ai/schemas.ts) e [ai/planStructure.ts](../../src/ai/planStructure.ts) geram e validam propostas; não substituem a evidência humana. |
| Acesso pelo chat | [ai/plannerTools.ts](../../src/ai/plannerTools.ts) lê/altera o plano pelo mesmo domínio, resguarda contexto e preserva as regras de confirmação. |
| Recursos adjacentes | [attachments](../../src/attachments/files.ts), [visuals](../../src/visuals/types.ts), [notas](./notes.md) e ferramentas de tarefas são integrações; cada uma conserva seu contrato próprio. |
| Aparência de projetos | [project-appearance](../../src/workspace/project-appearance/projectAppearance.ts) valida a personalização; ícones não pertencem ao modelo da árvore ou ao ciclo de evidência. |
| Tinta no mapa | [PlannerInkLayer.tsx](../../src/ink/PlannerInkLayer.tsx) adapta o motor compartilhado ao viewport do grafo; [canvasModel.ts](../../src/ink/canvasModel.ts) valida coordenadas e documentos. |

## Dois registros de projeto e um editor

`ManagedProject` é o contêiner do workspace: ID, nome, objetivo, datas, arquivo, aparência, anexos e `planner?`. `Project` é o documento de plano com nós, arestas, intenção, referências e recursos visuais. Os IDs possuem papéis diferentes; uma tarefa conserva tanto `projectId` do workspace quanto `sourcePlanId` do plano.

`PlannerSnapshot` seleciona os campos persistíveis do grafo: projeto atual, seleção/foco, lente, modo, painel, tutor, rascunhos, objetivo em elaboração, sugestões pendentes/estacionadas e estado arquivado. Não é uma cópia irrestrita de todos os campos do store.

A ponte em `workspace/planner.ts` mantém `ownerId`, identidade do projeto que atualmente possui o editor:

- `capturePlanner` lê o conjunto definido de campos do editor.
- `readPlanner(projectId)` lê o estado vivo quando o editor pertence ao projeto; nos demais casos lê seu snapshot. Não troca o editor para consultar outro projeto.
- `openPlanner(projectId)` salva o proprietário anterior e carrega o destino; limpa jobs/seleções transitórias apropriadas. Uma operação de IA ativa bloqueia a troca.
- `connectPlanner` observa alterações dos campos do snapshot e salva no projeto proprietário.
- `initializeWorkspace` importa uma vez dados legados de plano/rascunho, preserva estado arquivado, normaliza recursos visuais e remove marcadores de geração interrompida quando não há ação viva. Não refaz uma geração paga automaticamente.

Essa coordenação evita misturar projetos enquanto uma resposta assíncrona está em andamento. Não é colaboração simultânea entre várias pessoas ou resolução de conflito distribuído.

Os helpers de árvore foram extraídos de `store.ts` sem alterar o algoritmo. O store mantém reexports de compatibilidade de `childrenByParent`, `computeTreeLayout`, `isLeafGridParent` e constantes; consumidores novos podem importar dos módulos em `graph/` sem carregar o store. Essa extração organiza cálculo/índice, sem alterar a persistência do plano ou as regras de evidência.

## Geração, revisão e importação de tarefas

O rascunho de objetivo guarda alternativas, esboços, planos expandidos em cache e escolha atual. A abordagem explícita, como engenharia reversa ou criação nova, é diferente da estratégia de construção, como reaproveitar, híbrido ou do zero. Uma alteração de contexto relevante pode invalidar uma expansão em cache.

Decomposição e replanejamento preparam sugestões. O store mantém propostas pendentes/estacionadas e só as incorpora pelas ações correspondentes. Alterações estruturais pelo chat usam [planStructure.ts](../../src/ai/planStructure.ts) para preservar identidade, evidência, proveniência de anexos e undo, rejeitando ciclos e contexto desatualizado antes de aplicar um lote.

`importPlanTasks(projectId)` percorre o snapshot do projeto e importa somente nós `kind === 'passo'` que sejam folhas e não estejam descartados. Registra `sourceNodeId`/`sourcePlanId`, inicia a tarefa em `todo` e evita repetir a mesma origem. É uma importação explícita de conteúdo, não uma sincronização bidirecional de estados. Editar/decompor o plano depois não é descrito como atualização automática das tarefas já importadas.

## Tinta livre no mapa

A opção de desenhar abre uma paleta compacta sobre o canvas. Caneta, bico de pena, monoline, lápis e marca-texto compartilham geometria SVG e estilos com Board e notas. Régua restringe o traço a um segmento reto; borracha remove traços inteiros atingidos. Pressão e amostras coalescidas são aproveitadas quando o navegador as fornece.

O documento opcional `project.visuals.ink` contém versão e traços com identidade, posição no mundo, pontos locais, cor, espessura e estilo. O desenho acompanha o mesmo pan/zoom dos nós, mas não se torna nó, aresta, tarefa ou evidência. `canvasInkSchema` limita 2.000 traços, 4.096 pontos por traço e 100 mil pontos no conjunto, com coordenadas finitas e IDs únicos.

Um gesto concluído aplica uma operação de tinta; cancelamento e troca de contexto descartam a prévia. Desfazer/refazer mantém até 50 operações da sessão e preserva nós, artefatos e traços não envolvidos naquela operação. O histórico temporário não viaja no snapshot do projeto.

Quando habilitado, o [canal de tinta ao vivo](ink-live-sync.md) transmite o gesto no escopo `planner:<id>` cifrado com a sessão do cofre. A atualização canônica preserva o proprietário do editor e o plano local aberto; não abre o plano ativo do outro dispositivo. São prévias efêmeras e refresh com revisão CAS, sem CRDT, colaboração entre contas ou certificação de observações físicas.

## Contrato do ciclo de evidência

O método pretendido é **premissa → previsão/critério próprio → ensaio → observação → revisão justificada**. A implementação fornece registros e restrições para apoiá-lo, mas não instrumenta o mundo físico.

| Registro existente | Papel e limite |
| --- | --- |
| `comoConfirmar` | Critério proposto pela IA. Seu conteúdo não constitui uma observação. |
| `comoConfirmarUsuario`, `comoConfirmarUsuarioAt` | Critério comprometido pela pessoa, com momento do registro. Há regra de revelação e janela de desfazer; os campos não são uma certificação inviolável de protocolo experimental. |
| `comoConfirmarAtendido.observacao`, `at` | Relato de como a pessoa verificou atendimento do critério. Exige critério travado e observação não vazia. |
| `groundTruthRefs[]` | Âncoras de link/especificação/medida, com verificação e observação conforme o tipo/fluxo. Uma sugestão de referência ainda não é referência verificada. |
| `failureContext`, `failureReportedAt` | Relato de falha. Uma falha aberta bloqueia confirmação e invalida atestação anterior de atendimento. |
| Histórico e replanejamento | Registram transições e propostas; a revisão precisa ser interpretada em relação ao ensaio e à evidência real. |

`confirmNode` e os cálculos de conclusão/progresso em [store.ts](../../src/store.ts) distinguem avanço estrutural de suporte por evidência. Confirmar sem sinal suficiente pode marcar avanço assumido, não demonstrar atendimento físico. Tomar como conhecido, concluir tarefa, receber crítica de outra IA ou gerar um modelo 3D não substitui ensaio independente.

A ocultação do critério da IA também é respeitada nas leituras de chat e prompts antes do momento apropriado. Os testes impedem que ferramentas inventem o critério da pessoa ou contornem a regra de confirmação. Isso é evidência de comportamento do software, não de que os usuários sempre formulam bons critérios ou de que o método já é eficaz.

## Persistência e integrações

Projetos gerenciados e snapshots viajam no envelope `cellproject-workspace`, versão 2. O editor de grafo conserva sua persistência própria e a ponte faz a associação. O [repositório](../../src/data/workspaceRepository.ts) e o runtime configurado são responsáveis pelo armazenamento; [workspaceTransfer.ts](../../src/data/workspaceTransfer.ts) organiza backup/exportação. Estado visual válido deve sobreviver a inicializações ociosas sem regravação desnecessária.

Os serviços de IA usam a configuração compartilhada em [client.ts](../../src/ai/client.ts), schemas e cancelamento. Chamadas dependem do provedor/configuração e do transporte disponível; este documento não confirma conta, credencial, deploy ou sincronização remota. Anexos são fontes de requisitos e proveniência, não programas executáveis; arquivos não autorizam por si mesmos uma alteração.

Notas são vínculos opcionais; tarefas e sprints seguem suas regras no store do workspace. Dynamic Board permanece independente e não inicia planejamento automaticamente. O [Dairo](./chat-and-dairo.md) é uma direção futura; o chat atual usa ferramentas existentes e não é um coletor físico ou executor do robô.

## Evidência de software e limites

| Evidência existente | Contrato exercitado |
| --- | --- |
| [planner.test.ts](../../src/workspace/planner.test.ts) | Migração de rascunhos, proprietário, troca bloqueada durante IA, importação uma vez, preservação de drafts/modelos e ausência de confirmação automática ao concluir tarefa. |
| [Projects.test.tsx](../../src/workspace/Projects.test.tsx), [Projects.appearance.test.tsx](../../src/workspace/Projects.appearance.test.tsx) | Criação/reabertura, objetivo sem nome separado, estudo do robô revisado antes de criar, bloqueio durante IA e personalização por projeto. |
| [workspace/store.test.ts](../../src/workspace/store.test.ts) | Isolamento por projeto, arquivo sem exclusão, persistência, referências de tarefa/nota, sprints e falhas de salvamento. |
| [plannerTools.test.ts](../../src/ai/plannerTools.test.ts), [planStructure.test.ts](../../src/ai/planStructure.test.ts) | Leitura de outro plano sem trocar editor, critério oculto, preservação de regras/evidência, contexto desatualizado, lote atômico e undo protegido de edições posteriores. |
| [store.test.ts](../../src/store.test.ts), [store.fixes.test.ts](../../src/store.fixes.test.ts), [evidenceProgress.test.ts](../../src/graph/evidenceProgress.test.ts) | Transições do grafo e distinção entre progresso, conhecimento assumido e evidência. |
| [GroundTruth.test.tsx](../../src/components/GroundTruth.test.tsx), [TutorMode.test.tsx](../../src/components/TutorMode.test.tsx), [service.test.ts](../../src/ai/service.test.ts) | Interface de critério/falha, prompts, decomposição/replanejamento, regras de revelação e erros/cancelamento. |
| [PlannerInkLayer.test.tsx](../../src/ink/PlannerInkLayer.test.tsx), [canvasModel.test.ts](../../src/ink/canvasModel.test.ts) | Gestos, limites, cancelamento por contexto, borracha, histórico e tinta isolada da topologia do plano. |

Esta revisão descreveu fontes e testes; não realizou nova avaliação com pessoas ou hardware. Respostas controladas e execução do SDK em testes não demonstram qualidade factual de toda geração. A existência de campos temporais/histórico não prova a fidelidade de um relato ou o funcionamento do robô.

## Lacunas e diagnóstico de modularização

A ponte de snapshots já é uma fronteira explícita e deve ser preservada. O ponto de maior acoplamento é [store.ts](../../src/store.ts): persistência, grafos, sugestões, critérios, falhas e métricas estão reunidos. `GroundTruth.tsx` também reúne critérios, âncoras, crítica e replanejamento; extrair toda essa superfície de uma vez elevaria o risco de alterar as regras da pesquisa.

Uma extração pequena candidata é um módulo puro de políticas de evidência/conclusão hoje expostas por `canRevealAICriterionNow`, `canConcludeNode`, `projectProgress` e `projectEvidenceProgress`. As funções e seus testes de transição/progresso oferecem uma fronteira concreta, conservando ações e persistência nos stores. É recomendação de revisão; nenhuma extração foi implementada aqui.

Lacunas: protocolo de coleta/avaliação independente, operacionalização explícita de premissas e revisões para análise científica, sincronização contínua entre tarefa e nó, integração física e evidência de generalização. O aplicativo registra partes do ciclo em campos existentes; não deve ser apresentado como tendo um novo schema experimental completo de ensaios que não foi entregue.

## Perguntas e evidências possíveis para artigos

| Pergunta candidata | Evidência necessária |
| --- | --- |
| O fluxo estruturado ajuda a detectar premissas erradas de planos de IA? | Tarefas equivalentes, mesmo LLM, condição de chat comum, erros previamente caracterizados e julgamento independente das detecções. |
| Critério anterior ao ensaio se relaciona a revisões melhor justificadas? | Critério com momento, previsão, protocolo do ensaio, observação bruta e vínculo explícito entre resultado e revisão. |
| A estrutura reduz confusão entre concluir uma ação e validar uma premissa? | Estados de tarefas e nós, episódios de confirmação assumida, evidências usadas e entrevistas/avaliação independente. |
| Há transferência de aprendizagem? | Desempenho numa tarefa equivalente posterior sem assistência de IA, além do desempenho durante o uso. |

Um caso N=1 do robô de dois braços pode documentar viabilidade e dificuldades. Só os ensaios efetivamente realizados e observados devem entrar como resultados. O [objetivo aprovado](../OBJETIVO_DO_ARTIGO.md) não presume eficácia geral, novidade científica ou construção concluída.

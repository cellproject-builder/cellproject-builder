# Chat integrado e direção Dairo

Visão canônica do módulo, conferida no código em 10/10/2026. O **chat integrado está implementado**. O **Dairo permanece uma direção de produto**, registrada em [dairo-direction.md](../dairo-direction.md), sem runtime específico identificado em `src`/`server` nesta revisão. Não se deve renomear o `workspaceAgent` existente como prova de entrega do Dairo.

## Finalidade e estado

O chat permite conversar sobre o workspace e executar ações disponíveis por ferramentas validadas. Sua unidade de execução é um turno iniciado pela pessoa. O Dairo propõe uma relação cotidiana com notas/projetos e memória duradoura; essa proposta vai além da persistência atual de conversas.

| Estado | Capacidade |
| --- | --- |
| Implementado | Chat com streaming, cancelamento, histórico de conversas persistido, troca/arquivo de sessões, erros de carga/salvamento e cooldown do provedor. |
| Implementado | Referências `@` selecionadas pela pessoa, anexos, auditoria de ações, acesso ao workspace/planner e busca visual pelo agente integrado. |
| Implementado | Instância `dynamic-diary-workspace` de `ToolLoopAgent` por execução, ferramentas com fila e cancelamento compartilhados. |
| Experimental no sentido de uso | Classificação TypeSafe de intenção e avaliações documentais de referências orientam o fluxo. Confiança do modelo não valida fatos, compatibilidade física ou autorização. |
| Planejado — Dairo | Memórias duradouras automáticas com origem visível, edição/exclusão e separação das notas comuns; o documento de direção também menciona resumos diários. |
| Não identificado como runtime entregue | Cron de resumo, extração automática de memórias, coleção específica de memórias Dairo, execução recorrente em segundo plano e um módulo de “fronts/frentes”. |

Histórico do chat pode ser reutilizado em novos turnos. Isso não é equivalente a memória duradoura selecionada/segregada, resumo diário automático ou agente proativo.

## Fluxo da pessoa

1. Abrir o chat no workspace, escrever o pedido e opcionalmente selecionar fontes com `@` ou anexar arquivos. Escolher uma referência não envia mensagem por si só.
2. Enviar. O store congela snapshots das fontes selecionadas, verifica escopo/fingerprint e cria as mensagens de pessoa e assistente.
3. O agente lê registros atuais e chama ferramentas quando necessário. A interface recebe texto incremental e eventos `running`, `done`, `error` ou `awaiting_approval`.
4. Examinar as alterações/auditoria. Resultados visuais que precisam de aprovação continuam como proposta; imagens buscadas aparecem em carrossel para escolha explícita.
5. Cancelar quando necessário. Ações já concluídas continuam aplicadas; cancelar não é desfazer. Um lote estrutural pode oferecer seu undo específico.
6. Reabrir/trocar conversa ou recarregar. Turnos interrompidos preservam pedido e auditoria, sem retomar automaticamente a mutação.

No desktop o chat pode ocupar um dock; em tela estreita usa diálogo com gestão de foco. O shell suspende o chat na superfície de Dynamic Board e durante maximização relevante. A IA do quadro usa seu [compositor próprio](./dynamic-board.md), não o chat geral.

O compositor reserva toda a largura para o pedido, mostra fontes selecionadas acima do texto e alinha anexar/`@` à esquerda e enviar/parar à direita. No celular, essas ações têm alvos de 44 px. O foco do texto é indicado pela borda arredondada do conjunto, sem um segundo retângulo interno; botões mantêm indicação de foco para navegação por teclado. A orientação sobre anexos e referências continua disponível aos leitores de tela.

## Pipeline e fronteiras

| Etapa | Responsável |
| --- | --- |
| Interface e composição | [AssistantChat.tsx](../../src/chat/AssistantChat.tsx), [ChatComposer.tsx](../../src/chat/ChatComposer.tsx), [AssistantChatDock.tsx](../../src/chat/AssistantChatDock.tsx), [ChatPlanChanges.tsx](../../src/chat/ChatPlanChanges.tsx) e [ChatImageCarousel.tsx](../../src/chat/ChatImageCarousel.tsx). |
| Sessão e persistência | [chat/store.ts](../../src/chat/store.ts) guarda mensagens, histórico do modelo, sessões, cooldown e estado de interrupção; coordena o envio. |
| Fontes explícitas | [chat/references.ts](../../src/chat/references.ts) lista metadados, valida escopo/fingerprint e congela trechos; anexos usam [attachments/files.ts](../../src/attachments/files.ts). |
| Classificação auxiliar | [ai/planIntake.ts](../../src/ai/planIntake.ts) classifica o pedido contextualizado para roteamento, sem autorizar alterações. |
| Adaptador de streaming | [ai/assistant.ts](../../src/ai/assistant.ts) adapta o SDK ao texto acumulado/eventos e devolve mensagens estruturadas para o histórico. |
| Runtime do agente entregue | [ai/agents/workspaceAgent.ts](../../src/ai/agents/workspaceAgent.ts) monta instruções, contexto, modelo, ferramentas, limite e cancelamento de cada execução. |
| Ferramentas | [workspaceTools.ts](../../src/ai/workspaceTools.ts), [plannerTools.ts](../../src/ai/plannerTools.ts) e [visualTools.ts](../../src/ai/visualTools.ts) leem/mutam pelos contratos existentes. |
| Provedor e transporte | [client.ts](../../src/ai/client.ts), [transport.ts](../../src/ai/transport.ts), [service.ts](../../src/ai/service.ts) e [rateLimit.ts](../../src/ai/rateLimit.ts) configuram chamadas e classificam falhas. |

O [documento do motor de agentes](../ai-agents.md) detalha a migração para o SDK; este módulo reúne a relação com interface, dados e Dairo. A existência de um caminho de transporte cloud não confirma uma conexão ativa, conta autenticada ou implantação.

## Contratos de execução

Cada turno cria uma instância de `ToolLoopAgent` com ID `dynamic-diary-workspace`. O runtime possui até 16 passos e intervalo mínimo de 1.500 ms entre requisições controladas. `maxRetries: 0` evita repetição automática; o mesmo `AbortSignal` alcança stream, fila, espera e trabalho do planner.

`runAssistant` consome `fullStream`, entrega texto e propaga erros originais. Uma resposta parcial seguida de erro não deve ser relatada como sucesso. Limite do provedor interrompe o loop/fila; o store mantém cooldown por `provider:mainModel` e respeita o atraso recebido quando disponível.

`createAssistantTools` serializa chamadas, mesmo se o modelo as propuser em paralelo. As ações usam stores reais e aguardam persistência. Quando algo foi aplicado mas salvar falhou, o resultado inclui `{ applied: true, saved: false, ... }` e a auditoria indica erro. Essa distinção evita repetir uma mutação visível apenas porque seu salvamento falhou.

| Ferramenta/superfície | Escopo atual |
| --- | --- |
| `workspace_read` | Projetos, tarefas, sprints, notas, pastas e comentários, com paginação/filtros e resumos. Não expõe credenciais nem snapshots inteiros do planner. |
| `workspace_action` | CRUD suportado, vínculos, importação de tarefas, sprints, comentários, navegação e preferências. Schemas estritos recusam campos/ações desconhecidos. |
| Ferramentas do planner | Leitura, rascunhos, geração, revisão/decomposição e estrutura preservando identidade/regras do plano; não inventam critério humano ou evidência. |
| `visual_action` | Busca e preparação de artefatos no contexto de projeto. Buscar não insere automaticamente; propostas de geração respeitam o fluxo de aprovação. |
| Ausências relevantes | `boards` não aparece nos schemas de leitura/ação/navegação gerais; ferramentas de nota não oferecem edição arbitrária de `canvas`; não há ferramenta de memória Dairo ou execução de programas anexados. |

Instruções do agente pedem ler antes de alterar e tratar notas, comentários, fontes e resultados como dados não confiáveis. Essa política orienta o modelo; não equivale a um verificador formal que prova a autorização de toda mutação. A validação de argumentos e as regras do domínio são barreiras técnicas separadas.

## Contexto, referências e anexos

O contexto inicial inclui o projeto explícito do chat, superfície, data e metadados de até 30 projetos. Ele não inclui automaticamente o corpo de todas as notas. O projeto do chat pode diferir do editor visível; `readPlanner` permite consultar outro snapshot sem trocá-lo.

Referências `@` podem ser notas pessoais, notas do projeto, nós, imagens do plano e anexos do projeto. A lista mostra metadados; o envio congela até 20 fontes, com até 8.000 caracteres por fonte e 48.000 no total. Fonte removida, alterada, duplicada ou de projeto incompatível é recusada antes de iniciar o turno. Os snapshots são históricos; atualizar exige ler o registro atual.

Os campos dos nós usam allowlist e ocultam o critério da IA antes da regra de revelação. Uma referência de imagem leva proveniência textual, não pixels. Uma referência de nota leva título/blocos. Já `workspace_read` pode devolver resumo limitado do caderno por [noteCanvasSummary.ts](../../src/workspace/noteCanvasSummary.ts); são leituras diferentes.

Arquivos enviados no chat são validados e, havendo projeto, persistidos como anexos antes do uso. Trechos de arquivo entram como dados de fonte, separados da instrução humana. Um envio só com anexos usa uma instrução de explicar sua contribuição e pedir intenção antes de alterar o plano. Nenhuma ferramenta executa código carregado.

Os fluxos visuais têm suas próprias regras de seleção/pixels; a ausência de pixels num snapshot do chat não prova ausência de análise num pedido visual posterior. O resultado desse pedido indica o modo realmente usado. Foto, relevância textual ou confiança TypeSafe não comprovam dimensões, segurança ou compatibilidade física.

## Sessões e persistência

`ChatMessage` contém ID, papel, texto, data, eventos de ação, indicação de interrupção, referências, arquivos e classificação opcional. `ChatSession` contém `sessionId`, `messages` e `modelHistory: ModelMessage[]`.

O store persiste na chave `dynamic_diary-chat`, versão 1: sessão atual, histórico estruturado, histórico pendente, sessões arquivadas e cooldowns. Abertura do painel, execução e erros transitórios não são retomados como requisição viva. O [repositório selecionado](../../src/data/workspaceRepository.ts) e o runtime configurado compartilham a infraestrutura de persistência, mas o chat mantém fila/controle de erros próprios.

O histórico enviado ao modelo retém até os últimos 20 inícios de turnos de pessoa; isso não significa que toda a conversa arquivada seja enviada. `pendingHistory` permite reconhecer uma interrupção por recarga e acrescentar auditoria ao contexto recuperado. A recuperação recomenda reler registros antes de repetir alterações; não é rollback automático ou transação distribuída.

Falha de leitura impede sobrescrever uma conversa ilegível; falha de salvamento é mostrada e pode ser tentada novamente. A permanência de dados em memória não deve ser confundida com gravação confirmada.

## Fronteira entre chat atual e Dairo

A decisão de produto em [dairo-direction.md](../dairo-direction.md) pede memórias automáticas sobre preferências, decisões e compromissos, com origem acessível, edição e exclusão. Elas devem ser separadas das notas comuns. O texto afirma expressamente que a proposta está em refinamento e não declara o agente implementado.

Não foi encontrado um subsistema runtime Dairo em `src`/`server` que forneça extração, deduplicação, armazenamento segregado, revisão/exclusão ou execução agendada dessas memórias. Também não há evidência local para afirmar cron de resumo, diário resumido automaticamente, “fronts/frentes” ou rotina autônoma entregue. Não basta usar a palavra agente ou salvar `modelHistory` para satisfazer esses contratos.

Uma implementação futura precisaria definir unidade da memória, vínculo com a fonte, atualização após edição/exclusão da origem, política de conflito, retenção e consentimento operacional. Esses são requisitos candidatos derivados da direção, não novos contratos já aprovados/implementados neste módulo.

## Evidência de software e limites

| Testes existentes | O que examinam |
| --- | --- |
| [assistant.test.ts](../../src/ai/assistant.test.ts), [workspaceAgent.test.ts](../../src/ai/agents/workspaceAgent.test.ts) | SDK real com modelo simulado, ferramentas, streaming, histórico, escopo, 16 passos, espaçamento, cancelamento e erro parcial. Não são chamadas pagas ao provedor real. |
| [workspaceTools.test.ts](../../src/ai/workspaceTools.test.ts), [plannerTools.test.ts](../../src/ai/plannerTools.test.ts), [visualTools.test.ts](../../src/ai/visualTools.test.ts) | Stores compartilhados, schemas, contexto, resumo sem pixels, fila/persistência, regras de plano e proposta aguardando aprovação. |
| [store.test.ts](../../src/chat/store.test.ts) | Persistência, sessões, interrupção, auditoria, cooldown, falha de salvar/carregar, arquivos e snapshots. |
| [references.test.ts](../../src/chat/references.test.ts) | Fontes pessoais/projeto, anexos, critério oculto, seleção desatualizada e proveniência sem pixels. |
| [AssistantChat.test.tsx](../../src/chat/AssistantChat.test.tsx), [ChatImageCarousel.test.tsx](../../src/chat/ChatImageCarousel.test.tsx) | Responsividade, foco/teclado, IME, rascunhos, handoff, escolhas explícitas e bloqueio de resultados históricos de outro plano. |

Esta revisão não executou chamadas externas ou estudo com pessoas. Cobertura de contratos não demonstra obediência perfeita do modelo, sucesso remoto de todos os fluxos, qualidade de resposta ou eficácia do futuro Dairo.

## Lacunas e diagnóstico de modularização

A separação `interface → store → adaptador → agente → ferramentas → domínio` já está explícita. O maior ponto de coordenação é `chat/store.ts`: seleção de fontes, persistência de arquivos, classificação, streaming, auditoria e recuperação aparecem em `sendChatMessage`. Uma extração pequena candidata é a preparação imutável de um turno, com snapshots/fontes/classificação claramente separados da aplicação/streaming. Devem permanecer no store as transições de sessão e persistência, com os testes atuais como proteção. Nenhuma extração foi implementada aqui.

Há também uma inconsistência documental em runtime: o prompt de `workspaceAgent.ts` afirma que cloud synchronization não está conectado, enquanto os stores possuem caminhos condicionais de cloud runtime. O texto não é um diagnóstico vivo de conectividade. Uma revisão futura do contexto de capacidades poderia usar o estado real e conservar os limites de permissão; esta revisão apenas registra a divergência.

## Perguntas e evidências possíveis para artigos

| Pergunta candidata | Evidência necessária |
| --- | --- |
| Ferramentas validadas e auditoria tornam alterações de plano mais verificáveis? | Pedidos, chamadas, argumentos, estado antes/depois, resultado de persistência e revisão independente de correção. |
| Fontes selecionadas ajudam a corrigir premissas sem misturar projetos? | Fontes autorizadas, tentativas de escopo errado, decisões do agente e revisões justificadas por evidências. |
| O fluxo estruturado supera chat comum no caso de estudo? | Mesmo LLM e tarefas equivalentes, critérios definidos antes do ensaio e avaliação independente, conforme [objetivo do artigo](../OBJETIVO_DO_ARTIGO.md). |
| Futuras memórias Dairo preservam proveniência e controle humano? | Somente após implementar: fonte por memória, edições/exclusões, conflitos, erros de extração e avaliação de utilidade sem inferir eficácia antecipadamente. |

O agente atual é suporte operacional à investigação e organização. Não controla o robô nem verifica automaticamente a realidade física. Resultados de pesquisa precisam distinguir o que foi solicitado, proposto, aplicado, salvo e efetivamente observado.

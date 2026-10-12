# Chat integrado e direção Dairo

Visão canônica do módulo, conferida no código em 11/10/2026. O **chat integrado está implementado**. O **Dairo permanece uma direção de produto**, registrada em [dairo-direction.md](../dairo-direction.md), sem runtime específico identificado em `src`/`server` nesta revisão. Não se deve renomear o `workspaceAgent` existente como prova de entrega do Dairo.

## Finalidade e estado

O chat permite conversar sobre o workspace e executar ações disponíveis por ferramentas validadas. Sua unidade de execução é um turno iniciado pela pessoa. O Dairo propõe uma relação cotidiana com notas/projetos e memória duradoura; essa proposta vai além da persistência atual de conversas.

| Estado | Capacidade |
| --- | --- |
| Implementado | Chat com streaming, cancelamento, popup/dock e modo expandido com a mesma conversa, histórico pesquisável por título, renomear/arquivar/restaurar/excluir, erros de carga/salvamento e cooldown do provedor. |
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

No mapa do Construtor de Planos, a entrada fica centralizada na parte inferior do próprio canvas. Clique ou `Ctrl/⌘ + Shift + Espaço` abre a conversa sobre o mapa, sem bloquear sua navegação; recolher conserva o rascunho. A seta do cabeçalho alterna entre a apresentação central e uma coluna à direita, dentro da área útil do canvas. A troca reutiliza o mesmo painel e compositor, preservando sessão, rascunho, referências, histórico e operação em andamento. A conversa acompanha o teclado móvel e continua acessível no canvas maximizado. No desktop, o inspetor pode permanecer aberto; no celular ele se recolhe enquanto o chat está aberto. O enquadramento de um nó considera a área ocupada pela conversa.

O atalho pode ser arrastado com mouse, dedo ou caneta: soltar nos últimos 64 pixels da área útil o encaixa na borda direita, junto a Detalhes, e faz a próxima abertura usar a apresentação lateral; arrastar para fora dessa faixa devolve a entrada e a abertura ao centro inferior. O movimento precisa superar 8 pixels e não abre o chat nem move/desenha no plano. Em canvas maximizado, o atalho usa um ícone vazado na borda interna; maximizar o canvas conserva a preferência central/lateral da conversa e, ao sair, restaura a entrada anterior. A preferência é efêmera da interface, sem gravar documentos ou sincronizar a posição entre aparelhos.

Nas outras telas, o popup continua disponível, com diálogo e gestão de foco em telas estreitas. O ícone Chat da barra lateral e o botão Expandir abrem a mesma instância numa área dedicada, conservando sessão, rascunho, referências e tela de origem. Recolher retorna ao editor, que permanece montado. O contexto explicita essa origem no modo expandido. O chat também está disponível no Dynamic Board; seu [compositor próprio](./dynamic-board.md) continua responsável pela geração específica de objetos. Maximizações de Board e notas seguem suas próprias regras de ocultação.

O histórico separa recentes de arquivadas, permite renomear e exige confirmação para excluir. Arquivo é reversível; uma conversa arquivada precisa ser restaurada antes de enviar ou executar ações de seus resultados. A exclusão retira o conteúdo e mantém um recibo mínimo para impedir reaparecimento na conciliação. A interface carrega inicialmente as 60 mensagens mais recentes e oferece as anteriores sob demanda; o transcript persistido continua integral.

O compositor mostra fontes selecionadas acima do texto e alinha anexar/`@` à esquerda e enviar/parar à direita. Na coluna lateral, o pedido ocupa uma linha própria; a apresentação central pode alinhar o pedido aos controles. O cabeçalho separa conversa e apresentação em dois grupos suaves, com símbolos de 15–16 px, alvos de 40 px no desktop e 44 px no celular. O contexto é recolhível: origem curta sempre acessível; origem completa, modelo e uso estimado aparecem ao abrir. O foco do texto é indicado pela borda arredondada do conjunto; botões e disclosure mantêm indicação por teclado. A orientação sobre anexos e referências continua disponível aos leitores de tela. Superfícies em camadas, cantos arredondados e sombras discretas criam profundidade, sem blur pesado nem pulsação contínua sobre o canvas.

A organização das ações, os símbolos monocromáticos sem bordas individuais e a separação entre controles e conteúdo se inspiram em [Toolbars — Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/toolbars) e [Materials — Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/materials), consultadas em 11/10/2026 ([Toolbars em JSON](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/toolbars.json), [Materials em JSON](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json)). A orientação de Materials atualizada para Liquid Glass recomenda parcimônia nos efeitos e prioridade à legibilidade. A implementação adapta esses princípios em React/CSS e não utiliza componentes nativos de iOS ou o material Liquid Glass.

Consultas consecutivas concluídas da mesma ferramenta/ação formam um grupo compacto; cada evento original continua acessível ao expandir sua auditoria. Erros, gravações e propostas aguardando aprovação não são agrupados com essas consultas. Ao terminar sem pendências, a auditoria recolhe; a resposta permanece visível fora dela. Contagem de ações concluídas representa execução de ferramentas, não uma garantia de que a resposta à pessoa foi concluída.

## Pipeline e fronteiras

| Etapa | Responsável |
| --- | --- |
| Interface e composição | [AssistantChat.tsx](../../src/chat/AssistantChat.tsx), [ChatComposer.tsx](../../src/chat/ChatComposer.tsx), [CanvasChatEntry.tsx](../../src/chat/CanvasChatEntry.tsx), [presentation.ts](../../src/chat/presentation.ts), [AssistantChatDock.tsx](../../src/chat/AssistantChatDock.tsx), [ChatPlanChanges.tsx](../../src/chat/ChatPlanChanges.tsx) e [ChatImageCarousel.tsx](../../src/chat/ChatImageCarousel.tsx). |
| Sessão e persistência | [chat/store.ts](../../src/chat/store.ts) guarda mensagens, histórico do modelo, sessões, cooldown e estado de interrupção; coordena o envio. |
| Contexto e histórico | [turnContext.ts](../../src/chat/turnContext.ts) captura o foco real; [sessionHistory.ts](../../src/chat/sessionHistory.ts) normaliza metadados e exclusões; [ChatHistory.tsx](../../src/chat/ChatHistory.tsx) oferece navegação. |
| Continuidade | [contextBudget.ts](../../src/chat/contextBudget.ts) prepara o orçamento, [stepContext.ts](../../src/chat/stepContext.ts) mantém o contexto ativo entre passos e [chatCompaction.ts](../../src/ai/chatCompaction.ts) produz o resumo sem ferramentas. Ver [estratégia, SDK e fontes do Codex](../design/chat-context-strategy.md). |
| Fontes explícitas | [chat/references.ts](../../src/chat/references.ts) lista metadados, valida escopo/fingerprint e congela trechos; anexos usam [attachments/files.ts](../../src/attachments/files.ts). |
| Classificação auxiliar | [ai/planIntake.ts](../../src/ai/planIntake.ts) classifica o pedido contextualizado para roteamento, sem autorizar alterações. |
| Adaptador de streaming | [ai/assistant.ts](../../src/ai/assistant.ts) adapta o SDK ao texto acumulado/eventos e devolve mensagens estruturadas para o histórico. |
| Runtime do agente entregue | [ai/agents/workspaceAgent.ts](../../src/ai/agents/workspaceAgent.ts) monta instruções, contexto, modelo, ferramentas, limite e cancelamento de cada execução. |
| Ferramentas | [workspaceTools.ts](../../src/ai/workspaceTools.ts), [plannerTools.ts](../../src/ai/plannerTools.ts) e [visualTools.ts](../../src/ai/visualTools.ts) leem/mutam pelos contratos existentes. |
| Provedor e transporte | [client.ts](../../src/ai/client.ts), [transport.ts](../../src/ai/transport.ts), [service.ts](../../src/ai/service.ts) e [rateLimit.ts](../../src/ai/rateLimit.ts) configuram chamadas e classificam falhas. |

O [documento do motor de agentes](../ai-agents.md) detalha a migração para o SDK; este módulo reúne a relação com interface, dados e Dairo. A existência de um caminho de transporte cloud não confirma uma conexão ativa, conta autenticada ou implantação.

## Contratos de execução

Cada turno cria uma instância de `ToolLoopAgent` com ID `dynamic-diary-workspace`. O runtime possui até 16 passos, incluindo uma síntese final sem ferramentas, e intervalo mínimo de 1.500 ms entre requisições controladas. O 16º passo é reservado para essa síntese; três leituras consecutivas com argumentos e resultados idênticos também podem antecipá-la. Isso evita encerrar o limite apenas com consultas. `maxRetries: 0` evita repetição automática; o mesmo `AbortSignal` alcança stream, fila, espera e trabalho do planner.

A execução começa somente com leitura do workspace, leitura do plano e descoberta de capacidades. [chatCapabilities.ts](../../src/ai/chatCapabilities.ts) habilita famílias de ferramentas sob demanda por `activeTools`, sem fazer conversas comuns carregarem todos os schemas de mutação. As famílias não alteram autorização, alvo ou aprovação humana; seu estado não vaza para outro turno. O prompt continua ligando objetivo, premissa, investigação, artefatos, evidência e revisão do plano.

`runAssistant` consome `fullStream`, entrega texto e propaga erros originais. A conclusão precisa conter texto no último passo, sem ferramenta pendente nem término por limite, filtro ou erro. O texto final substitui frases intermediárias de progresso na mensagem visual, enquanto o histórico do SDK mantém a sequência completa. Se a conclusão faltar, `ChatFinalAnswerError` conserva mensagens, contexto ativo e uso; o store exibe aviso honesto, preserva ações realizadas e permite continuação manual. Retorno vazio ou só com espaços também é recusado como sucesso. Nenhuma tentativa extra é disparada automaticamente. Uma resposta parcial seguida de erro não deve ser relatada como sucesso. Limite do provedor interrompe o loop/fila; o store mantém cooldown por `provider:mainModel` e respeita o atraso recebido quando disponível.

`createAssistantTools` serializa chamadas, mesmo se o modelo as propuser em paralelo. As ações usam stores reais e aguardam persistência. Quando algo foi aplicado mas salvar falhou, o resultado inclui `{ applied: true, saved: false, ... }` e a auditoria indica erro. Essa distinção evita repetir uma mutação visível apenas porque seu salvamento falhou.

O envio captura um baseline privado do plano em [plannerEditBaseline.ts](../../src/ai/plannerEditBaseline.ts), separado do prompt e do histórico. Mudanças manuais durante a preparação ou chamada da IA invalidam escritas atrasadas; substituir o plano exige novo pedido. Leituras parciais não liberam irmãos não relidos nem campos omitidos por um resumo. Um nó alterado precisa de detalhe completo para recuperar seu token; se esse detalhe continuar truncado, a IA pede novo envio em vez de repetir a mutação. Rascunhos ainda não confirmados no inspetor têm propriedade efêmera em [plannerEdits.ts](../../src/chat/plannerEdits.ts) e bloqueiam mutações da conversa até serem concluídos ou cancelados. Explicação, crítica e decomposição verificam novamente identidade, revisão e dono do editor após o provedor responder.

Recibos de lotes estruturais conservam os estados salvo/desfeito ao mudar a apresentação. Resultados visuais históricos em [ChatVisualActions.tsx](../../src/chat/ChatVisualActions.tsx) reutilizam parsing e comparação de contexto enquanto se digita ou outra resposta é transmitida; alterações reais do plano/fontes e a liberação temporal de critérios invalidam a comparação. A [bateria de conversa e plano](../reports/planner-conversation-2026-10-11.md) registra os cenários e limites desta rodada.

| Ferramenta/superfície | Escopo atual |
| --- | --- |
| `workspace_read` | Projetos, tarefas, sprints, notas, pastas, comentários e boards, com paginação/filtros e resumos. Não expõe credenciais, pontos de desenho, pixels, geometrias ou snapshots inteiros do planner. |
| `planner_read` / `enable_capabilities` | Leitura pública paginada com modos explícitos `overview`, `node` e `text`, IDs separados de projeto/plano e revisão; descoberta das famílias workspace, plan, visual e note. A descoberta não executa mutações. |
| `workspace_action` | CRUD suportado, vínculos, importação de tarefas, sprints, comentários, navegação e preferências. Schemas estritos recusam campos/ações desconhecidos. |
| Ferramentas do planner | Leitura, rascunhos, geração, revisão/decomposição e estrutura preservando identidade/regras do plano; não inventam critério humano ou evidência. |
| `visual_action` | Busca e preparação de artefatos no contexto de projeto. Buscar não insere automaticamente; propostas de geração respeitam o fluxo de aprovação. |
| Ausências relevantes | Leitura/navegação de boards não equivale a edição arbitrária dos seus objetos. Ferramentas de nota não oferecem edição arbitrária de `canvas`; não há ferramenta de memória Dairo ou execução de programas anexados. |

Instruções do agente pedem ler antes de alterar e tratar notas, comentários, fontes e resultados como dados não confiáveis. Essa política orienta o modelo; não equivale a um verificador formal que prova a autorização de toda mutação. A validação de argumentos e as regras do domínio são barreiras técnicas separadas.

Leituras do workspace retornam páginas de até 20 registros e texto limitado, indicando `truncatedFields`. O original pode ser recuperado por ID/campo em partes de até 4.000 caracteres. [workspaceReadCoverage.ts](../../src/ai/workspaceReadCoverage.ts) impede substituir uma fonte existente por uma leitura parcial, também entre turnos e em outra tela: precisa de cobertura completa da versão atual, preservando append, metadados e texto novo literal da pessoa. A captura da escrita própria ocorre antes de aguardar salvamento, preservando o conflito se houver uma edição externa nessa espera.

## Contexto, referências e anexos

Cada envio congela tela, modo popup/expandido, projeto visível, plano, nó selecionado, nota, board, lente, data e um trecho público de até 1.200 caracteres. Diário pessoal, lista de projetos e boards não herdam o projeto da tela anterior. A nota selecionada respeita a visão efetivamente aberta, incluindo celular. Não são enviados automaticamente todos os projetos ou corpos de notas; ferramentas descobrem os registros relevantes. `readPlanner` permite consultar outro snapshot sem trocar o editor.

Referências `@` podem ser projetos, boards, notas, nós, imagens, diagramas, modelos 3D e anexos, inclusive de outros projetos. A lista mostra metadados e origem; o envio congela até 20 fontes, com até 8.000 caracteres por fonte e 48.000 no total. Fonte removida, alterada ou duplicada é recusada antes de iniciar o turno. Cada origem usa IDs e fingerprint próprios; escolher outra origem não muda silenciosamente o projeto alvo. Os snapshots são históricos; atualizar exige ler o registro atual. Artefatos contribuem com descrições e resumos textuais, sem carregar suas geometrias ou pixels.

Os campos dos nós usam allowlist e ocultam o critério da IA antes da regra de revelação. `planner_read` informa `hiddenCriterionNodeIds` apenas para os nós retornados ou para a leitura textual desse critério, distinguindo ocultação de ausência sem expor conteúdo, tamanho ou fragmentos. O critério humano continua separado. Uma referência de imagem leva proveniência textual, não pixels. Uma referência de nota leva título/blocos. Já `workspace_read` pode devolver resumo limitado do caderno por [noteCanvasSummary.ts](../../src/workspace/noteCanvasSummary.ts); são leituras diferentes.

Arquivos enviados no chat são validados e, havendo projeto, persistidos como anexos antes do uso. Trechos de arquivo entram como dados de fonte, separados da instrução humana. Um envio só com anexos usa uma instrução de explicar sua contribuição e pedir intenção antes de alterar o plano. Nenhuma ferramenta executa código carregado.

Os fluxos visuais têm suas próprias regras de seleção/pixels; a ausência de pixels num snapshot do chat não prova ausência de análise num pedido visual posterior. O resultado desse pedido indica o modo realmente usado. Foto, relevância textual ou confiança TypeSafe não comprovam dimensões, segurança ou compatibilidade física.

## Sessões e persistência

`ChatMessage` contém ID, papel, texto, data, contexto congelado, eventos de ação, indicação de interrupção, referências, arquivos e classificação opcional. `ChatSession` mantém identidade estável, título, datas, estado de arquivo/exclusão, mensagens, histórico ativo do modelo e checkpoint de compactação.

O store persiste na chave `dynamic_diary-chat`, versão 1: sessão atual, histórico estruturado, histórico pendente, sessões arquivadas e cooldowns. Abertura do painel, execução e erros transitórios não são retomados como requisição viva. O [repositório selecionado](../../src/data/workspaceRepository.ts) e o runtime configurado compartilham a infraestrutura de persistência, mas o chat mantém fila/controle de erros próprios.

O transcript visual e o contexto ativo do modelo são separados. Aos 60% do orçamento, o histórico é resumido incrementalmente: no preflight preserva dois turnos recentes; durante a execução preserva exatamente o pedido atual e a última troca completa de ferramentas. A troca só ocorre com resumo válido e menor; falha ou cancelamento conserva a entrada anterior. O SDK 6 recompõe respostas acumuladas a cada passo, por isso o agente reaplica o contexto compacto com apenas novas respostas, evitando ressuscitar leituras antigas. O indicador acompanha as estimativas antes e depois dessa organização.

O uso é estimado, com observação do último input do provedor quando disponível, sem somar todas as requisições. Sem janela verificada no catálogo, usa um orçamento conservador identificado de 32.768 tokens. Instruções, schemas realmente ativos, fontes e reservas entram na conta. O prefixo inicial vazio mede 4.534 tokens estimados na revisão final de 11/10/2026, frente aos 18.894 da reprodução anterior; isso não representa custo faturado nem latência de produção. Ver [contrato e medições](../design/chat-context-strategy.md).

`pendingHistory` reconhece interrupção por recarga e acrescenta auditoria ao contexto recuperado, preservando o checkpoint. A recuperação recomenda reler registros antes de repetir alterações; não é rollback automático ou transação distribuída. A chave e o envelope v1 foram mantidos; a coleção histórica `archivedSessions` guarda sessões inativas, que só são arquivadas quando têm `archivedAt`. O merge criptografado permanece conservador para alterações concorrentes na mesma conversa.

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
| [AssistantChat.test.tsx](../../src/chat/AssistantChat.test.tsx), [presentation.test.ts](../../src/chat/presentation.test.ts), [ChatImageCarousel.test.tsx](../../src/chat/ChatImageCarousel.test.tsx) | Responsividade, foco/teclado, IME, rascunhos, encaixe lateral/central, handoff, escolhas explícitas e bloqueio de resultados históricos de outro plano. |
| [contextBudget.test.ts](../../src/chat/contextBudget.test.ts), [chatCompaction.test.ts](../../src/ai/chatCompaction.test.ts) | Limiar, continuidade incremental, tool pairs, fontes grandes, modelo, cancelamento e resumo sem bytes multimodais. |
| [assistant.context.test.ts](../../src/ai/assistant.context.test.ts), [stepContext.test.ts](../../src/chat/stepContext.test.ts), [workspaceAgent.discovery.test.ts](../../src/ai/agents/workspaceAgent.discovery.test.ts) | SDK real com modelo simulado: descoberta de schemas, leitura e alteração única do plano, compactação entre passos e pedido humano preservado exatamente. |
| [assistant.finalAnswer.test.ts](../../src/ai/assistant.finalAnswer.test.ts), [assistant.review-flow.test.ts](../../src/ai/assistant.review-flow.test.ts) | Término com síntese, 16º passo sem ferramentas, leitura repetida, resposta ausente e mensagens/auditoria preservadas. |
| [workspaceContext.test.ts](../../src/ai/workspaceContext.test.ts), [workspaceReadCoverage.test.ts](../../src/ai/workspaceReadCoverage.test.ts) | Projeções limitadas, chunks completos, caudas de notas, versões concorrentes e proteção contra substituição baseada em fonte parcial. |
| [turnContext.test.ts](../../src/chat/turnContext.test.ts), [ChatHistory.test.tsx](../../src/chat/ChatHistory.test.tsx), [sessionHistory.test.ts](../../src/chat/sessionHistory.test.ts) | Foco por tela, histórico recente/arquivado, confirmação de exclusão e identidade/migração de sessões. |

As baterias determinísticas usam modelos simulados; um ensaio separado no localhost executou quatro revisões com o GPT-6.1 Sol configurado, conforme [relatório](../reports/chat-review-and-interface-2026-10-11.md). A última terminou com cinco leituras em 26,033 s, preservando o plano e reconhecendo critérios da IA ocultos sem avaliá-los. Não foi realizado estudo com pessoas. Cobertura de contratos e esse ensaio pontual não demonstram obediência perfeita do modelo, sucesso remoto de todos os fluxos, qualidade universal de resposta ou eficácia do futuro Dairo.

A persistência ativa mantém o documento completo, incluindo checkpoint, metadados e referências. O exportador opcional legado `chatToDatabaseRows`, em [workspaceTransfer.ts](../../src/data/workspaceTransfer.ts), conserva seu formato tabular anterior e não representa um backup completo desses campos. Ele não é o caminho ativo de gravação da conversa.

## Lacunas e diagnóstico de modularização

A separação `interface → store → adaptador → agente → ferramentas → domínio` já está explícita. O store coordena envio, persistência, streaming e recuperação. Nesta rodada, o contexto de tela passou a `turnContext.ts`, a preparação/compactação a `contextBudget.ts` e `chatCompaction.ts`, os metadados de sessão a `sessionHistory.ts` e a navegação histórica a `ChatHistory.tsx`. As transições de sessão continuam no store, protegidas por testes. O streaming agrupa atualizações de texto em 80 ms e faz flush no encerramento, erro ou cancelamento; auditoria de ações permanece imediata.

O prompt não declara a sincronização desligada: descreve persistência pelo repositório configurado e exige observar erros antes de afirmar que algo foi salvo. Isso não equivale a diagnosticar a conectividade da conta ou assegurar entrega remota.

## Perguntas e evidências possíveis para artigos

| Pergunta candidata | Evidência necessária |
| --- | --- |
| Ferramentas validadas e auditoria tornam alterações de plano mais verificáveis? | Pedidos, chamadas, argumentos, estado antes/depois, resultado de persistência e revisão independente de correção. |
| Fontes selecionadas ajudam a corrigir premissas sem misturar projetos? | Fontes autorizadas, tentativas de escopo errado, decisões do agente e revisões justificadas por evidências. |
| O fluxo estruturado supera chat comum no caso de estudo? | Mesmo LLM e tarefas equivalentes, critérios definidos antes do ensaio e avaliação independente, conforme [objetivo do artigo](../OBJETIVO_DO_ARTIGO.md). |
| Futuras memórias Dairo preservam proveniência e controle humano? | Somente após implementar: fonte por memória, edições/exclusões, conflitos, erros de extração e avaliação de utilidade sem inferir eficácia antecipadamente. |

O agente atual é suporte operacional à investigação e organização. Não controla o robô nem verifica automaticamente a realidade física. Resultados de pesquisa precisam distinguir o que foi solicitado, proposto, aplicado, salvo e efetivamente observado.

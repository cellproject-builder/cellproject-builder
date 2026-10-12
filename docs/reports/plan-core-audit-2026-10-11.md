# Revisão do núcleo dos planos — 11/10/2026

## Resultado e escopo

A revisão encontrou **11 problemas reproduzidos** no núcleo de construção e execução dos planos. Cinco afetam preservação de trabalho ou resolução de etapas (P1); seis afetam integridade estrutural, revelação de critérios e contexto de geração/replanejamento (P2). Após aprovação do usuário, os 11 receberam correções e regressões permanentes. Uma revisão independente reproduziu dois caminhos adicionais de R3/R11, corrigidos antes da validação final.

Referência da auditoria: commit `7ae3e0d`, com árvore de trabalho limpa no início. As reproduções e números de linha em “Achados confirmados” descrevem essa versão anterior às correções. Três agentes trabalharam em frentes separadas: invariantes da árvore e das etapas; identidade, ciclo de edição e persistência; contratos de construção e revisão pela IA. Na implementação, três frentes de reparo e um revisor independente trabalharam em paralelo, com coordenação e validação integrada. As alterações estão locais, sem commit ou publicação nesta rodada.

O objetivo desta revisão é preparar operações confiáveis para interface, API, MCP e CLI AXI. O runtime externo deve poder trazer sua própria inteligência, consultar e alterar o plano sem chamar o provedor de IA interno. O usuário autorizou abertura do cofre no servidor para execução autorizada, conservando conteúdo cifrado no banco. API/MCP/AXI ainda não foram implementados nesta rodada; os reparos abaixo estabilizam as regras que essas integrações deverão compartilhar.

Kanban e notas não receberam uma auditoria funcional completa nesta rodada. Não houve deploy, acesso a contas reais, chamada paga a modelos, ensaio físico ou nova inspeção visual de navegador.

## Correções aplicadas

| IDs | Comportamento após a correção | Regressões permanentes principais |
| --- | --- | --- |
| R1 | Falha aberta mantém o resultado pendente, inclusive na raiz, em categorias e em nós com filhos resolvidos; domínio e apresentação compartilham a resolução | [store.audit-regressions.test.ts](../../src/store.audit-regressions.test.ts) |
| R2 | Refresh adota rascunhos, pesquisa, sugestões, arquivo e prompts visuais remotos; preserva seleção local válida e descarta marcadores remotos de carregamento; texto visual local não enviado adia refresh | [CloudLiveSync.planner.integration.test.ts](../../src/cloud/CloudLiveSync.planner.integration.test.ts), [CloudLiveSync.test.tsx](../../src/cloud/CloudLiveSync.test.tsx) |
| R3 | Editor persiste seu proprietário gerenciado; cópias importadas não dependem do ID interno; recuperação conserva trabalho órfão, inclusive só regras/cache; conciliação respeita troca de proprietário | [planner.ownership.test.ts](../../src/workspace/planner.ownership.test.ts), [documentMerge.test.ts](../../src/cloud/documentMerge.test.ts), [runtime.test.ts](../../src/cloud/runtime.test.ts) |
| R4 | Arquivo restaura o domínio da sessão, incluindo rascunhos e sugestões estacionadas, após persistência e reabertura | [planner.ownership.test.ts](../../src/workspace/planner.ownership.test.ts), [store.audit-regressions.test.ts](../../src/store.audit-regressions.test.ts) |
| R5 | Desfazer modifica os campos da ação e conserva notas e outras edições posteriores não pertencentes a ela | [store.audit-regressions.test.ts](../../src/store.audit-regressions.test.ts) |
| R6–R7 | Aceitação em lote reutiliza identidades já aceitas; exclusão limpa lotes ativos/estacionados; arestas só são materializadas com extremidades existentes | [store.audit-regressions.test.ts](../../src/store.audit-regressions.test.ts) |
| R8 | Importação pública rejeita ciclos e pais ausentes/desconectados antes da mutação; exclusão termina mesmo em árvore antiga corrompida | [store.audit-regressions.test.ts](../../src/store.audit-regressions.test.ts) |
| R9 | Crítica mantém o resultado completo internamente e revela o critério alternativo na saída somente quando a mesma regra da interface permite | [plannerWorkflowContracts.test.tsx](../../src/ai/plannerWorkflowContracts.test.tsx) |
| R10 | Replanejamento recebe critério próprio, critério da IA liberado, resultado relatado e referências com origem/timestamps, conservando causa indeterminada | [plannerWorkflowContracts.test.tsx](../../src/ai/plannerWorkflowContracts.test.tsx) |
| R11 | Pesquisa/cache pertencem ao contexto atual; chat e tela descartam respostas tardias após mudanças de objetivo, regras, intenção ou anexos; seleção/criação leem o contexto vigente | [plannerWorkflowContracts.test.tsx](../../src/ai/plannerWorkflowContracts.test.tsx), [store.audit-regressions.test.ts](../../src/store.audit-regressions.test.ts) |

Cada reparo teve uma reprodução que falhou antes da correção e passou depois. A revisão independente confirmou também a geração/expansão tardia na interface e a conciliação entre proprietários diferentes com o mesmo ID interno. Seus quatro testes de sondagem passaram após os reparos; os cenários correspondentes têm regressões permanentes no repositório.

Limites de comportamento preservados: uma falha permanece aberta até `clearFailure`; substituir o plano não a encerra automaticamente. O produto mantém **um arquivo persistente de plano**: o arquivo anterior substituído continua disponível para desfazer em memória, sem introduzir uma pilha persistente de múltiplos arquivos. A importação não migra destrutivamente snapshots antigos já armazenados.

## Validação da implementação

| Verificação | Resultado |
| --- | --- |
| Suíte completa após os reparos, com opt-ins live removidos | **2.729 testes passaram, 8 ignorados, nenhuma falha; 251 arquivos** |
| `npm run build` | TypeScript e build de produção concluídos com código 0; avisos de Browserslist antigo e tamanho de chunks |
| `npm run test:planning-quality` | 9 testes em 3 arquivos passaram; transporte simulado e chamadas pagas desabilitadas |
| `npm run bench:planner` | 3 testes passaram; 192 operações de volume, sem falhas, em árvores balanceadas/largas/profundas até 12.000 nós |
| Revisão independente | Nenhum achado acionável pendente em R1–R11; 4 sondagens passaram após falharem antes das correções |
| `npm run check:repo` | 34 documentos mantidos, 928 links locais e 7 fronteiras transitivas verificados, sem erro |
| `git diff --check` | Sem erros de whitespace |

O primeiro ensaio integrado detectou 60 falhas em cinco arquivos de integração. Suas preparações deixavam domínio/identidade de sessões anteriores ou dependiam da antiga associação implícita por ID interno; foram ajustadas para limpar o estado e definir o proprietário explicitamente, conservando as assertions. Esses cinco arquivos passaram com 157 testes antes da repetição completa. A compilação também identificou uma inferência circular de tipo no novo validador; a anotação explícita corrigiu o erro sem alterar o comportamento.

Durante a suíte completa, o chat “Investigar problema no tablet” alterou `workspaceTools.ts` e acrescentou `workspaceTools.persistence.test.ts` neste mesmo checkout. Esses arquivos pertencem à correção paralela de leitura durante conflito e não compõem os 11 reparos desta auditoria. A integração adicional de quatro arquivos passou com **84 testes**; a bateria paralela atual passou isoladamente com **7 testes**, não incluídos na contagem de 2.729 acima. Uma checagem de tipos adicional identificou uma chamada a ferramentas com tipos diferentes no teste paralelo; ela foi corrigida nesse trabalho antes da nova compilação do checkout conjunto.

O JSON final da suíte está em `%LOCALAPPDATA%/Temp/cellproject-plan-repairs-final-tests-20261011.json`; o ensaio de volume em `cellproject-plan-repairs-perf-20261011.json`. Os resultados são locais e sintéticos; não medem FPS, desempenho de rede, eficácia física ou qualidade factual de todos os planos.

## Achados confirmados na versão de referência

| ID | Prioridade | Problema | Consequência observada |
| --- | --- | --- | --- |
| R1 | P1 | Falha aberta não prevalece sobre conhecimento declarado ou resolução dos filhos | Tutor pula trabalho com falha; plano pode mostrar 100% |
| R2 | P1 | Sincronização preserva dados locais de domínio como se fossem apenas preferências de tela | Rascunho remoto é descartado e depois sobrescrito sem conflito |
| R3 | P1 | Proprietário do editor é inferido por ID de plano importado | Uma edição destinada ao projeto B pode sobrescrever o projeto A |
| R4 | P1 | Reset e restauração omitem sugestões estacionadas e rascunhos de nós | Desfazer não recupera todo o trabalho anterior |
| R5 | P1 | Desfazer confirmação restaura um nó inteiro com proteção incompleta | Nota salva depois da confirmação desaparece |
| R6 | P2 | Aceitação parcial seguida de aceitação em lote usa mapas diferentes | Conexões entre sugestões aceitas desaparecem |
| R7 | P2 | Exclusão deixa IDs aceitos em lotes pendentes | Aceitar outra sugestão cria aresta para nó inexistente |
| R8 | P2 | Importação aceita ciclos de parentesco desconectados | Trabalho fica fora do tutor/progresso; exclusão lança RangeError |
| R9 | P2 | Crítica pelo chat devolve critério alternativo antes da liberação | O chat contorna a ocultação aplicada pela interface |
| R10 | P2 | Replanejamento não distingue critério próprio, critério da IA e observações verificadas | Diagnóstico recebe um critério diferente e perde evidências registradas |
| R11 | P2 | Geração pelo chat mantém pesquisa de uma geração anterior | Expansão de um plano novo recebe digest documental antigo |

### R1 — Falha aberta pode coexistir com plano resolvido

**Reprodução 1:** marcar o passo A como conhecido, reportar uma falha real em A e consultar resolução, sequência e tutor. A recebe `state='problem'`, mas conserva `takenAsKnown`. A resolução retorna verdadeiro, o passo B seguinte fica desbloqueado e o tutor pula A.

**Reprodução 2:** decompor A, resolver seus filhos, resolver os demais passos e reportar falha no resultado de A. O plano continua em 100%, A continua resolvido pelos filhos e o tutor retorna ausência de trabalho. Não houve replanejamento nessa reprodução.

**Causa:** [reportFailure](../../src/store.ts) (`1567–1576`) invalida confirmação e atestação, mas não o piso de conhecimento. `isNodeResolved` (`2374`, `2389`) e a fronteira (`2312–2323`) não dão precedência à falha aberta. [nodePresentation](../../src/graph/nodePresentation.ts) calcula resolução separadamente, ampliando o risco de divergência entre domínio e apresentação.

**Correção a verificar:** falha aberta precisa tornar o resultado do nó pendente, inclusive quando seus filhos estão resolvidos. Conhecimento assumido, conclusão, desbloqueio, progresso e próximo item do tutor devem consultar a mesma regra. Preservar a distinção entre trabalho avançado e evidência física, sem transformar um relato em prova.

### R2 — Refresh remoto descarta rascunhos de domínio

**Reprodução:** outro dispositivo altera o rascunho do projeto ativo, incluindo alternativas de plano; o editor local ocioso atualiza a revisão remota; uma edição local posterior muda outro campo. Na sondagem, o remoto tinha `name='Remote paid draft'` e planos; o estado local conservou `name='Old local'` e `plans=null`. O PUT seguinte usou `baseRevision=2` e publicou esses valores antigos sem conflito.

**Causa:** [CloudLiveSync.tsx](../../src/cloud/CloudLiveSync.tsx), linha 103, preserva `objectiveDraft`, sugestões pendentes/estacionadas e arquivo locais junto com seleção, lente e painel. [runtime.ts](../../src/cloud/runtime.ts), linhas 246–250, confirma a revisão remota como aplicada, embora esses campos de domínio tenham sido substituídos.

**Correção a verificar:** conservar localmente somente estado de apresentação. Dados de domínio remotos devem ser adotados ou conciliados com conflito explícito antes do reconhecimento da revisão. Testar edição em outro dispositivo e uma alteração posterior não relacionada no primeiro.

### R3 — Cópias importadas confundem a identidade do projeto

**Reprodução:** importar o mesmo plano em dois projetos gerenciados, A e B; editar suas cópias independentemente; deixar B no editor; inicializar novamente a associação do workspace. O proprietário muda para A, primeiro projeto com o mesmo `Project.id`. Uma edição subsequente destinada a B sobrescreve o snapshot de A. Reabrir B também captura o editor atual no proprietário incorreto antes de carregar B.

**Causa:** [initializeWorkspace](../../src/workspace/planner.ts), linhas 95–96, infere propriedade pelo ID interno do plano. [savePlanner](../../src/workspace/store.ts), linha 223, admite snapshots com esse ID em projetos gerenciados diferentes. A captura no proprietário anterior ocorre em `openPlanner`, linha 110.

**Correção a verificar:** persistir a identidade explícita do projeto gerenciado que possui o editor; definir a identidade de uma cópia importada sem depender da primeira correspondência do ID interno. Testar A/B após reabertura, associação inicial, edição e troca de projeto.

### R4 — Desfazer reset perde partes da sessão anterior

**Reprodução:** estacionar um lote de sugestões, manter outro lote ativo e escrever um rascunho de critério. Executar `resetProject` e `undoReset`. O projeto e o lote ativo retornam; `parkedSuggestions` e `drafts` ficam vazios. Reset, importação e demo compartilham a preparação de uma nova sessão.

**Causa:** os helpers de arquivo em [store.ts](../../src/store.ts), linhas 434–439, conservam somente projeto e lote ativo. Reset (`2012–2015`) e restauração (`2033–2040`) usam `freshProjectSession`, que limpa os demais campos sem uma cópia recuperável nesse arquivo.

**Correção a verificar:** arquivar e restaurar um snapshot completo do domínio da sessão, com vínculo ao plano. Manter regras próprias para preferências transitórias. Testar restauração de sugestões ativas, estacionadas e rascunhos, inclusive quando já existe outro projeto no arquivo.

### R5 — Desfazer confirmação apaga nota posterior

**Reprodução:** confirmar A; salvar uma nota em A pelo mesmo `updateNode(..., {commit:true})` usado pelo painel; desfazer a confirmação. O método retorna sucesso e restaura a nota vazia do snapshot anterior.

**Causa:** [undoLastAction](../../src/store.ts), linha 1958, verifica apenas o último ID do histórico. Notas não acrescentam uma entrada nesse histórico. As linhas 1963–1971 restauram o nó inteiro. O fluxo real de salvamento está em [DetailPanel.tsx](../../src/components/DetailPanel.tsx), linha 841.

**Correção a verificar:** invalidar o desfazer diante de uma revisão efetiva posterior, ou desfazer somente os campos da ação sem apagar a nota. Cobrir também outras edições que não alteram o último ID do histórico.

### R6 — Aceitação parcial e em lote produz grafos diferentes

**Reprodução:** sugerir A, B e conexão A→B; aceitar A individualmente; aceitar todas as sugestões restantes. Os dois nós existem, mas sua conexão desaparece.

**Causa:** [acceptAllSuggestions](../../src/store.ts), linha 1734, inicia um mapa vazio. As linhas 1760–1763 resolvem as extremidades somente nesse mapa, ignorando os IDs aceitos anteriormente em `pending.acceptedMap`.

**Correção a verificar:** aceitar tudo, aceitar individualmente ou combinar as duas formas deve resultar na mesma topologia. Usar uma resolução de identidade comum e testar as três sequências com as mesmas sugestões.

### R7 — Aceitação posterior pode criar conexão inválida

**Reprodução:** sugerir A, B e A→B; aceitar A; excluir A; aceitar B. A aresta criada referencia o ID excluído de A.

**Causa:** [deleteNode](../../src/store.ts), linhas 1137–1155, remove nós e arestas materializados, mas não limpa esses IDs nos mapas de lotes pendentes. `acceptSuggestion`, linhas 1691–1700, usa o mapa sem validar a existência das extremidades. Lotes estacionados compartilham a mesma fragilidade de referência.

**Correção a verificar:** depois de qualquer exclusão, nenhum lote deve poder materializar uma referência ao nó eliminado. Toda aresta persistida deve possuir origem e destino existentes.

### R8 — Árvore importada pode esconder trabalho e quebrar a exclusão

**Reprodução pelo pipeline público:** plano com A, B e C; no JSON, definir `A.parentId=B` e `B.parentId=A`; passar por `prepareVisualPlanImport` e `importProject`. A importação retorna `{ok:true}`, mas progresso/tutor consideram somente C. Excluir A lança `RangeError` na coleta recursiva.

**Causa:** [parseImportedProject](../../src/store.ts), linhas 652–655, repara pais ausentes, sem garantir ausência de ciclos e alcance da raiz. A preparação pública está em [portable.ts](../../src/visuals/portable.ts), linha 36; a interface usa esse caminho em [TopBar.tsx](../../src/components/TopBar.tsx), linhas 206–211. A coleta de exclusão em `store.ts`, linha 1119, não controla visitas.

**Correção a verificar:** rejeitar uma árvore inválida antes de incorporá-la, com diagnóstico de ciclo ou componente desconectado; qualquer reparação precisa ser explícita. A exclusão também deve terminar com segurança se receber dados antigos corrompidos.

### R9 — Critério alternativo vaza pelo resultado da ferramenta

**Reprodução:** solicitar crítica pelo chat para nó sem critério próprio travado. `planner_ai.critique_node` retorna sucesso incluindo `criterioAlternativo`. A sondagem recebeu `HIDDEN_ALT_CRITERION: hold 100g for 30 seconds` nessa condição.

**Causa:** [plannerTools.ts](../../src/ai/plannerTools.ts), linha 188, retorna o objeto completo. [GroundTruth.tsx](../../src/components/GroundTruth.tsx), linhas 656–663, oculta explicitamente esse campo até sua liberação. O contexto de entrada mascara o critério original, mas o resultado da crítica não aplica a mesma regra.

**Correção a verificar:** projetar a saída de acordo com a mesma política de revelação usada pela interface. Registrar o critério próprio antes de receber critérios sugeridos deve funcionar em todos os canais, inclusive no MCP futuro.

### R10 — Diagnóstico não recebe o critério próprio e as observações completas

**Reprodução:** critério próprio de levantar 100 g até 90 graus com erro máximo de 2 graus; critério da IA diferente, sem carga e com erro de 5 graus; âncora verificada com observação de alimentação sob carga. Clicar em replanejar passa somente o critério da IA, sem o critério próprio ou a observação verificada.

**Causa:** [GroundTruth.tsx](../../src/components/GroundTruth.tsx), linhas 1344–1346, escolhe o texto da IA depois da revelação. As linhas 1315–1317 incluem somente âncoras sem sinal registrado. [ReplanContext](../../src/ai/service.ts), linhas 448–469, oferece um único campo de critério, sem representar separadamente previsão própria e observações verificadas.

**Correção a verificar:** transmitir critério próprio, critério sugerido quando liberado, resultado relatado, referências e observações com suas origens. Conservar a possibilidade de causa indeterminada. A presença de uma referência verificada não prova automaticamente qual foi a causa da falha.

### R11 — Nova expansão recebe pesquisa de contexto antigo

**Reprodução:** conservar no rascunho pesquisa anterior sobre bateria; gerar novas alternativas sobre servo pelo chat e selecionar a nova alternativa. A expansão recebe o digest da bateria. A sondagem também forneceu ao gerador um digest novo, mas o callback de progresso não estava conectado para capturá-lo.

**Causa:** [plannerTools.ts](../../src/ai/plannerTools.ts), linha 143, chama `outlinePlans` sem callback; a linha 148 grava alternativas sem o digest desta geração. [setOutlines](../../src/store.ts), linha 1923, mantém a pesquisa antiga quando o argumento não é informado. A linha 158 de `plannerTools.ts` transmite esse estado à expansão. `setObjectiveDraft` também não invalida esse digest ao mudar o objetivo.

**Correção a verificar:** vincular pesquisa e cache de expansão ao contexto da geração, incluindo objetivo, regras, intenção e anexos. Cada novo lote deve usar o digest correspondente ou ausência explícita de pesquisa, nunca herdar silenciosamente o anterior.

## Verificações da auditoria, antes das correções

| Verificação | Resultado |
| --- | --- |
| `npm test` com opt-ins live removidos do processo filho | 2.664 testes passaram, 8 ignorados, nenhuma falha; 247 arquivos no relatório JSON |
| `npm run test:planning-quality` | 3 arquivos, 9 testes passaram; serviço ensaiado com transporte simulado e chamadas pagas desabilitadas |
| `npm run lint` | TypeScript terminou com código 0 |
| `npm run check:repo` antes do relatório | Código 0; 34 documentos mantidos, 927 links e 7 fronteiras transitivas verificados |
| Sondagens do domínio | 6 testes confirmaram os comportamentos defeituosos de R1 e R5–R8 |
| Sondagens de persistência | 3 testes confirmaram R2–R4 usando stores/runtime reais, IndexedDB e HTTP simulados |
| Sondagens negativas dos contratos | 3 assertions de comportamento correto falharam conforme esperado, reproduzindo R9–R11 |

As sondagens originais do domínio e de persistência afirmavam o comportamento defeituoso observado; passarem não tornava esse comportamento correto. As sondagens negativas dos contratos afirmavam a regra esperada e falharam na versão de referência. Essa lacuna da suíte original foi coberta pelas regressões permanentes da implementação.

Os probes foram criados fora do repositório, em `%LOCALAPPDATA%/Temp`: `cellproject-invariants-audit-53ba4897909b4451950238bf5d9ac119`, `cellproject-plan-audit-20261011` e `cellproject-workflow-audit-20261011`. Seus arquivos são temporários; os passos de reprodução e critérios deste relatório permanecem como referência durável. O JSON geral está em `cellproject-plan-audit-tests-20261011.json` nessa mesma pasta temporária.

## Continuidade após a estabilização

1. **Núcleo compartilhado:** extrair os casos de uso verificados para operações independentes de React/Zustand, com ator, projeto, plano, revisão, entradas e resultados explícitos.
2. **API:** definir autenticação, autorização por projeto, revisão/conflito e cobertura de cada ação da interface, incluindo propostas trazidas por runtime externo.
3. **Adaptadores:** MCP, AXI e IA interna devem chamar as mesmas operações validadas. Chamadas ao provedor interno devem ser opcionais e distintas das mutações determinísticas.

Não declarar a API pronta apenas porque uma primeira fatia de projetos/tarefas funciona. A cobertura completa da interface ainda precisa ser inventariada e validada na fase de integração.

## Questões de produto e cobertura, separadas dos defeitos

- A ordem implícita entre passos irmãos atualmente define bloqueio. Definir se relações `independent` e `optional` devem modificar essa ordem; o significado dessas relações não deve ser inventado por um adaptador de API.
- `force:true` permite a conclusão assumida sem sinal e tem testes intencionais. Revisar sua apresentação e contagem como avanço versus evidência; não remover o comportamento sem uma decisão explícita.
- Nome e objetivo aparecem em projeto gerenciado, plano, raiz e rascunho. Definir quando uma edição altera cada um deles e como derivações são atualizadas.
- O plano existe no envelope global do editor e em snapshots do workspace. A propriedade explícita foi corrigida nesta rodada; definir o contrato canônico de revisão/transação antes de permitir mutações externas simultâneas.
- O chat não oferece toda a superfície da interface: replanejar, gerenciar referências e várias operações visuais são lacunas de cobertura. Um runtime externo precisa de operações de domínio determinísticas para registrar uma proposta própria, além de operações opcionais que chamam a IA interna.
- A auditoria não avalia a qualidade factual de todos os planos gerados nem comprova eficácia do método científico. Testes simulados verificam contratos e aplicação de estado; não substituem investigação física.

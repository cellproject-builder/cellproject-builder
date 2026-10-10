# Motor de planos: estado verificado

10/10/2026. Auditoria do código, testes e registros locais do Dynamic Diary. Sem novas pesquisas web, inferências, leitura de chaves ou alterações no código. Este documento atualiza a situação de implementação de [PLAN_ENGINE_ANALYSIS.md](./PLAN_ENGINE_ANALYSIS.md); os resultados históricos continuam descritos em [EVALUATION.md](./EVALUATION.md).

**Engenharia reversa e criação nova já estão no produto. Perguntas e pesquisa existem, mas ainda não formam uma entrevista técnica obrigatória nem uma avaliação automática de cobertura. A cobertura sistemática do patinete e a revisão conservadora inspirada no DBox permanecem experimentos separados. TypeSafe está integrado como conselho, não como verificador de engenharia.**

## O que existe e o que ainda falta

| Frente | Entrega verificável | Limite atual |
|---|---|---|
| Engenharia reversa × criação nova | `ObjectiveScreen.tsx` permite a escolha explícita; `planApproach` e `referenceTarget` chegam à geração de esboços, expansão, decomposição, tutor/crítica e ferramentas do chat. `store.test.ts` cobre criação, recarga, JSON e legado. A abordagem é independente de entender/construir e de reaproveitar/fabricar do zero. | A distinção condiciona prompts e contexto; não produz, por si, uma reconstrução correta do sistema. Alvo/variante são descrições humanas ainda não verificadas. |
| Perguntar antes de escolher peças | `service.ts:1564` orienta manter informações desconhecidas e pedir identificação, fonte, medida, conector, protocolo ou decisão. `service.test.ts:622` verifica essa instrução na decomposição. Há nós de decisão com alternativas. | Não há schema de entrevista, fila de perguntas técnicas obrigatórias ou bloqueio determinístico de escolhas sem respostas. A IA pode apresentar perguntas em descrições/passos, mas os testes não demonstram a qualidade das perguntas de uma resposta real. |
| Pesquisa de referência | `resolvePlanningContext` (`service.ts:882`) executa pesquisa opcional antes dos planos e reutiliza o digest na expansão. `runResearch` está no produto; pesquisa de uma célula é acessível em `GroundTruth.tsx`. Links sugeridos são filtrados pelas URLs recuperadas. | Depende da pesquisa habilitada, configuração e resposta do provedor. Falhas comuns degradam para geração sem digest; cancelamento/limite de serviço têm tratamento próprio. Decomposição, explicação, crítica e replan reutilizam `ctx.research`; não fazem uma nova busca automática para cada peça. URL recuperada não verifica a afirmação, a variante ou a compatibilidade. |
| Módulos e interconexões do plano | A árvore distingue recursos/passos/decisões e possui arestas. `planningApproachDirective` pede rastrear interfaces elétricas, mecânicas, de controle e informação. `planOverviewFor`, `relatedPartsFor` e conhecimentos já dominados chegam ao chat. Regressões verificam recurso existente fora do ramo, critério oculto e sugestões em revisão. | Contexto consistente ajuda a evitar duplicações, mas não garante ausência semântica delas. Arestas do grafo não são contratos técnicos de portas, pinagem, tensão, tolerância ou protocolo. Não há matriz automática de cobertura técnica ligada ao plano. |
| Cobertura do patinete | `docs/design/plan-approach/benchmark.ts` possui 12 tópicos de revisão, seis interfaces, afirmações delimitadas e casos de omissão/variante/transferência indevida; 24 testes offline passam. | **Somente laboratório:** não há importação desse verificador por `src/` ou `server/`. `assessCandidate` recebe listas de tópicos/interfaces já declaradas; não interpreta sozinho o plano gerado. Verifica IDs/textos/correspondências, não verdade semântica ou completude universal. Mesmo cobertura total retorna compatibilidade desconhecida e nenhum ensaio aprovado. |
| TypeSafe | `server/typesafe.mjs:98` classifica `reference/extend/revise/reorganize/clarify`. No chat, `chat/store.ts:131–136` chama o classificador e injeta o resultado como aconselhamento à LLM; sem configuração, o assistente continua sem classificação. Há teste cliente e teste HTTP com serviço externo simulado. | Não executa mudanças nem escolhe sozinho a ferramenta. Na criação com anexos, `ObjectiveScreen.tsx:270` chama e exibe o rótulo; esse resultado não entra no prompt nem escolhe a ação de `outlinePlans`. Não classifica a cobertura dos módulos nem valida física. Recebe metadados limitados a 20 nós e trechos limitados dos arquivos, não todo o conteúdo do projeto. |
| Arquivos/código → plano | PDF, DOCX, Markdown e código entram como texto extraído e fonte não confiável. `planFilesContext` os inclui na geração; `planner_structure` adiciona/atualiza/move partes com IDs reais, revisão atual, fonte existente, preservação dos registros e undo. | `sourceAttachmentIds` relaciona um nó ao arquivo; não aponta automaticamente uma linha/página/trecho exato nem verifica que o arquivo sustenta a afirmação. Extração pode ser parcial; estes anexos guardam texto, não um arquivo binário original. |
| Revisão localizada e autoria | Sugestões de decomposição ficam em revisão; `planStructure.ts` já permite alterações locais atômicas sem recriar toda a árvore. Os testes cobrem ciclos, revisão obsoleta, fontes ausentes, reordenação e undo sem apagar rascunhos posteriores. | Isso constitui uma base implementada, parte dela anterior ao ensaio DBox. Não comprova que a LLM escolha a menor alteração ou preserve corretamente todo o raciocínio do usuário. |

## Aproveitamento real do DBox

O precedente relevante é co-decomposição/revisão por nó, ajuda progressiva e associação código–etapas ([§4.3](https://arxiv.org/html/2502.19133v1#S4.SS3), [§4.4](https://arxiv.org/html/2502.19133v1#S4.SS4)). A aplicação ao ciclo de evidências físicas é uma adaptação do Dynamic Diary, cuja eficácia e novidade não foram demonstradas.

- **Produção:** contexto consistente entre chat/painel, sugestões examináveis, alterações locais preservando identidade/registro e a distinção explícita do ponto de partida. São suportes concretos para co-decompor; não uma reprodução integral ou validação do método do artigo.
- **Spike:** `run.ts:19` contém a revisão conservadora, com hipóteses concorrentes, `uncertain` e pergunta → detalhe → subpasso opcional. `results/plan-adapted.json` registra uma resposta real dessa condição; nenhuma mudança foi aplicada à árvore por esse ensaio.
- **Lacuna principal:** `replanFromFailure` em produção (`service.ts:1852–1930`) ainda descreve os filhos anteriores como falhos, manda não os repetir e exige diagnosticar qual premissa estava errada. Isso é inadequado quando o relato não distingue premissa, execução, alimentação, material e medição. O comportamento conservador do spike ainda não substituiu esse caminho.
- **Ajuda progressiva:** `explainNode` continua entregando uma explicação completa em streaming. Proteger o critério próprio não equivale a ter uma sequência de níveis de ajuda. O esquema `hints` do laboratório não está integrado ao tutor.
- **Artefatos:** a gramática declarativa chegou à produção (`src/visuals/diagram/`, [PRODUCTION.md](./PRODUCTION.md)). Isso permite examinar relações sem duplicar o plano. Geração livre de React continua no laboratório; diagramas, 3D ou aparência de montagem não demonstram cobertura ou funcionamento físico.

## O que os registros e testes demonstram

O manifesto do laboratório registra duas respostas reais para revisão de plano, sobre o mesmo contexto fictício de quatro nós e relato de tremor sem medições/documentos. O baseline usa o trecho TASK extraído do serviço com schema de avaliação comum, **não o fluxo integral de produção**. A adaptação combina DBox e regras próprias; uma saída por condição não isola o efeito do artigo nem permite concluir superioridade. As três classificações reais TypeSafe registradas são exemplos claros de consulta/extensão/reorganização, não acurácia ou calibração.

Os casos do patinete são **escritos manualmente**, não planos gerados por IA nem BOM validada. Os testes do produto usam modelos/serviços substituídos: verificam passagem de contexto, prompt, estado, limites e operações. Não demonstram que um LLM real perguntou tudo, encontrou fontes corretas ou selecionou peças compatíveis.

Execuções desta auditoria, todas aprovadas e sem inferência externa:

| Comando | Resultado |
|---|---|
| `npm test -- src/ai/service.test.ts src/ai/plannerTools.test.ts src/ai/planStructure.test.ts src/ai/planIntake.test.ts src/components/ObjectiveScreen.test.ts src/chat/store.test.ts src/attachments` | 105 testes / oito arquivos |
| `npx vitest run src/store.test.ts src/workspace/planner.test.ts` | 76 testes / dois arquivos |
| `npx vitest run --config docs/design/plan-approach/vitest.config.ts` | 24 testes offline |
| `node --test --test-name-pattern='plan intake' server/handler.test.mjs` | Um teste HTTP local; upstream simulado |

Não foi repetida a suíte completa nem feito novo teste de navegador nesta auditoria.

## Próximo ensaio: patinete elétrico caseiro

Usar o fluxo real **esboço → escolha → expansão → decomposição de um nó**, sem prescrever uma BOM. O objetivo inicial não informa peças, arquitetura ou desempenho: esses campos devem continuar desconhecidos até decisão/fonte pertinente. Antes da execução, congelar o texto dos anexos, versões, configurações e rubrica; guardar primeira saída, falhas, reparos, fontes e tempo. Não descartar uma primeira resposta ruim da contagem.

| Condição | Comportamento a conferir |
|---|---|
| Criação nova, sem referência | Levantar uso pretendido/requisitos e alternativas; não converter lacunas em modelos ou valores exatos. |
| Engenharia reversa, sem alvo | Pedir sistema/variante/material de referência; não escolher silenciosamente um patinete comercial. |
| Engenharia reversa, referência delimitada | Separar funções/afirmações documentadas do produto e hipóteses do caseiro; expor interfaces ainda não especificadas. |
| Alvo e anexo contraditórios | Apontar “4 Pro” no pedido versus “Scooter 4” no material; não fundir especificações. |

As páginas oficiais já identificadas em [plan-approach/README.md](../plan-approach/README.md) são comparação delimitada, não inventário das peças do usuário. Não documentam BOM interna completa, pinagem do controlador ou dimensões das fixações. Congelar o material efetivamente fornecido é necessário antes de comparar saídas.

Uma primeira matriz pequena pode usar duas repetições por condição, com mesmo modelo/configuração/orçamento: oito execuções do motor atual. Registrar separadamente esboço, expansão e decomposição de cada execução. Um avaliador deve mapear trechos aos tópicos/interfaces da rubrica, conferir cada afirmação contra a fonte e marcar desconhecidos. Não usar os rótulos da própria IA como gabarito. Contar perguntas concretas, escolha prematura de peça/variante, omissões, duplicação de nós existentes e transferência indevida de especificações. Cobertura deve informar o denominador delimitado; não um percentual de “projeto completo”.

Depois, comparar revisão atual e conservadora em casos com observação insuficiente, documentação suficiente e informação conflitante, mantendo schema/contexto iguais e verificando aplicação/undo. Esse ensaio decide a próxima adaptação DBox; não deve ser confundido com a primeira matriz do patinete.

O recorte científico permanece o de [OBJETIVO_DO_ARTIGO.md](../../OBJETIVO_DO_ARTIGO.md): premissa → previsão/critério próprio → ensaio → observação → revisão justificada, estudado no robô de dois braços. Patinete serve para avaliar generalização do planejamento; não substitui ensaio físico nem demonstra aprendizagem. Outra IA, TypeSafe, referência recuperada ou cobertura declarada não constitui verificação independente do mundo físico.

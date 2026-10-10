# Revisão de organização e documentação — 10/10/2026

## Escopo e situação

Segunda rodada, solicitada para organizar o repositório e documentar funcionalidades para manutenção e artigos. A rodada anterior está no [relatório de consolidação](../consolidation-audit-2026-10-10.md). O checkout já possuía alterações daquela etapa: esta revisão as preserva, sem atribuir a si todas as mudanças do diff total.

Não houve merge, deploy, alteração de serviços remotos, leitura de valores `.env` ou novas chamadas pagas. Resultados experimentais, templates e fixtures foram preservados. A descrição científica continua regida pelo [objetivo SENAI](../OBJETIVO_DO_ARTIGO.md).

## Mudanças concretas

| Decisão | Implementação e motivo |
| --- | --- |
| Agrupar aparência de projetos | Seis arquivos passaram para `src/workspace/project-appearance/`: schema, biblioteca, seletor, CSS e testes unitários. O teste integrado de Projects permanece junto da tela. Imports atualizados |
| Separar lógica pura de árvore | `childrenByParent` foi para `graph/treeIndex.ts`; layout e constantes para `graph/treeLayout.ts`. Algoritmos preservados; `store.ts` reexporta a API anterior. Consumidores internos passam a importar do domínio puro |
| Preservar conceitos iniciais | Cinco HTMLs movidos juntos para `docs/archive/early-concepts/`, sem alterar conteúdo ou links relativos entre eles |
| Tirar relatório solto da raiz | `design-qa.md` passou para `docs/reports/design-qa-2026-10-09.md`, com conteúdo histórico preservado |
| Localizar ferramenta de autoria | Gerador PWA saiu de `src/pwa` para `scripts/pwa/generate-icons.mjs`; comando `icons:pwa` e documentação adicionados. O outro gerador produz assets distintos e foi preservado |
| Corrigir configuração ambígua | Vite resolvia `vite.config.js` antigo e ignorado em vez do `.ts` fonte. As duas emissões antigas `.js`/`.d.ts` foram removidas. `dev`, `build`, `preview`, Vitest e auditoria selecionam explicitamente `vite.config.ts` |
| Ignorar variantes privadas do ambiente | `.env*` passa a ser ignorado, com exceções explícitas para exemplos. Isso cobre também variantes como `.env.production`; não remove arquivos já rastreados do histórico |
| Criar navegação e contratos documentais | README conciso, índice, dez fichas de módulos, mapa de pastas, guia para artigos e índices de histórico/scripts |
| Impedir regressões delimitadas | `check:repo` verifica links de arquivos mantidos, configuração e sete fronteiras transitivas de contratos puros |

Foram **13 movimentos de arquivos existentes**, além das novas fichas/helpers/checks. Não houve limpeza recursiva de caches ou remoção de experiências por ausência de imports. O único descarte identificado foi a dupla de emissões geradas conflitantes na raiz.

## Estado documental

O [catálogo](../modules/README.md) separa implementado, experimental e proposto. **Dairo permanece proposta**; o chat de ferramentas existente está descrito separadamente. SVG declarativo em produção não é apresentado como execução de React gerado. Cofre, PWA, montagem 3D e pesquisa documental têm limites explícitos. As fichas apontam código/testes, não só descrições de intenção.

## Verificações desta rodada

Executado no Windows, Node **v24.18.1**, npm **11.19.0**, em 10/10/2026. HEAD observado: `ab793fd`, com alterações de trabalho anteriores e desta rodada ainda não commitadas. Os resultados descrevem esse checkout; não são uma certificação da versão remota. Para um artigo reproduzível, fixar o commit/arquivo de versão final utilizado.

| Verificação executada | Resultado | Limite |
| --- | --- | --- |
| `npm test` | **1.317 aprovados, 8 ignorados**; 148 arquivos aprovados e 2 ignorados | Inferências/serviços simulados; ensaios live ficaram ignorados |
| `npm run test:gateway` | **137 aprovados**, zero falhas/ignorados | Não executa round trip de Auth/Storage/provedor remoto |
| `npm run build` | Tipagem e build aprovados | Avisos de chunks acima de 500 kB e base Browserslist antiga permanecem |
| `npm run check:bundle` | Aprovado, nenhum dos módulos pesados proibidos no caminho inicial | Fechamento inicial de 2.440.343 bytes, 730.886 gzip; não é medição de latência/dispositivo |
| `npm run check:gateway` | Sintaxe dos módulos Node aprovada | Sintaxe não equivale a comportamento |
| `npm run check:repo` | 23 documentos mantidos, 643 links locais e sete fronteiras transitivas aprovados | Confere destinos de arquivos, não anchors, todos os ciclos ou todo código morto |
| Varredura documental ampliada, somente leitura | 74 Markdown de raiz/docs/scripts, 760 links locais sem destino ausente; newline/whitespace conferidos | Não verifica links externos nem anchors; diretórios locais de capturas excluídos |
| Comparação do conteúdo movido com HEAD | Cinco HTMLs, relatório de design e gerador PWA com texto idêntico, normalizando CRLF/LF | Aparência era material novo do checkout anterior, revisada por imports/testes |
| `npm run icons:pwa` | Seis assets reproduzidos com SHA-256 idêntico aos existentes | Confere preservação das saídas após mover o gerador |
| `git diff --check` | Sem erros de whitespace | Não audita sozinho arquivos novos não rastreados; revisão documental adicional aplicada |
| `GET http://127.0.0.1:5190/` | **HTTP 200**, servidor preservado | Disponibilidade HTTP não comprova todos os fluxos de interface |

Os logs de cliente/gateway/build/bundle ficaram em `.codex-audit-senai-2026-10-09/repository-*.log`, ignorados pelo Git. A revisão cruzada dos documentos conferiu afirmações contra suas fontes e corrigiu limites de inferência, geometria e privacidade. Não houve instalação real de PWA, ensaio físico, medição de aprendizagem nem nova integração remota.

Verificações focadas já executadas durante a extração: 30 testes de aparência/ferramentas e 97 testes de store/grafo/estrutura do plano, aprovados. A resolução Vite foi observada antes (`vite.config.js`) e depois (`vite.config.ts`) da remoção das emissões antigas.

## Modularização ainda necessária

| Prioridade | Separação candidata | Invariante a preservar |
| --- | --- | --- |
| Alta | Políticas puras de critério/revelação/progresso em `store.ts`; estado visual versus ações/contexto em `visuals/domain.ts` | Mesmos critérios de conclusão, identidade, revisão e persistência |
| Alta | Prompts/normalização versus fluxos em `ai/service.ts`; seleção, pesquisa, geração e composição em `visuals/advancedGeneration.ts` | Mesmos critérios ocultos, contratos de montagem comuns, descarte de contexto antigo e ausência de aplicação parcial inválida |
| Média | Clipboard/ingestão do Board e histórico/rebase do caderno | Uma ação sem duplicação, undo consistente, cancelamento e limite de mídias |
| Média | Preparação de turno versus estado persistido do chat; schemas/leituras versus fila de ferramentas | Autorização de contexto, ordem de ações, auditoria e respostas atrasadas |
| Média | Codecs de backup versus transporte cloud; grupos de rotas versus composição Node | Revisões/CAS, dono esperado, limites, same-origin e rollback/retentativas |

Os maiores coordenadores ainda incluem `ai/service.ts`, `components/ObjectiveScreen.tsx`, `components/GraphCanvas.tsx`, `components/TutorMode.tsx`, `components/GroundTruth.tsx` e `store.ts`. Tamanho não prova defeito; sinaliza onde investigar responsabilidades com testes de contrato. Não foi realizada uma reescrita ampla só para reduzir linhas.

## Lacunas registradas, sem ampliar o escopo desta rodada

- O prompt do agente diz que sincronização cloud não está conectada; a aplicação possui persistência cloud, mas as ferramentas do agente têm escopo próprio. É necessário esclarecer o texto e seus testes antes de tratá-lo como capacidade do agente.
- O servidor tem exceção de cache para `/sw.js`, enquanto o worker registrado é `/service-worker.js`. A atualização usa `updateViaCache: none`; ainda convém alinhar nomes e testar headers.
- Inicialização offline depende de `/api/cloud/config`, mesmo quando há shell cacheado. PWA instalável não equivale a modo offline completo.
- A configuração atual é mono-conta/uma instância. Expandir contas e réplicas exige validar propriedade nas mutações do cofre e coordenar estado de sessão/limites hoje em memória.
- Layouts validados por schema e representação geométrica não comprovam contenção visual perfeita, BOM completa ou encaixe físico.

Esses itens são diagnósticos, não entregas adicionais declaradas. Ver [plataforma](../modules/platform-and-delivery.md), [dados](../modules/data-and-privacy.md) e [diagramas](../modules/diagrams.md) para evidências e limites.

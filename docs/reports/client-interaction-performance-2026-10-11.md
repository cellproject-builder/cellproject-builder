# Interação do cliente: CPU e persistência — 11/10/2026

## Estado e escopo

Este lote responde à lentidão que continuou perceptível na aplicação inteira depois da rodada anterior de desempenho. O [relatório anterior](client-performance-2026-10-11.md#ensaio-adicional-submissão-de-peças-repetidas-à-gpu) demonstrou redução de submissões de desenho em cenas repetitivas, mas explicitou que isso não resolvia a fluidez global. A continuidade do problema foi relatada pelo usuário; não se atribui ao ensaio anterior uma conclusão que ele não mediu.

A nova rodada atua no trabalho de **CPU da interface**: construção de contexto, validação repetida, reconciliação React, busca de notas e serialização de envelopes. A [proposta de arquitetura](../design/client-rendering-performance.md#arquitetura-recomendada) já separava esses custos da renderização WebGL. O compositor GPU, a geometria salva e o lote de fidelidade de diagramas SVG permanecem fora desta alteração.

Referência da árvore no início do trabalho e do baseline: `73e337432ef6cb7bbb8ba4352c5045e3a2197dc0`. O primeiro fechamento funcional da branch `codex/client-interaction-performance` foi verificado no snapshot `7d06dec`. A terceira bateria identificou outros dois gargalos e motivou uma segunda rodada. O código final medido é `2627abc68662175e7142f844f3d9282c6dab84fb`; testes, compilações e coleta local estão concluídos. A identificação dos bundles e as 30 amostras válidas estão preservadas nos arquivos de evidência abaixo.

Na carga local, as medianas da janela de execução caíram 89,83% em seleção, 80,54% em viewport, 85,28% em digitação e 95,58% na rajada cifrada. O polling apresentou faixas sobrepostas, sem conclusão de ganho. Ainda houve Long Tasks no candidato, chegando a 198 ms no caso cifrado. Esses resultados não demonstram fluidez global, ganho de GPU, resposta física ou desempenho em produção. Rodadas preliminares, aquecimentos e perfis adicionais ficaram fora da comparação final.

## Arquitetura e causas

Uma interação atravessa React/React Flow, stores Zustand e, quando há edição persistente, o adapter de armazenamento. Antes deste lote, operações pequenas podiam percorrer documentos grandes em mais de uma dessas camadas.

| Caminho | Trabalho redundante encontrado | Correção deste lote |
| --- | --- | --- |
| Seleção e menções do Estúdio | `sources()` serializava e calculava fingerprints de todas as notas/nós/imagens para localizar um único ID. Contexto padrão sem menções também construía todas as fontes. | Resolução direta por ID; filtro pelo rótulo antes da codificação; cache por identidade da fonte. Contexto avançado continua acessando as fontes necessárias ao seu contrato. |
| Bridge visual no canvas | Seleção reconstruía contexto com ferramentas fechadas; renders do pai atravessavam o Bridge. | Assinatura da seleção somente com uma janela visível; `memo` no Bridge e callback estável no callsite do GraphCanvas. |
| Digitação em nota com tinta/caderno | Cada alteração textual validava novamente os documentos visuais e recalculava os limites de imagens, embora esses campos não tivessem sido enviados. | Reutilizar documentos visuais quando o campo está ausente do patch e a referência é a mesma. Payload explícito continua validado. |
| Biblioteca de notas sem busca | Para cada nota, concatenava e convertia o corpo inteiro para minúsculas para procurar uma string vazia. | Construir os corpos de busca somente quando a consulta normalizada não está vazia. Escopo, filtros e ordenação permanecem. |
| Pan/zoom do Board | Salvar o viewport atravessava o schema do documento inteiro, clonando itens, tinta e modelos. | Ação específica de viewport, com validação estrita dos três valores e preservação dos arrays de conteúdo. |
| Edições persistentes em sequência | Embora o adapter já ignorasse estado de UI inalterado, cada edição real ainda podia serializar o envelope completo antes da fila assíncrona. | Coalescer snapshots imutáveis antes de `JSON.stringify`, com janela configurada de 200 ms no workspace, confirmação de escrita e flush explícito. |
| Indicadores de nota e comentário salvos | Um flush por alteração eliminaria a janela de coalescência; no comentário, o efeito também podia repetir automaticamente uma escrita rejeitada. | Observar confirmação, pendência e erro do adapter, com retry explícito; manter o caminho imediato para adapters sem esse contrato. |
| Adoção dos nós do GraphCanvas | A adoção descartava dimensões já medidas dos conceitos. | Preservar `measured` e identidade dos conceitos compatíveis; regressão com `adoptUserNodes` real e 500 nós. |
| Base64 no caminho cifrado | Conversão por bytes e recodificação para conferir canonicalidade acrescentavam passagens pelo conteúdo completo. | APIs nativas quando disponíveis, fallback em chunks de 8.190 bytes e canonicalidade por alfabeto/padding/bits não utilizados, mantendo limites. |

Implementações: [domínio visual](../../src/visuals/domain.ts), [Bridge](../../src/visuals/VisualWorkspaceBridge.tsx), [GraphCanvas](../../src/components/GraphCanvas.tsx), [store do workspace](../../src/workspace/store.ts), [BoardCanvas](../../src/boards/BoardCanvas.tsx), [notas](../../src/workspace/Notes.tsx), [comentários](../../src/workspace/Comments.tsx) e [adapter JSON](../../src/data/selectiveJSONStorage.ts).

### Contexto visual: resolver antes de serializar

`findMentionTarget` procura a fonte atual pelo tipo e ID, sem herdar o limite de 100 sugestões do menu. O acesso direto cobre stores válidos com IDs como chaves; o fallback mantém resolução por ID em coleções antigas com chaves alternativas. Notas pessoais e notas do projeto proprietário seguem a mesma regra de visibilidade anterior.

Os caches usam `WeakMap` com as identidades de nota, nó e imagem. Atualizações normais dos stores substituem esses objetos; uma edição invalida o corpo anterior, enquanto seleção ou rascunho de outra ferramenta pode reutilizá-lo. O algoritmo e os campos do fingerprint foram mantidos. O fingerprint do contexto continua incluindo o escopo atual, o pedido, as fontes selecionadas, anexos e os dados adicionais previstos para modo avançado/diagrama.

Critérios independentes exigem um cuidado adicional: a visibilidade pode mudar com o relógio, sem mudar o objeto. Cada resolução chama `canRevealAICriterionNow` **antes** de escolher a versão oculta ou revelada do cache. A janela de desfazer continua escondendo o critério e a explicação; expiração, confirmação e retorno ao estado oculto usam a regra original. Existência, exclusão e acesso à nota são conferidos antes de devolver conteúdo em cache.

Contexto padrão sem menções deixa de codificar fontes não solicitadas. Isso não remove o índice limitado de nós do contrato de diagrama nem o levantamento de relacionamentos do modo avançado. Cache não altera a seleção de referências nem transforma uma fonte em instrução.

### Persistência: adiar serialização, preservar confirmação

O store atualiza a interface imediatamente. O adapter retém o snapshot imutável e o destino capturado na inclusão na fila; edições ainda enfileiradas do mesmo documento podem substituí-lo pelo snapshot mais recente. A serialização ocorre na drenagem. O timer não é reiniciado por cada tecla, evitando uma espera indefinida por silêncio do usuário.

Os 200 ms são uma janela de agendamento, **não** um limite de confirmação em disco ou nuvem. Escrita em voo, disponibilidade do backend e erro podem prolongar a pendência. A promessa de escrita representa confirmação do backend; `flushWorkspacePersistence()` drena o adapter antes de aguardar a fila local e o runtime cloud. No caminho cloud, `write()` sozinho não basta, pois pode reter um rascunho após erro: o destino capturado exige checkpoint local cifrado confirmado, sem gravação ou erro local pendente, ou aguarda `flush()` no fallback. Um checkpoint local durável pode existir enquanto a sincronização remota segue pendente; o flush explícito do workspace também aguarda o runtime cloud.

Snapshots rejeitados permanecem pendentes para retry explícito. Uma edição nova não deve ser apagada pela falha de uma escrita antiga. Remoção aguarda escrita em voo, evitando ressuscitar o documento. Mudança de sessão deve preservar o destino original e bloquear aplicação ou encaminhamento ao proprietário errado. A interface observa pendência/erro; enfileirado não significa salvo.

O [gate de sincronização remota](../../src/cloud/CloudLiveSync.tsx) inclui a persistência adiada entre as condições que impedem substituição de documentos locais. Notas e comentários observam a confirmação do adapter sem forçar flush em cada efeito; uma falha continua visível até retry explícito ou nova edição. No modo local, ocultar a página ou iniciar seu fechamento solicita a drenagem, e o fechamento é advertido enquanto houver confirmação pendente.

As transições em [CloudStatus](../../src/cloud/CloudStatus.tsx) tentam drenar graph, workspace e chat antes de propagar uma falha individual. Backup, resgate e saída recusam filas de graph ainda não cobertas pelo runtime. As operações conferem o proprietário antes e depois de esperas assíncronas; capturas de persistência verificam revisão e JSON exato dos snapshots, e a assinatura dos documentos/mídia do runtime detecta edições que não passam pelo adapter adiado. A pendência resgatada só é reconhecida depois de logout HTTP bem-sucedido e da revalidação da captura. Erro de logout, troca de conta ou edição mais recente preservam o rascunho. Esses checks de transição são raros; não acrescentam uma assinatura completa por tecla.

## Invariantes preservadas

| Invariante | Como é preservada e coberta |
| --- | --- |
| Critério independente permanece oculto quando a regra de domínio exige | Sanitização do corpo e escolha temporal da variante do cache em toda resolução; teste com a mesma identidade antes/depois da janela. |
| Cache não amplia permissões nem revive referências removidas | Escopo/existência/visibilidade são resolvidos nos stores atuais antes de codificar ou reutilizar. Testes de nota estrangeira, nota na lixeira e remoção de nó/imagem. |
| Edição muda o contexto relevante | Substituição imutável invalida a entrada; testes de corpo de nota, conteúdo de nó, metadados de imagem e nó relacionado no modo avançado. |
| Menções continuam exatas | Lookup por ID alcança elementos além da centésima sugestão; menu mantém ordem, busca pelo rótulo e limite de 100 retornos. Tipo desconhecido não é interpretado como imagem. |
| Fastpath não aceita documento visual arbitrário | Um `canvas`, `ink` ou `document` explicitamente enviado percorre a validação completa, inclusive quando usa a referência existente. Payloads inválidos falham sem substituir o estado anterior. |
| Limites de imagens/tinta/modelos continuam ativos | O caminho completo conserva schemas e orçamentos. Fastpaths pulam somente conteúdo não alterado; não aumentam os limites do documento. |
| Viewport não altera conteúdo nem histórico de edição | API valida coordenadas/zoom e quadro ativo não arquivado; itens/arestas preservam identidade. Undo/redo de conteúdo usa o viewport atual. Substituição remota continua invalidando snapshots locais do documento. |
| Salvar, ler, remover e trocar sessão mantêm ordem | Adapter possui pendência e flush explícitos, destino capturado, leitura após drenagem e retenção de erro. Regressões de armazenamento verificam confirmação e retry. |
| Formato e armazenamento existentes continuam utilizáveis | Não há migração de envelope neste lote. Hidratação/importação continuam validando dados visuais; teste de viewport lê o envelope gravado no IndexedDB real do ambiente de teste. |

O cache depende do padrão imutável dos stores. Mutar um objeto de domínio em lugar de substituí-lo continua sendo uma violação desse contrato; este lote não introduz rastreamento profundo de mutações.

## Bateria 1 — diagnóstico de trabalho redundante

Esta bateria usa contagens determinísticas, não cronômetros de desempenho. Os testes foram escritos antes das respectivas correções para tornar observável o trabalho desnecessário.

| Caso isolado | Observado antes | Observado depois |
| --- | ---: | ---: |
| Contexto padrão sem menções, 160 nós | 160 codificações de nós | 0 |
| Lookup do nó 159 e resolução do seu contexto | 318 codificações de nós não selecionados | 0 |
| Menu com 160 rótulos compatíveis e limite de 100 | 160 codificações | 100 |
| Lookup/contexto repetidos, dois nós já consultados | 4 codificações | 0 |
| Contexto avançado repetido, quatro nós já consultados | 8 codificações | 0 |
| Hover de conceito no callsite real do GraphCanvas | 1 render adicional do Bridge memoizado | 0 |

O teste de hover falhou antes da alteração porque o GraphCanvas enviava uma callback inline diferente em cada render. Estabilizar somente o componente filho não era suficiente; o teste agora cobre o callsite e a continuidade da seleção/limpeza de artefatos.

Os testes de nota e Board também usam documentos de 100.000 pontos para verificar ausência de revalidação/reconstrução do conteúdo inalterado. Essas contagens demonstram remoção de trabalho redundante. Não são FPS, tempo de GPU ou ganho equivalente da aplicação inteira.

## Bateria 2 — regressão e preservação de dados

Execuções focadas confirmadas durante o desenvolvimento e fechamento integrado da primeira rodada. Os grupos se sobrepõem; **não somar** os totais como se fossem uma suíte única. O snapshot funcional `7d06dec` precede as correções adicionais identificadas na carga cifrada e na adoção de nós do GraphCanvas.

| Grupo | Resultado confirmado | Evidência |
| --- | --- | --- |
| Domínio/contexto visual | 86 testes aprovados em quatro arquivos | `domain.performance`, `domain`, `advancedRequest` e `advancedGeneration`; inclui invalidação, permissões, critério temporal e contexto avançado. |
| GraphCanvas | 29 testes aprovados | `GraphCanvas.autoLayout.test.tsx`; novo teste apresentou RED por render extra antes da callback estável e GREEN depois. |
| Store/Board/nota visual | 89 testes aprovados em cinco arquivos, reportados pelo executor do lote | `BoardCanvas`, `boards/store`, `boards/store.viewport`, `workspace/store` e `workspace/store.visualValidation`. |
| Adapter adiado e integração de salvamento | 72 testes aprovados em cinco arquivos | `selectiveJSONStorage` (26), `workspace/store.persistence` (10), `Notes` (6), `CloudLiveSync` (6) e `CloudStatus` (24); inclui RED/GREEN para backup limpo, troca de owner, edição durante download/logout e graph pendente fora do resgate. |
| Comentários | 3 testes aprovados, reportados pelo executor principal | Estado de ACK/erro e retry explícito sem effect-flush automático. |
| Sincronização cloud integrada | 2 testes aprovados, reportados pelo executor principal | Harness passou a aguardar a barreira de persistência do workspace. |
| Bridge e demais grupos alterados | Incluídos no fechamento integrado abaixo | A suíte principal cobre `VisualWorkspaceBridge.test.tsx` e os demais grupos do snapshot funcional. |

Comandos focados executados durante o desenvolvimento:

```powershell
npx vitest run src/visuals/domain.performance.test.ts src/visuals/domain.test.ts src/visuals/advancedRequest.test.ts src/visuals/advancedGeneration.test.ts
npx vitest run src/components/GraphCanvas.autoLayout.test.tsx
npx vitest run src/cloud/CloudStatus.test.tsx src/workspace/store.persistence.test.ts src/data/selectiveJSONStorage.test.ts src/cloud/CloudLiveSync.test.tsx src/workspace/Notes.test.tsx
```

Pontos de aceitação para a integração de persistência: coalescer antes da serialização; manter “Salvando…” até confirmação; mostrar erro e permitir retry explícito; preservar edição nova durante escrita/falha anterior; drenar antes de leitura, backup e saída de conta; impedir adoção remota enquanto houver edição pendente; manter guardas na troca de proprietário. Testes com mocks de transporte verificam esses contratos, sem constituir um ensaio de rede ou criptografia real.

Fechamento integrado do snapshot `7d06dec`, informado pelo executor principal:

| Verificação | Resultado confirmado |
| --- | --- |
| Suíte principal | 2.019 testes aprovados e 8 ignorados; 201 arquivos aprovados e 2 ignorados. |
| Gateway | 226 testes aprovados e 1 ignorado. |
| Build padrão do repositório | TypeScript e Vite aprovados. |
| Checks de bundle | Aprovados. |
| Revisão de whitespace do lote de persistência | `git diff --check` sem erros. |

Esses resultados são históricos e pertencem ao snapshot indicado; não são inferidos dos grupos focados. O fechamento da segunda rodada consta a seguir, separado para não somar execuções sobrepostas.

### Segunda rodada — fechamento funcional final

Resultados focados e de compilação informados pelo executor principal após as correções de GraphCanvas e base64:

| Verificação | Resultado confirmado |
| --- | --- |
| GraphCanvas | 32 de 32 testes focados aprovados, incluindo `adoptUserNodes` real com 500 nós e preservação de `measured`/identidade dos conceitos. |
| Criptografia portátil | 16 de 16 testes aprovados para as APIs nativas/fallback, canonicalidade estrita e limites. |
| Repositório cifrado | 19 de 19 testes aprovados. |
| Build do App e fixtures tipadas | Aprovados. |
| Fixtures de carga | Quatro variantes recompiladas; 60 assets identificados por tamanho e SHA-256 no inventário vinculado na terceira bateria. |
| `npm run test:all` — suíte principal final | 2.031 testes aprovados e 8 ignorados; 201 arquivos aprovados e 2 ignorados. |
| Gateway final | 226 testes aprovados e 1 ignorado. |
| TypeScript do App | `tsc -b` aprovado. |
| Verificação tipada das fixtures | Aprovada. |
| Checks do repositório e de bundle | Aprovados. |
| Revisão de whitespace | `git diff --check` sem erros. |

A execução ampla anterior encontrou uma falha de determinismo no teste de clipboard. A correção ficou no teste: callback dentro de `act`, inspeção do DOM fora do callback, sem alteração de produção. O grupo de três testes passou em duas execuções, e a suíte completa final acima passou depois da correção. Os resultados funcionais não substituem as medições de carga.

## Bateria 3 — carga no App compilado

O [fixture reproduzível](../../scripts/interaction-performance/README.md) monta o `App`, React Flow, stores, validação, persistência e compositor reais em um build Vite de produção, com uma entrada de benchmark própria. Não é a página publicada nem uma sessão autenticada.

### Carga e isolamento

- Plano sintético com 500 nós; os nós adicionados possuem texto de contexto para tornar a serialização relevante.
- Nota com 100.000 pontos de tinta e um bloco textual.
- Board com 100.000 pontos de tinta e 20 modelos de 128 formas cada, posicionados fora da vista inicial.
- Origin local separado, dados sintéticos e configuração de provider sem credencial utilizável. CSP `connect-src 'none'` bloqueia conexões de rede; nenhuma chamada de LLM integra o ensaio.

O fixture reidrata somente seu próprio origin e substitui seu estado sintético. Usar perfil/origin novo; não abrir no origin de uma aplicação com dados pessoais. Baseline e candidato devem usar o mesmo fixture e a mesma carga. A revisão baseline precisa ser congelada por referência Git explícita, e a árvore candidata deve ficar estável durante compilação e coleta.

### Protocolo

1. Baseline congelado na revisão `73e3374`; candidato na revisão de código `2627abc68662175e7142f844f3d9282c6dab84fb`. Os hashes dos quatro builds constam no inventário de assets.
2. Variantes comuns compiladas com `npx vite build --config scripts/interaction-performance/vite.config.ts --mode baseline` e `--mode candidate`; variantes cifradas com a configuração complementar. As quatro foram servidas em `http://127.0.0.1:5198`.
3. Coleta em aba em primeiro plano, sem builds ou suítes simultâneos, com viewport CSS de 1.280 × 720 e DPR efetivo aproximadamente 1. No baseline cifrado, o zoom de navegador de 80% foi compensado por emulação 1.024 × 576 e escala 1,25 para manter o mesmo viewport CSS/DPR. As diferenças foram corrigidas antes de todas as amostras válidas.
4. Três amostras por cenário/variante: baseline → candidato nas rodadas 1 e 3, candidato → baseline na rodada 2. Aquecimento da rodada 0 e todas as rodadas preliminares/perfis abaixo de 0 foram excluídos. Um resultado de aquecimento antigo foi detectado por conferência de `kind`/prontidão e excluído.
5. Automação por cliques na UI, aguardando botões liberados e um novo JSON do tipo solicitado, com polling de 750 ms. Os botões acionam stores reais, mas não reproduzem o trajeto completo de teclado, mouse ou caneta física. Um perfil adicional de digitação foi coletado separadamente e excluído das medianas.

Cada botão abre a superfície pertinente, espera 20 frames e executa 60 alterações, uma por frame: alternar seleção de nó, atualizar viewport do Board ou editar o bloco da nota. Baseline usa sua ação existente de documento completo para viewport; candidato usa a API específica quando disponível. Depois são aguardados os flushes de grafo/workspace e mais um frame.

### Significado das métricas

| Campo | O que mede |
| --- | --- |
| `synchronousUpdateP50/P95` | Trecho síncrono da ação do store, incluindo trabalho executado naquele trecho. Trabalho React/persistência adiado pode aparecer nas outras métricas. |
| `frameP50/P95` | Intervalos entre callbacks `requestAnimationFrame` durante as 60 alterações; cadência da thread, sem prova de apresentação física. |
| `longTasks` / `longTaskMax` | Long Tasks observadas após o aquecimento e até o encerramento, incluindo a drenagem final. |
| `elapsedMs` | Janela de execução mais flush final; não comparar com o custo síncrono como se fossem o mesmo indicador. |

Os modelos fora da tela mantêm conteúdo de custo significativo nos documentos; este caso não mede órbita de 20 modelos visíveis nem substitui o ensaio anterior de draw calls. A fixture não coleta tempo de GPU.

### Segunda rodada — diagnóstico PRELIMINAR, excluído da comparação final

O ensaio complementar cifrado com workspace sintético de 3 MiB revelou bloqueios longos mesmo depois das primeiras correções. Uma observação preliminar da rajada apresentou os valores abaixo e orientou a segunda rodada. Ela não integra as 30 amostras válidas finais:

| Observação preliminar da rajada cifrada | Baseline | Candidato da primeira rodada |
| --- | ---: | ---: |
| Janela total | aproximadamente 24,8 s | aproximadamente 3,96 s |
| Maior Long Task | 2.056 ms | 879 ms |

Os valores ficam **excluídos da tabela final de resultados**. A diferença observada orientou a investigação, mas uma Long Task de 879 ms ainda representa bloqueio importante da thread de interface e não satisfaz o objetivo de uso fluido.

Um perfil de CPU preliminar do candidato, em uma janela de aproximadamente 3,07 s, atribuiu **1.209 ms de tempo próprio a `unb64` e 837 ms a `b64`**. Tempo próprio corresponde ao trabalho da função amostrada; não é tempo de GPU nem latência física de entrada. O perfil apontou a conversão/validação de base64 como alvo da segunda rodada, sem autorizar remoção das barreiras de integridade ou dos limites criptográficos.

Na carga de 500 nós também foi confirmado um problema separado: a adoção dos nós pelo GraphCanvas descartava dimensões já medidas. A fonte corrigida preserva `measured` e a identidade dos conceitos compatíveis, com 32 testes focados aprovados, incluindo o caminho real de adoção de 500 nós. A coleta final abaixo mede o conjunto das correções; não isola a contribuição dessa mudança.

As fontes de base64 também estão estabilizadas: o caminho usa APIs nativas quando disponíveis e fallback em chunks de 8.190 bytes. A canonicalidade não exige recodificar o conteúdo decodificado; confere alfabeto, padding terminal e bits não utilizados, preservando os limites. Os testes portáteis e do repositório indicados na segunda bateria passaram. Esses resultados funcionais não substituem a medição do custo da cadeia cifrada completa.

O App e as fixtures tipadas passaram na compilação, as quatro fixtures foram recompiladas e a coleta final alternada foi concluída. Nenhuma melhoria de GPU, tablet, entrada física ou conta de produção é deduzida das observações preliminares ou finais.

### Identificação e resultados finais

Os [dados de amostras e perfil](data/client-interaction-2026-10-11-samples.json) preservam 18 amostras comuns e 12 cifradas, totalizando 30. O [inventário de assets](data/client-interaction-2026-10-11-assets.json) registra tamanho e SHA-256 de 60 arquivos dos quatro builds; ambos identificam as mesmas revisões de baseline/código candidato.

| Metadado | Valor registrado |
| --- | --- |
| Baseline compilado | `73e337432ef6cb7bbb8ba4352c5045e3a2197dc0`. |
| Código candidato compilado | `2627abc68662175e7142f844f3d9282c6dab84fb`. |
| Coleta válida | 11/10/2026, de 16:17:43.624Z a 16:22:07.162Z. |
| Navegador/sistema | Chrome 155.0.0.0, Windows x64. |
| CPU/RAM | Intel Core i7-13650HX; 34.065.997.824 bytes de memória física (aproximadamente 31,7 GiB). |
| Node.js | v24.18.1. |
| Origin/viewport | `http://127.0.0.1:5198`; CSS 1.280 × 720; DPR efetivo aproximadamente 1, com a compensação de zoom descrita no protocolo. |
| Base64 nativo | Encode/decode nativos disponíveis neste navegador. O desempenho do fallback não foi medido nesta coleta. |
| Amostragem | Três amostras por cenário e variante, com ordem invertida na segunda rodada. |
| Condições não instrumentadas | Limitação térmica e energética. |

Hashes dos bundles de entrada; o inventário vinculado contém os demais arquivos:

| Bundle | SHA-256 |
| --- | --- |
| `baseline/assets/index-DbvlwWll.js` | `19055d4f9f9626ebb7bf7b3c0805c29aa753d3cec6e9c09c337f5d9ca4a02b0c` |
| `candidate/assets/index-hDbS5Ie1.js` | `2886d4a2bcbc3c3cb78d4de4fb869e8e73906ecc39d71bbbb18d99f9775448b9` |
| `encrypted-baseline/assets/encrypted-Cm3sFgIh.js` | `98fd9b45395cf779c555f080e860c3695e32a4577a5c1289b47debac25761cc0` |
| `encrypted-candidate/assets/encrypted-mdnvf2sX.js` | `29f033cc7695a02b5e04ded56017e1cb4059f740859cd062a68ace1992bf9645` |

Medianas calculadas separadamente sobre as três amostras de cada variante. Todos os tempos são milissegundos; as faixas mostram mínimo–máximo, não intervalos de confiança. A redução é `100 × (1 − mediana candidata / mediana baseline)`.

| Caso | `elapsedMs` baseline | `elapsedMs` candidato | Redução da mediana | Faixa baseline → candidato |
| --- | ---: | ---: | ---: | --- |
| Seleção, 60 alterações | 17.435 | 1.773 | 89,83% | 17.061–17.506 → 1.649–1.808 |
| Viewport, 60 alterações | 10.940 | 2.129 | 80,54% | 10.447–11.591 → 2.056–2.162 |
| Digitação, 60 alterações | 9.328 | 1.373 | 85,28% | 8.875–9.709 → 1.282–1.416 |
| Rajada cifrada, 10 alterações | 25.180,7 | 1.112,7 | 95,58% | 23.599,1–26.987,1 → 1.057–1.125,1 |
| Polling cifrado, 3 leituras idênticas | 100,1 | 106,5 | Sem conclusão de ganho | 93,7–118,7 → 87,7–114,8 |

O polling teve faixas sobrepostas. Três amostras por variante não sustentam uma conclusão de ganho ou regressão nesse caso. Nos quatro cenários de edição, as faixas observadas ficaram separadas, mas continuam restritas à carga sintética e ao ambiente descritos.

| Caso | CPU síncrona baseline p50/p95 | CPU síncrona candidato p50/p95 | Mediana de frame p95 baseline → candidato | Mediana de Long Tasks baseline → candidato | Maior Long Task do candidato nas três amostras |
| --- | --- | --- | --- | --- | ---: |
| Seleção | 0,2 / 0,2 | 0,1 / 0,2 | 437,5 → 37,5 | 109 → 0 | 0 |
| Viewport | 111,3 / 121 | 0,1 / 0,2 | 187,6 → 106,4 | 60 → 16 | 102 |
| Digitação | 104 / 122,1 | 0,1 / 0,2 | 156,5 → 100,1 | 60 → 10 | 109 |
| Rajada cifrada | 4,7 / 4,8 | 0 / 0 | 1.738 → 25,1 | 18 → 5 | 198 |
| Polling cifrado | 0 / 0 | 0 / 0 | 26,2 → 31,1 | 0 → 0 | 0 |

Cada p50/p95 da tabela é a mediana do respectivo campo nas três execuções, não um percentil recalculado pela junção de todos os frames. Zero em tempo síncrono é o valor arredondado registrado pelo fixture, não ausência de trabalho. Seleção já tinha uma ação de store curta no baseline; o ganho da janela total aparece no trabalho posterior e na cadência de frames. Adiar serialização também desloca trabalho para além da ação síncrona, motivo para conservar `elapsedMs`, frames, Long Tasks e flush final na análise.

### Confirmação e contadores da cadeia cifrada

Todas as 12 amostras cifradas registraram `durableVerified: true`. Isso confirma a verificação durável prevista pelo fixture com cofre sintético; não simula queda de energia ou toda condição de falha de uma conta real.

Os contadores da rajada foram iguais nas três execuções de cada variante:

| Contador por rajada | Baseline → candidato |
| --- | --- |
| Escritas do workspace | 10 → 1 |
| Checkpoints do runtime | 12 → 3 |
| Checkpoints do transporte | 3 → 3 |
| PUT do cofre | 1 → 1 |
| Decode de base64 grande | 45 → 6 |
| Encode de base64 grande | 61 → 7 |
| Bytes de entrada de encode base64 | 662.819.523 → 49.797.642 |
| Caracteres de entrada de decode base64 | 659.632.944 → 62.149.420 |

O candidato coalesceu as dez edições em uma escrita de workspace e manteve os três checkpoints do runtime e os três do transporte dessa revisão enviada. Os contadores não indicam remoção de barreiras de journal/receipt. No polling, ambas as variantes fizeram três GETs do cofre, sem escrita de workspace nem checkpoints, coerente com a ausência de ganho demonstrado nesse caso.

### Perfil final adicional — excluído das medianas

Após as 30 amostras, uma execução adicional de digitação registrou `elapsedMs` de 1.303 ms. Ela está marcada como excluída no JSON e não integra as medianas acima. Seu resumo CDP contém estes tempos próprios:

| Entrada do perfil | Tempo próprio | Correspondência de source map |
| --- | ---: | --- |
| Callback de drenagem contendo `JSON.stringify(entry.value)` | 559,69 ms | `candidate/assets/index-hDbS5Ie1.js`, linha 105, coluna 12909 → `src/data/selectiveJSONStorage.ts`, linha 136, coluna 40. O callback começa na linha 136; a chamada de serialização está na linha 139 do source map. |
| `put` nativo do IndexedDB | 339,59 ms | Operação nativa; sem posição TypeScript atribuída. |
| Callback `idb-keyval` de transação `readwrite` | 55,64 ms | Mesmo bundle, linha 63, coluna 7760 → `node_modules/idb-keyval/dist/index.js`, linha 50, coluna 37. |

A correspondência foi conferida manualmente no source map do bundle indicado, usando linhas a partir de 1 e colunas a partir de 0, como no JSON. SHA-256 do `.map` local usado: `1ed13bc827deedeaed63007b3930d96fc794c2066a7129747f812db82d2ebd2d`. O JSON preserva o resumo e as posições compiladas; não armazena o trace completo de CPU.

**A janela do perfil CDP inclui automação e esperas fora do `elapsedMs` do fixture.** Não se somam esses tempos para obter uma porcentagem causal da janela de 1.303 ms. A atribuição identifica caminhos ainda caros — serialização do envelope e persistência IndexedDB —, sem decompor isoladamente o ganho de cada correção.

## Limites e próximos passos

### Auditoria estática da escrita cifrada e fixture complementar

No caminho protegido com persistência offline, [prepareOfflineSession](../../src/cloud/offline/session.ts) conecta runtime e transporte ao mesmo [OfflineRepository](../../src/cloud/offline/repository.ts). Uma operação online normal, sem retry ou conflito, passa por três checkpoints do [CloudRuntime](../../src/cloud/runtime.ts): rascunho enfileirado, base/identidade antes do PUT e remoção da operação após ACK. O [VaultTransport](../../src/cloud/vault/transport.ts) registra outros três: ciphertext antes do envio, receipt após ACK e limpeza do receipt após confirmação durável do runtime. São **3 + 3 barreiras identificadas estaticamente**, não uma contagem medida nem uma indicação de que podem ser removidas: elas preservam recuperação e identidade de retry.

A janela de 200 ms coalesce snapshots antes de entrar nesse backend. Ela não coalesce os checkpoints internos já capturados; as filas de persistência dos journals conservam suas gerações. Na árvore perfilada da primeira rodada, a escrita serializa o envelope completo, o manifesto e os checkpoints. O transporte clona o manifesto por JSON e valida envelopes de documentos antes de cifrar a nova revisão. O repositório serializa cada checkpoint, envolve esse JSON em outro JSON, cifra, grava e relê o IndexedDB, decifra e compara para confirmar. O readback valida o envelope fora e dentro de `decrypt`, além do decode necessário à operação criptográfica; naquela árvore, a validação canônica de base64 também reconverte os bytes. Web Crypto é assíncrono, enquanto JSON, UTF-8 e base64 fazem passagens síncronas por conteúdo grande. O perfil preliminar quantifica tempo próprio em duas dessas funções, sem isolar a contribuição causal de cada passagem. A coleta final mede o conjunto das correções estabilizadas.

O teste existente [transport.test.ts](../../src/cloud/vault/transport.test.ts) com `-t "large base64"` cobre polling idêntico de 1 MiB usando criptografia/repositório reais: não equivale a uma carga de edições contínuas. Testes de runtime, transporte e repositório também cobrem coalescência, resposta perdida, receipt durável, falha de checkpoint e readback corrompido. A otimização de base64 preserva essas barreiras, cobertas pelo fechamento funcional final.

A fixture adicional [encrypted.html](../../scripts/interaction-performance/encrypted.html), [entry](../../scripts/interaction-performance/encrypted-main.tsx) e [config](../../scripts/interaction-performance/encrypted.vite.config.ts) mantém o adapter de workspace padrão e executa a cadeia real com dono/cofre/chave sintéticos gerados no navegador e fetch estritamente em memória. O App usa um workspace inicial de 3 MiB, com 20 modelos fora da tela de 128 objetos, nota editável pequena e padding ASCII separado. Há três polls idênticos e uma rajada de dez edições, com timer natural e flush final. Setup/KDF, aquecimento e verificação final ficam fora da janela; checkpoints, criptografia, base64, IDB e confirmação ficam dentro. As outras stores ficam em memória para isolar a cadeia medida. A limpeza remove somente os dois slots do dono/cofre aleatórios desta página. Comandos e API de coleta estão no [README](../../scripts/interaction-performance/README.md).

As medições cifradas finais, hashes e contadores constam na terceira bateria e nos JSONs vinculados. Nenhum resultado quantitativo foi inferido da auditoria estática. O servidor em memória ainda executa seu JSON no processo do navegador e não reproduz latência/CPU de um servidor real.

O lote removeu fontes demonstradas de CPU redundante e reduziu a janela total dos quatro cenários de edição medidos. Ainda houve Long Tasks de até 109 ms na digitação, 102 ms no viewport e 198 ms na rajada cifrada. Documentos grandes continuam passando por serialização e persistência na thread principal; coalescer reduz a frequência e desloca o trabalho, sem tornar o envelope incremental. O perfil adicional aponta esses caminhos como próximos alvos. Avaliar serialização/persistência em worker ou armazenamento por entidade exige preservar journals, identidade de operações, readback, confirmação, retry e barreiras de transição. São próximos trabalhos, não alterações entregues ou ganhos já medidos neste lote.

Não há ensaio em Galaxy Tab S9, celular, entrada física prolongada ou sessão de conta real nestas fixtures. A fixture inicial exclui criptografia e armazenamento cifrado; a complementar inclui a cadeia cifrada real com cofre sintético. Ambas excluem rede real e estado de uma conta de produção. Seus resultados não demonstram fluidez global em produção ou no tablet. Não há redução de detalhes dos artefatos nem alteração de regras de planejamento para acelerar os números.

Duas revisões finais independentes, somente leitura, não encontraram bloqueadores nas fontes/evidências revisadas. Confirmaram as 30 amostras, os 60 assets e as guardas de confirmação diante de edições concorrentes. Revisão estática, testes e fixtures locais não substituem validação em tablet, entrada física ou conta de produção.

As três baterias locais estão fechadas com as limitações descritas. A publicação e o estado do deploy serão confirmados separadamente no Railway após a integração; este relatório não registra uma implantação nem usa desempenho local como evidência de fluidez da aplicação publicada.

# Fluidez do cliente — 11/10/2026

Rodada motivada por lentidão na interface inteira e no pan/zoom do canvas. Abrange o custo de CPU que acompanha o grafo, os compositores e os artefatos Three.js/React/SVG; não é um ensaio físico de desempenho em todos os aparelhos. A [proposta de processamento no aparelho](../design/client-rendering-performance.md) registra as referências primárias e os pilotos seguintes.

## Diagnóstico e mudanças

| Causa observada | Mudança | Invariante verificado |
| --- | --- | --- |
| Zustand serializava envelopes completos mesmo com alteração apenas de seleção, lente ou navegação | Adapter compara os campos imutáveis de conteúdo antes de serializar; ponte do planner ignora alterações isoladas de UI | Rascunhos reais continuam persistidos/restaurados; troca de projeto captura seleção/lente atuais |
| Cada nó repetia ordenação de irmãos e resolução de subárvores para sequência/bloqueio/conclusão | Índice compartilhado por identidade dos nós/arestas; dados de apresentação dos cards reutilizados | Regras originais de conclusão, ordenação, falhas e referências; câmera aguarda adoção da lente |
| Atualização de uma aba renderizava os outros compositores; foco repetido elevava a janela novamente | Sessões memoizadas por aba, drafts próprios e foco idempotente | Operações ocultas permanecem montadas, concluem e restauram sem reenvio |
| O nó de cada artefato acompanhava toda a transformação da câmera e revalidava a cena inteira | Assinatura somente do limiar de zoom da barra; cache por cena/contrato imutáveis, exclusivo da renderização | Edições invalidam o resultado; ações e exportação continuam usando os validadores originais |
| Movimentos da caneta reconciliavam todos os traços já concluídos | Traços memoizados e seleção delegada no SVG das notas | Pressão, geometria, filtros, seleção, movimento, apagar e desfazer preservados |
| Polls idênticos do cofre decodificavam novamente o manifesto e regravavam o checkpoint criptografado | Comparação exata do conteúdo já autenticado antes do trabalho pesado; checkpoint somente quando necessário | Cada poll continua fazendo uma requisição; dados novos, conflitos e falhas locais continuam validados |

Estado de interação permanece em memória. A seleção/lente mais recente acompanha o próximo snapshot de conteúdo ou a troca de projeto; um clique isolado não regrava o documento inteiro. Não há mudança do formato dos documentos, das permissões ou da criptografia.

A revisão de durabilidade acrescentou regressões para falha/retry, fila em voo e troca de sessão. Escritas do grafo retêm o runtime original e o rascunho pendente; a fila local do workspace captura IndexedDB antes de aguardar. Leituras que terminam sob outro runtime são rejeitadas. Isso evita aplicar ou enviar envelopes de uma sessão no backend de outra.

## Medições delimitadas

### Persistência durante interação

Fixture sintética com 1.740.000 caracteres de contexto, sem dados do usuário. Sequência de 120 ações: 40 seleções, 40 trocas de lente e 40 navegações. Medição síncrona da sequência, incluindo serialização; não inclui transmissão de rede nem pintura do navegador.

| Indicador | Antes | Depois |
| --- | ---: | ---: |
| Serializações de envelopes | 200 | 0 |
| Gravações no repositório | 120 | 0 |
| Tempo da sequência | 1.466,14 ms | 1,08–4,60 ms |

O intervalo posterior corresponde a execuções locais com cargas concorrentes distintas. As contagens são a regressão exigida pelo teste; o tempo não é um limite de aprovação. Reproduzir com `npm test -- src/workspace/planner.persistence.test.ts --maxWorkers=1 --no-file-parallelism`. O teste também confere gravação/restauração de uma edição real e retorno ao projeto anterior.

### Metadados do grafo

Node 24.18.1, Windows 11, Intel i7-13650HX; Vitest/jsdom. Grafo largo com passos irmãos não resolvidos, uma rodada de aquecimento e cinco amostras. O baseline chama as funções de domínio originais para cada nó; o índice novo calcula os mesmos campos e verifica equivalência. Cópia da fixture fora da cronometragem.

| Nós | Cálculo original, mediana | Índice novo frio, mediana |
| ---: | ---: | ---: |
| 100 | 14,09 ms | 0,40 ms |
| 300 | 145,32 ms | 0,54 ms |
| 1.000 | 2.100,64 ms | 1,80 ms |

Reuso do índice abaixo de 0,001 ms por chamada neste protocolo. Reproduzir com `npm run bench:planner -- scripts/node-presentation.bench.ts`. O comando grava amostras e ambiente em `.codex-audit-planning-performance/node-presentation-latest.json`, ignorado pelo Git. Não inclui layout, React, GPU, persistência, rede ou FPS; não expressa um ganho equivalente da aplicação inteira.

### Abas do estúdio

React Profiler com o componente real: editar uma aba causava dois commits em cada aba alheia; após isolar as sessões, zero commits nessas abas. Trinta focos consecutivos da janela frontal causam zero notificações; trazer uma janela de trás para frente causa uma. O teste também conclui uma geração escondida e restaura a proposta sem abortar ou repetir o pedido.

Reproduzir com `npm test -- src/visuals/ui/TabbedVisualExplorer.performance.test.tsx src/visuals/ui/sessionStore.test.ts --maxWorkers=1 --no-file-parallelism`.

### Cena 3D durante navegação

O teste do nó real reproduziu 60 renderizações para 60 movimentos de câmera. Após usar uma assinatura granular, foram zero renderizações do nó e zero serializações da mesma cena. O renderer WebGL continua recebendo a transformação e desenhando a vista. Trocar cena, contrato ou referências invalida o cache; os validadores usados em ações e exportação permanecem sem cache.

Microbenchmark com 20 artefatos de 512 objetos cada, Node 24.18.1 no mesmo i7-13650HX, três atualizações por amostra e cinco amostras:

| Conteúdo da cena | Validação original por atualização, mediana | Cache de renderização, mediana |
| --- | ---: | ---: |
| Primitivas | 18,13 ms | 0,0083 ms |
| Oito malhas buffer por artefato | 28,22 ms | 0,0052 ms |

Reproduzir com `npm run bench:planner -- scripts/visual-validity.bench.ts`; saída em `.codex-audit-planning-performance/visual-validity-latest.json`. A medição isola validade em CPU; exclui React, pintura e GPU. O cache exige o padrão imutável já utilizado pelo editor.

### Traços concluídos

Benchmark reproduzível com o componente real instrumentado em memória: React 18 em modo de desenvolvimento, jsdom, 32 pontos por traço, 30 atualizações. O baseline remove a memoização e recria callbacks como no caminho anterior; a versão posterior reutiliza os traços e callbacks. Mil traços pertencem ao ensaio do renderer compartilhado de notas/plano; o Dynamic Board limita o documento a 200 itens.

| Mil traços salvos | Antes por atualização, mediana | Depois por atualização, mediana |
| --- | ---: | ---: |
| Caneta | 37,39 ms | 6,93 ms |
| Lápis | 124,91 ms | 7,93 ms |

Nos 30 movimentos, as renderizações adicionais dos traços salvos caem de 30.000 para zero. A geometria já era memoizada no baseline; a correção elimina reconciliação React/DOM, sem mudar o traço. Reproduzir com `node scripts/ink-rendering.bench.mjs`; saída em `.codex-audit-planning-performance/ink-rendering-latest.json`. Não mede pintura SVG, FPS, GPU ou latência de caneta física. Os filtros do lápis permanecem intactos.

### Polling do cofre sem alterações

O polling de dois segundos ainda processava todo o manifesto cifrado e regravava o checkpoint do runtime mesmo quando nada havia mudado. A decodificação base64, a serialização e a conferência da gravação local ocupavam a thread da interface. Agora, somente um envelope exatamente igual ao já autenticado evita essa decodificação; documentos e mídia também precisam corresponder integralmente à cópia confirmada e durável. Cada poll continua consultando o servidor. Dados novos e falhas continuam no caminho de validação completo.

Comparação no Chrome/Windows, mesmo notebook, Vite em desenvolvimento: baseline local `391fa18` na porta 5190 e correção no worktree na porta 5197. Um documento sintético de 1.048.635 bytes e manifesto de 1.398.356 caracteres base64; três polls sequenciais com head idêntico. `VaultTransport`, `CloudRuntime`, AES-GCM e `OfflineRepository` são reais; o fetch injetado retorna o head sintético em memória, sem latência de rede ou dados da conta. Inicialização do cofre e primeiros checkpoints ficaram fora da medição.

| Indicador do ensaio local | Antes | Depois |
| --- | ---: | ---: |
| Tempo total dos três polls | 9.076,6 ms | 55,8 ms |
| Duração individual | 3.062,5 / 3.076,9 / 2.937,0 ms | 21,1 / 17,4 / 17,3 ms |
| Checkpoints redundantes do runtime | 3 | 0 |
| Checkpoints do transporte | 0 | 0 |
| Consultas ao fetch injetado | 3 | 3 |
| Long Tasks observadas na janela | 7 | 0 |

Uma execução por revisão, em primeiro plano. O resultado demonstra a remoção desse custo ocioso; não é uma medida de FPS, latência da rede, inicialização, edição concorrente, GPU ou desempenho geral do produto. A abertura e a adoção de conteúdo novo ainda percorrem as operações pesadas. Ao terminar, o fixture removeu e confirmou ausentes apenas os slots `runtime`/`transport` de owner e cofre aleatórios, sem tocar autorização ou dados existentes.

A regressão reproduzível está em [transport.test.ts](../../src/cloud/vault/transport.test.ts): `npx vitest run src/cloud/vault/transport.test.ts --maxWorkers=1 -t "large base64"`. No pipeline real com dois polls de 1 MiB, a versão anterior fazia dois checkpoints, oito decodes grandes e dez encodes grandes; a nova faz zero nos três indicadores, conservando ambas as consultas. Outros testes conferem falha/retry de checkpoint, autenticação recusada, conteúdo diferente sob a mesma revisão, mídia completa, cópias independentes e mutações do envelope durante autenticação. A limpeza de um aviso transitório também precisa tornar-se durável antes de habilitar o atalho.

### Observação na produção anterior

Na revisão `03ddb4d`, uma tentativa de zoom pelo controle real do canvas não concluiu a sequência planejada: o comando de entrada expirou. A instrumentação temporária de `requestAnimationFrame` e Long Tasks registrou 16 tarefas longas, 11.876 ms acumulados e intervalo p95 entre frames de 443,8 ms em 17,9 segundos. Isso confirma uma sessão com travamentos, mas a sequência interrompida não serve como comparação controlada de FPS antes/depois. A instrumentação foi removida, sem modificar conteúdo do usuário.

## Three.js e limites

A primeira bateria foi integrada em `391fa18` e publicada no Railway. O lote referente aos polls do cofre foi comparado em localhost antes da integração. Testar código ainda em desenvolvimento na página de produção não comprova sua correção; esses ensaios usaram dados sintéticos e ambientes locais separados.

O compositor atual já usa um contexto WebGL 2 compartilhado, transparência, recorte por viewport e renderização sob demanda. No Chrome do notebook desta rodada, o renderer reportou ANGLE/D3D11 com NVIDIA GeForce RTX 4060 Laptop GPU. Essa observação confirma aquele contexto, não o desempenho ou o suporte de um tablet/celular.

As duas primeiras baterias não removem geometria customizada, peças individuais, materiais, vista explodida nem detalhes do modelo salvo. Naquela etapa, instancing, preparação em Worker, orçamento adaptativo de pixels e WebGPU ainda eram pilotos propostos. O ensaio adicional de instancing abaixo registra sua implementação e limitações; Workers, orçamento adaptativo adicional e WebGPU continuam pendentes.

Ainda é necessário medir frames p50/p95, long tasks e latência de entrada em build de produção, com pan/zoom, digitação e inspeção 3D comparáveis; repetir no S9 com caneta física e em celular. Uma melhora em microbenchmarks não basta para encerrar a queixa de lentidão.

## Refinamento no mesmo compositor

O pedido de IA agora substitui somente o texto da caixa existente. Referências/anexos são preservados; texto vazio não refina; não há painel adicional nem geração automática. Editar o draft, fechar a ferramenta ou trocar projeto invalida o resultado pendente. Minimizar mantém o processamento.

Verificação focada inicial: 84 testes de serviço/UI aprovados. Em ensaio no Chrome com o componente real e resposta simulada, o texto mudou na única textarea existente, a contagem de gerações permaneceu em zero e limpar o texto desabilitou refinar/enviar. Não houve chamada de IA nem alteração de dados do usuário nesse ensaio. A revisão também cobre contrato de contexto, cancelamento, retorno tardio e envio manual posterior. A verificação integrada e a publicação são registradas ao concluir a rodada.

## Verificação integrada

A bateria ampla executou 195 arquivos: 191 passaram, dois foram pulados e dois precisaram de reexecução. Um mock de geração do Board não expunha `getCloudRuntime`, agora necessário pelo adapter; corrigido somente o mock e seus 13 testes passaram. O teste de integridade de backup excedeu 20 segundos sob carga concorrente; reexecutado isoladamente, os três testes passaram em 11,0 segundos, sem relaxar o timeout ou a validação criptográfica.

Após as mudanças finais, 78 testes focados do nó 3D/cache, desenho, persistência e geração passaram; outros 49 testes de persistência/workspace cobriram a revisão de owner. O gateway passou 226 testes, com um teste pulado e nenhuma falha. Testes live de provedores pagos não foram habilitados. Os comandos e limites dos benchmarks aparecem junto de cada resultado.

Uma reexecução final de oito arquivos do grafo, desenho, estúdio e refinamento passou 158 testes. Esses conjuntos se sobrepõem e suas contagens não devem ser somadas como testes únicos.

`npm run build` concluiu com TypeScript e Vite aprovados. `npm run check:repo` verificou 34 documentos, 824 links locais e sete fronteiras transitivas de módulos. A auditoria do bundle preserva o carregamento tardio de Board, compositor 3D e extração de anexos. Continuam existindo chunks de aplicação e Three.js acima de 500 kB; esta rodada não declara encerrada a otimização de carregamento.

O lote adicional do polling passou 111 testes em seis arquivos: runtime (40), transporte (45), repositório offline (16), sincronização (cinco unitários e dois de integração) e bootstrap offline (três). A revisão independente também verificou isolamento de referências, snapshots incompletos e durabilidade após falha.

Na integração desse lote, outros 41 testes passaram em quatro arquivos de bootstrap, concorrência entre transportes, retomada de sessão e adapters. O build de produção também passou novamente. A verificação local ocorreu antes de qualquer atualização da produção; a aba de uso do usuário não foi utilizada para validar o código ainda não integrado.

## Ensaio adicional: submissão de peças repetidas à GPU

A pesquisa examinou mecanismos públicos do Three.js Editor, PlayCanvas Editor, Babylon.js/Inspector e R3F/drei. [Referências, revisões e comparação arquitetural](../design/client-rendering-performance.md#referências-de-editores-3d-reais). Ela favoreceu evoluir o compositor existente: um contexto compartilhado e desenho sob demanda já estavam presentes. Trocar o motor não eliminaria por si só materiais/meshes individuais, preparação antecipada ou notificações irrelevantes.

O baseline `36bf93e` criava um material e um mesh para cada objeto, mesmo quando geometria e cor eram iguais. Vinte artefatos de 512 objetos resultavam em 10.240 chamadas de desenho por frame. [modelMeshes](../../src/visuals/rendering/modelMeshes.ts) agora agrupa ao menos quatro objetos opacos de geometria/cor/grupo móvel compatíveis em `InstancedMesh`. Mantém transformações, IDs, geometria customizada e tesselação. Escalas refletidas ficam individuais; durante atenuação por seleção, os lotes afetados usam meshes individuais para preservar a ordenação transparente. Limpar a seleção reutiliza os lotes.

### Protocolo e ambiente

React otimizado, React Flow, compositor, fábrica de modelos, geometria, Three.js e WebGL reais. Chrome 155/Windows no notebook i7-13650HX + RTX 4060 Laptop, ANGLE/D3D11, DPR 1, viewport 1.730 × 849, drawing buffer 1.178 × 492. Uma única aba em primeiro plano. Cargas sintéticas, sem conta, persistência, rede de API ou projetos do usuário. Somente fronteiras de mídia/decomposição não exercitadas foram substituídas para impedir hidratação de conta.

Cada rodada de interação dura aproximadamente 1,8 segundo. Preparação e aquecimento ficam fora dela; a etapa de preparação inclui 580 ms de espera deliberada e não deve ser interpretada como tempo puro de criação. Não havia builds/suítes nossas durante as rodadas reportadas. A primeira medição concorrente com uma compilação foi descartada.

Wrappers das APIs públicas WebGL contam draw calls e triângulos de todos os viewports; o tempo de CPU mede o callback que emitiu chamadas, incluindo submissão e instrumentação. **Não é tempo da GPU.** O monitor rAF mede cadência da thread, não apresentação física ou latência da caneta. O ensaio também foi repetido sem wrappers WebGL/getContext; nesse controle as contagens e o tempo de CPU do renderer ficam explicitamente indisponíveis.

[Dados das rodadas e hashes dos bundles/fontes](data/three-compositor-2026-10-11.json). O [fixture reproduzível](../../scripts/three-performance/README.md) prepara um novo ensaio local a partir de uma referência Git explícita; não recria automaticamente as condições históricas da máquina.

### Carga de caixas repetidas

Vinte modelos × 512 objetos, quatro cores, transformações variadas. Baseline e primeiro piloto usam exatamente o mesmo compositor, anterior à filtragem de eventos. Mediana das três medianas de CPU de órbita; pan/zoom são rodadas únicas:

| Indicador | Baseline | Instancing |
| --- | ---: | ---: |
| Chamadas por frame | 10.240 | 80 |
| Triângulos por frame | 122.880 | 122.880 |
| CPU por frame na órbita, mediana | 79,0 ms | 1,6 ms |
| CPU por frame no pan, p50 / p95 | 70,6 / 74,7 ms | 2,5 / 6,1 ms |
| CPU por frame no zoom, p50 / p95 | 73,0 / 81,0 ms | 2,2 / 3,4 ms |
| Repouso: frames com draw calls | 0 | 0 |

A redução de chamadas foi de 99,22%, mantendo os triângulos. As três medianas de órbita do baseline foram 89,4 / 79,0 / 71,5 ms; no piloto, 1,9 / 1,6 / 1,4 ms. Uma repetição posterior do baseline variou para 93,9 / 157,0 / 221,8 ms. Essa variação está preservada nos dados e impede tratar o quociente de tempos como um ganho universal. Não se identificou uma causa suficiente para atribuí-la a temperatura, GC ou carga externa.

Controle sem wrappers WebGL, três rodadas por versão, mesmos modelos/tamanho/aba:

| Indicador de cadência | Baseline sem wrappers | Piloto sem wrappers |
| --- | --- | --- |
| Intervalo rAF p50 por rodada | 74,9 / 75,0 / 92,4 ms | 6,3 / 6,3 / 6,3 ms |
| Intervalo rAF p95 por rodada | 81,2 / 106,3 / 112,7 ms | 6,4 / 6,4 / 6,4 ms |
| Long Tasks por rodada | 26 / 23 / 21 | 0 / 0 / 0 |

Ambos os controles sem wrappers contêm o mesmo filtro de invalidação inicial, anterior à correção de revisão. Durante órbita, esse filtro continua invalidando por mudanças reais e a comparação entre os dois controles isola o agrupamento de modelos. Comparar seleção irrelevante desses controles contra os bundles originais misturaria mudanças e não foi usado como resultado isolado.

### Formas mistas, ainda repetidas

Caixas, cilindros, esferas e toros, 512 objetos por modelo, com quatro combinações de forma/cor repetidas. Uma rodada de órbita por carga/versão, instrumentada:

| Modelos | Chamadas/frame antes → depois | Triângulos/frame, iguais | CPU p50 antes → depois | CPU p95 antes → depois |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 512 → 4 | 236.032 | 5,2 → 0,5 ms | 7,1 → 0,8 ms |
| 8 | 4.096 → 32 | 1.888.256 | 36,0 → 1,2 ms | 39,7 → 2,1 ms |
| 20 | 10.240 → 80 | 4.720.640 | 84,5 → 2,1 ms | 93,9 → 3,1 ms |

Vinte modelos tiveram 22 Long Tasks antes e zero depois. Cada modelo permanece dentro do orçamento de geometria existente. Isso amplia o ensaio para mais formas, mas continua favorecendo repetição; não demonstra o mesmo ganho em malhas únicas, muitos materiais distintos ou grupos móveis que não podem ser agrupados.

### Filtragem de notificações irrelevantes

O compositor recebia todas as notificações dos stores React Flow/controles 3D. Agora compara viewport, retângulos e controles dos modelos presentes, copiando escalares para suportar mutações internas do React Flow. Reconciliação atualiza a base dos comparadores. Resize, mídia tardia, transições e restauração de contexto continuam solicitando desenho.

A revisão independente encontrou um caso de snapshot antigo após trocar os artefatos: resetar o zoom do novo modelo podia coincidir com os valores do modelo anterior e ser ignorado. Três regressões reproduziram isso antes da correção; o rebase cobre troca de ID e atualização de retângulo mantendo o ID.

No bundle final, com os mesmos vinte modelos mistos, alternar `selectionKeyPressed` por 1,8 s emitiu **zero frames/chamadas de desenho**; repouso também ficou em zero. Pan, zoom e órbita continuaram desenhando 80 chamadas/frame e 4.720.640 triângulos/frame. CPU p50 foi 2,4 / 2,3 / 1,8 ms, respectivamente; não houve Long Tasks nessas rodadas. O pan teve intervalo rAF p95 de 12,6 ms e máximo de 49,8 ms: não foi uma cadência absolutamente constante.

### Limites e próximos gargalos

- O ganho medido é de cenas sintéticas repetitivas no notebook. Ainda faltam modelos reais grandes, material/transparência variados, sessão prolongada e S9/celular com entrada física. Não se declara resolvida a lentidão de toda a aplicação.
- O compositor ainda prepara modelos fora da tela e serializa identidades de cenas durante reconciliação. Uma mudança real numa vista ainda limpa/desenha todas as vistas visíveis; apenas pular vistas limpas apagaria seus pixels. Cache por vista exige composição e orçamento explícito de memória.
- Recursos ainda pertencem a cada artefato; não há pool entre cópias. Instancing reduz materiais e submissões compatíveis, mas adiciona matrizes de instância. Contadores de buffers/heap não são VRAM total nem comprovam ausência de vazamentos.
- Backups grandes continuam realizando conversões/canonicalizações repetidas de base64. A alocação intermediária encontrada nesta bateria foi corrigida conforme abaixo; a repetição dessas operações ainda merece avaliação separada. Limites e validação criptográfica permanecem intactos.
- Workers de geometria/decodificação, orçamento adaptativo adicional de pixels, cache FBO e WebGPU continuam candidatos sujeitos a benchmark. Não houve mudança para renderização no servidor.

### Conversão de envelopes grandes

A primeira suíte ampla encontrou o teste de splice de chunks de backup acima de 20 s; reexecuções também excederam o timeout. A fixture usa 16 MiB + 1 byte, duas exportações e importação com o último chunk trocado entre pacotes. A inspeção localizou `Uint8Array.from(atob(value), callback)`: a conversão de um iterável grande cria trabalho e intermediários antes de produzir os bytes. Testes diagnósticos com Blob nativo/Node e FileReader/JSDOM concentraram o custo em decodificação/decriptação, e não nas leituras; houve carga concorrente nesses diagnósticos e seus tempos não são uma comparação controlada entre ambientes.

[unb64](../../src/cloud/vault/crypto.ts) agora aloca o array de bytes diretamente e copia os code units Latin-1 retornados por `atob`. O limite de tamanho decodificado é conferido antes da alocação. Regex, limite do texto codificado, reconversão canônica, validações repetidas de envelope, AES-GCM, AAD e derivação de chave não foram removidos ou relaxados. Isso não muda formato, chaves ou dados persistidos.

O teste de backup original, sem alterar os 20 s ou a carga, passou em 7,055 s na primeira reexecução após a mudança. O arquivo inteiro passou três testes; mais seis testes de criptografia passaram. As novas verificações cobrem todos os valores de byte através do limite de 8.192 bytes, padding não canônico, alfabeto inválido, vazio e limites codificados/decodificados. Esse resultado é regressão do caso que estourava o timeout, não benchmark geral de importação em todos os aparelhos.

### Revisão e fixtures de persistência

Duas revisões independentes examinaram batching, propriedade de recursos, transparência e contrato de montagem. O filtro recebeu a correção P2 descrita acima e passou 16 testes de ciclo de vida. A decodificação recebeu revisão independente de equivalência de bytes/limites/autenticação, sem achados adicionais.

A bateria ampla inicial executou 200 arquivos: 193 passaram, dois foram pulados e cinco falharam (seis testes e um erro não tratado). Além do timeout de backup, quatro arquivos de testes ainda interceptavam a antiga fachada de persistência ou trocavam owner antes de drenar a fila do grafo. As mesmas falhas foram reproduzidas no `36bf93e` limpo. As fixtures agora interceptam o backend IndexedDB realmente capturado e aguardam o flush correto. Mantêm exigências de erro/ordenação e verificam a gravação real após retry/liberação. Seus 35 testes passaram sem erro não tratado; não houve alteração de runtime para contornar esses testes.

### Verificação final deste lote

`npm test -- --maxWorkers=3` concluiu em 371,44 s: **198 arquivos aprovados, dois pulados; 1.945 testes aprovados e oito pulados**. Os testes pulados são integrações live com provedores, não habilitadas nesta execução. Inclui os quatro testes novos de instancing, os 16 de ciclo de vida e os casos de criptografia/persistência acima. O teste pesado de backup passou também na suíte ampla: três casos em 12,647 s, mantendo o timeout original. Não houve falha nem erro não tratado.

`npm run build` aprovou TypeScript e Vite novamente após a alteração de base64 (Vite: 39,90 s). Permanecem os avisos de chunks acima de 500 kB: Three.js em 565,46 kB e App em 668,65 kB, antes de gzip. `npm run check:bundle` passou, sem módulos de funcionalidades carregados antecipadamente (`eagerFeatureModules: []`). Essa auditoria foi executada antes da mudança local no corpo de `unb64`, que não altera imports ou fronteiras de carregamento.

`npm run bench:three -- --baseline 36bf93e --prepare-only` e a execução padrão com a mesma referência concluíram com código zero. A segunda congelou e compilou baseline/candidato em diretório ignorado próprio (279/280 módulos), com manifesto de hashes e verificação das fronteiras de conta/rede. Não executou novas medições de navegador; as métricas reportadas continuam sendo as rodadas preservadas acima. A revisão final independente não encontrou outra regressão concreta.

`npm run check:repo` passou na árvore final: 34 documentos mantidos, 829 links locais e sete fronteiras transitivas de módulos, sem alvos quebrados ou dependências proibidas. `git diff --check` também passou. A aplicação local continuou disponível em `http://127.0.0.1:5190/`; as medições desta bateria ocorreram no fixture local, não na aba de produção do usuário.

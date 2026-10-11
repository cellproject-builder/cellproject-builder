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

### Observação na produção anterior

Na revisão `03ddb4d`, uma tentativa de zoom pelo controle real do canvas não concluiu a sequência planejada: o comando de entrada expirou. A instrumentação temporária de `requestAnimationFrame` e Long Tasks registrou 16 tarefas longas, 11.876 ms acumulados e intervalo p95 entre frames de 443,8 ms em 17,9 segundos. Isso confirma uma sessão com travamentos, mas a sequência interrompida não serve como comparação controlada de FPS antes/depois. A instrumentação foi removida, sem modificar conteúdo do usuário.

## Three.js e limites

O compositor atual já usa um contexto WebGL 2 compartilhado, transparência, recorte por viewport e renderização sob demanda. No Chrome do notebook desta rodada, o renderer reportou ANGLE/D3D11 com NVIDIA GeForce RTX 4060 Laptop GPU. Essa observação confirma aquele contexto, não o desempenho ou o suporte de um tablet/celular.

As correções não removem geometria customizada, peças individuais, materiais, vista explodida nem detalhes do modelo salvo. Instancing, preparação em Worker, orçamento adaptativo de pixels e WebGPU são pilotos separados na proposta; não foram apresentados como recursos entregues nesta rodada.

Ainda é necessário medir frames p50/p95, long tasks e latência de entrada em build de produção, com pan/zoom, digitação e inspeção 3D comparáveis; repetir no S9 com caneta física e em celular. Uma melhora em microbenchmarks não basta para encerrar a queixa de lentidão.

## Refinamento no mesmo compositor

O pedido de IA agora substitui somente o texto da caixa existente. Referências/anexos são preservados; texto vazio não refina; não há painel adicional nem geração automática. Editar o draft, fechar a ferramenta ou trocar projeto invalida o resultado pendente. Minimizar mantém o processamento.

Verificação focada inicial: 84 testes de serviço/UI aprovados. Em ensaio no Chrome com o componente real e resposta simulada, o texto mudou na única textarea existente, a contagem de gerações permaneceu em zero e limpar o texto desabilitou refinar/enviar. Não houve chamada de IA nem alteração de dados do usuário nesse ensaio. A revisão também cobre contrato de contexto, cancelamento, retorno tardio e envio manual posterior. A verificação integrada e a publicação são registradas ao concluir a rodada.

## Verificação integrada

A bateria ampla executou 195 arquivos: 191 passaram, dois foram pulados e dois precisaram de reexecução. Um mock de geração do Board não expunha `getCloudRuntime`, agora necessário pelo adapter; corrigido somente o mock e seus 13 testes passaram. O teste de integridade de backup excedeu 20 segundos sob carga concorrente; reexecutado isoladamente, os três testes passaram em 11,0 segundos, sem relaxar o timeout ou a validação criptográfica.

Após as mudanças finais, 78 testes focados do nó 3D/cache, desenho, persistência e geração passaram; outros 49 testes de persistência/workspace cobriram a revisão de owner. O gateway passou 226 testes, com um teste pulado e nenhuma falha. Testes live de provedores pagos não foram habilitados. Os comandos e limites dos benchmarks aparecem junto de cada resultado.

Uma reexecução final de oito arquivos do grafo, desenho, estúdio e refinamento passou 158 testes. Esses conjuntos se sobrepõem e suas contagens não devem ser somadas como testes únicos.

`npm run build` concluiu com TypeScript e Vite aprovados. `npm run check:repo` verificou 34 documentos, 824 links locais e sete fronteiras transitivas de módulos. A auditoria do bundle preserva o carregamento tardio de Board, compositor 3D e extração de anexos. Continuam existindo chunks de aplicação e Three.js acima de 500 kB; esta rodada não declara encerrada a otimização de carregamento.

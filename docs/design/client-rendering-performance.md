# Processamento visual no aparelho

Pesquisa e proposta em 11/10/2026. Escopo: Construtor de Planos, Dynamic Board, notas, diagramas React/SVG, imagens/PDF e Three.js. A renderização interativa permanece no computador, celular ou tablet. O servidor continua responsável por autenticação, armazenamento, sincronização e chamadas autorizadas de IA; não recebe um fluxo de frames para renderizar a interface.

## O que aproveitar do mercado

| Referência primária | Técnica descrita | Aplicação no Dynamic Diary |
| --- | --- | --- |
| [Figma: WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/) | Backend gráfico separado da aplicação, compatibilidade com WebGL e comparação de desempenho antes da adoção | Manter contrato de cena independente do backend; avaliar WebGPU com os mesmos artefatos, sem prometer ganho por trocar a API |
| [Figma: carregamento por página](https://www.figma.com/blog/speeding-up-file-load-times-one-page-at-a-time/) | Carregar o conteúdo necessário à página em uso | Abrir documento e miniaturas primeiro; carregar imagem original, páginas de PDF e cenas detalhadas quando usadas |
| [tldraw: performance](https://tldraw.dev/sdk-features/performance) | Ocultar formas fora da tela, assinaturas granulares, cache de geometria e detalhe conforme zoom | Separar mudança de câmera de mudança de conteúdo; não reconstruir o documento ao selecionar ou digitar; desenhar somente a região visível |
| [React Flow: performance](https://reactflow.dev/learn/advanced-use/performance) | Componentes/callbacks estáveis, evitar assinaturas de arrays globais e reduzir trabalho nas atualizações | Isolar abas e componentes; reutilizar índices do grafo e resultados derivados, sem recalcular por nó a cada render |
| [Three.js: renderização sob demanda](https://threejs.org/manual/pages/rendering-on-demand.html) | Renderizar quando há mudança ou animação ativa | Preservar o compositor compartilhado atual; repouso não precisa de loop contínuo |
| [Three.js: InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) | Instâncias de geometria/material comum reduzem draw calls | Piloto para pinos, parafusos e peças repetidas; manter mapeamento para IDs e grupos da montagem |
| [Excalidraw: cena estática](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/renderer/staticScene.ts) e [cena interativa](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/renderer/interactiveScene.ts) | Camadas de renderização com responsabilidades distintas | Reutilizar o desenho concluído e atualizar separadamente o traço ativo, seleção e cursor |

As fontes descrevem soluções de seus próprios produtos. Elas orientam a proposta; seus resultados de velocidade não podem ser atribuídos ao Dynamic Diary. Issues da comunidade com ganhos esperados não foram tratadas como evidência de uma otimização entregue.

## Estado verificado e gargalos

O Three.js já usa WebGL 2 em uma superfície transparente compartilhada. O compositor desenha sob demanda, recorta cada artefato pelo viewport, limita o pixel ratio a 2, pausa com a página oculta e libera recursos no encerramento. Movimentar a câmera reutiliza geometria GPU. No Chrome do notebook foi confirmado um contexto ANGLE/D3D11 utilizando a GPU NVIDIA; isso não verifica aceleração em todos os dispositivos.

O React/SVG e os nós do grafo também exigem CPU para estado, layout, texto e eventos. GPU ativa não elimina esses custos. O diagnóstico encontrou cálculos repetidos de sequência/bloqueio do grafo, serialização de snapshots inteiros em mudanças de interface e atualizações de abas alheias. As medições e correções desta rodada devem ficar no [relatório de desempenho](../reports/client-performance-2026-10-11.md).

## Arquitetura recomendada

1. **Conteúdo e estado de interação separados.** Seleção, hover, câmera e atividade de uma aba não devem disparar cópia/serialização do conteúdo completo. Edições reais continuam seguindo os mecanismos de durabilidade e sincronização existentes.
2. **CPU com cache e trabalhos delimitados.** Um índice por versão dos nós/arestas fornece sequência, bloqueio e resolução. Geometria de traços e layout devem invalidar somente quando suas entradas mudam.
3. **GPU para visualização.** Manter WebGL/Three.js, transparência, cores, geometrias customizadas e peças individuais. Medir draw calls, triângulos e tempo de frames antes de introduzir instancing ou níveis de detalhe. A cena salva não perde detalhes para acelerar a vista.
4. **Trabalho pesado fora da thread da interface.** Um piloto de Worker pode preparar geometria de traços, malhas e índices. [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) permite renderização em Worker quando suportada. Validar suporte e retorno ao caminho atual; mensagens em excesso ou cópias grandes também custam CPU.
5. **Visibilidade e qualidade adaptativas.** Evitar trabalho para conteúdo distante/abas ocultas; manter a operação de IA independente da prévia. Limitar pixels de renderização por orçamento de frame, mantendo a qualidade final quando o gesto termina. Resolver miniaturas e páginas de PDF conforme a necessidade.

O navegador controla a escolha efetiva de hardware. Uma opção de desempenho pode ajustar orçamento de pixels, qualidade durante movimento e uso de Workers; não deve ser apresentada como garantia de ativar uma GPU específica.

## Three.js e WebGPU

WebGPU é candidato a um backend futuro, com WebGL como caminho compatível. Não é uma substituição imediata: o [manual do Three.js](https://threejs.org/manual/pages/webgpurenderer) informa que customizações via `onBeforeCompile()` não são suportadas nesse renderer. O arredondamento das imagens do compositor atual usa esse mecanismo e precisaria de uma implementação equivalente em materiais de nós/TSL.

O piloto deve comparar modelos padrão, geometrias `extrude/lathe/tube/buffer`, montagens avançadas, vista explodida reversível, transparência e perda/restauração de contexto. Instâncias devem continuar associadas a seus IDs e grupos, inclusive na seleção de peças. Uma melhora em um notebook não justifica trocar o backend de todos os aparelhos.

## Ordem de execução e critérios

| Etapa | Entrega | Critério de aceitação |
| --- | --- | --- |
| 1 | Corrigir trabalho redundante de CPU, snapshots e abas | Mesmos resultados funcionais; contagem de serializações/renders menor; benchmark reproduzível |
| 2 | Instrumentar pan/zoom, escrita, desenho e inspeção 3D | Frames p50/p95, long tasks, heap, draw calls/triângulos; medição em build de produção |
| 3 | Piloto de cache/camadas para desenho e preparação em Worker | Mesmo traço/pressão, sem perder edição/undo; comparação com e sem Worker |
| 4 | Piloto 3D de instancing e orçamento de pixels | Aparência/IDs/montagem preservados; ganho medido em cena repetitiva e complexa |
| 5 | Avaliar WebGPU e ampliar carregamento por demanda | Sem regressão nos dispositivos testados; fallback verificável; conteúdo original preservado |

Metas iniciais propostas: pan/zoom próximo de 60 fps em notebook e de pelo menos 30 fps no tablet de referência; p95 de resposta visual a clique/digitação abaixo de 100 ms. São metas de validação, não resultados alcançados. Testar o S9 com caneta física, Chrome/PWA, notebook e um celular real, incluindo aquecimento e sessão prolongada.

Cada rodada usa cenas comparáveis: grafo de 100/300/1.000 nós; desenho de 100/1.000 traços; 3D com peças repetidas e malhas customizadas, conjunto montado/explodido; imagens e PDFs de tamanhos distintos. Registrar tamanho do documento, quantidade visível, hardware, navegador, revisão do código e número de repetições. Não confundir microbenchmark de uma função com fps ou melhora total da aplicação.

## Referências de editores 3D reais

Pesquisa de código público em 11/10/2026, comparada com o Dynamic Diary na revisão `36bf93e`. Os links de código abaixo fixam a revisão examinada. Three.js Editor e PlayCanvas Editor são aplicações; Babylon.js é um motor com a ferramenta Inspector; React Three Fiber e drei são bibliotecas, não evidência de um produto pronto com a mesma carga do nosso canvas.

| Referência e revisão examinada | Mecanismo comprovado | Lacuna no Dynamic Diary nessa revisão | Piloto proposto e medição |
| --- | --- | --- | --- |
| **Three.js Editor**, `755f6e48c6865a83ae3e1e512adb3ea9e37a26da`: [sinais de atualização](https://github.com/mrdoob/three.js/blob/755f6e48c6865a83ae3e1e512adb3ea9e37a26da/editor/js/Viewport.js#L429-L553) e [animação](https://github.com/mrdoob/three.js/blob/755f6e48c6865a83ae3e1e512adb3ea9e37a26da/editor/js/Viewport.js#L850-L904) | Alterações de cena, câmera, geometria e material solicitam renderização; o ciclo de animação decide renderizar quando animação, ViewHelper ou XR requerem. Existe um tick; isso não equivale a suspender todo o processamento em repouso. | Já há renderização sob demanda, mas assinaturas gerais invalidam o compositor e cada vista visível recebe atualização de câmera/projeção mesmo sem mudança nesses parâmetros. | Dez modelos, orbitando apenas um: contar invalidações, atualizações de câmera e preparações de cena. Selecionar outro objeto não deve reconstruir cenas. Medir CPU e frames; a superfície compartilhada ainda pode exigir redesenhar todas as vistas visíveis. |
| **PlayCanvas Editor**, `d7cf2ceb57e92487bdcedc18b16e10f978a57be4`: [solicitação explícita](https://github.com/playcanvas/editor/blob/d7cf2ceb57e92487bdcedc18b16e10f978a57be4/src/editor/viewport/viewport.ts#L85-L95) e [ciclo do viewport](https://github.com/playcanvas/editor/blob/d7cf2ceb57e92487bdcedc18b16e10f978a57be4/src/editor/viewport/viewport-application.ts#L68-L98) | `redraw` e `keepRendering` controlam atualização/renderização. O RAF continua e emite `framerender`, inclusive para trabalho de streaming: renderização e preparação não têm necessariamente o mesmo agendamento. | O recorte já evita desenhar artefatos fora da tela, mas a reconciliação ainda calcula identidades e prepara itens fora dela. | Cem artefatos, seis visíveis: preparar apenas a região visível mais uma margem. Contar construções de `modelItem`, uploads GPU, heap e long tasks ao abrir e navegar; verificar que o conteúdo salvo permanece completo. |
| **Babylon.js / Inspector**, `a6b8e226d46464328197447f9fc93054c7b494fb`: [Inspector ligado à cena existente](https://github.com/BabylonJS/Babylon.js/blob/a6b8e226d46464328197447f9fc93054c7b494fb/packages/dev/inspector-v2/src/inspector.tsx#L84-L95), [múltiplas vistas](https://github.com/BabylonJS/Babylon.js/blob/a6b8e226d46464328197447f9fc93054c7b494fb/packages/dev/core/src/Engines/AbstractEngine/abstractEngine.views.pure.ts#L126-L187) e [thin instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances/) | Inspector reutiliza cena/motor. O caminho de múltiplos canvases renderiza e copia a imagem para cada vista; não elimina o custo por vista. Thin instances armazenam transformações em conjunto e reduzem objetos JS, com visibilidade coletiva e custo maior para adicionar/remover. | A geometria é compartilhada dentro de cada artefato, mas cada peça ainda cria seu material e mesh. Não existe um pool entre artefatos nem batching de peças repetidas nessa base. | Quinhentos pinos/parafusos: agrupar geometria e material compatíveis, preservando IDs, seleção e grupos da montagem. Comparar draw calls, CPU/GPU e memória com a base. Redução superior a 80% de draw calls é uma meta para a cena repetitiva, não resultado entregue. |
| **React Three Fiber / drei**, drei `bf6f4addf47467d3885de272d94ca5127f6ef68f`: [View e recorte](https://github.com/pmndrs/drei/blob/bf6f4addf47467d3885de272d94ca5127f6ef68f/src/web/View.tsx#L114-L163), [View: documentação](https://drei.docs.pmnd.rs/portals/view), [escala/desempenho](https://r3f.docs.pmnd.rs/advanced/scaling-performance) e [cuidados com React](https://r3f.docs.pmnd.rs/advanced/pitfalls) | `View` usa viewport/scissor, ignora vistas fora da tela e cria escopo de cena/câmera/eventos. R3F oferece `frameloop="demand"`, invalidação agrupada, reutilização de geometria/material e instancing; recomenda evitar `setState` em eventos de alta frequência. | O compositor já implementa boa parte desse mecanismo sem R3F. Faltam compartilhamento de recursos entre cópias e invalidação mais granular; trocar a biblioteca não entrega esses ganhos automaticamente. | Vinte cópias do mesmo modelo: comparar tempo de criação, quantidade de geometrias/materiais/texturas e heap com um pool de recursos. Remover uma cópia não pode quebrar as demais; a última deve liberar os recursos. |

### O que já existe e o que continua custando

Em `src/visuals/rendering/VisualCanvasLayer.tsx`, um renderer WebGL 2 desenha várias vistas transparentes com viewport/scissor, usando RAF sob demanda. O teste de interseção com o canvas pula vistas fora da tela durante o desenho. Entretanto, a reconciliação percorre todos os artefatos, serializa cena/montagem para identificar mudanças e cria os itens necessários antes desse teste de visibilidade. **Culling de desenho já existe; preparação de artefatos fora da tela continua antecipada.** Reduzir somente os draw calls não elimina esse trabalho de CPU e alocação.

Cena, câmera e recursos GPU já vivem em objetos de runtime, fora do estado declarativo do React. O próximo passo é controlar melhor sua invalidação e propriedade. O [manual de múltiplas cenas do Three.js](https://threejs.org/manual/pages/multiple-scenes.html) também usa um canvas e recortes por vista; portanto, múltiplos contextos WebGL por artefato não são uma exigência para obter interação independente.

### Limites de View, cache de imagem e Workers

- **`drei View.frames` não é cache de imagem.** No código examinado, o parâmetro limita medições de `getBoundingClientRect`; `frames={1}` não significa renderizar uma vez e reutilizar o frame. A vista visível continua renderizada quando o ciclo do renderer a chama. A documentação desse parâmetro só se aplica quando a posição/tamanho do elemento são estáveis.
- **Uma flag de vista limpa não basta após limpar a superfície compartilhada.** O compositor atual limpa o canvas antes de desenhar. Pular uma vista estática depois dessa limpeza apaga sua imagem. Reutilizar pixels por vista exigiria, por exemplo, render targets/FBO e composição de texturas, ou uma camada separada preservada. Isso adiciona memória proporcional à área em pixels, ao quadrado do DPR e aos attachments, além de invalidação, transparência, descarte e restauração de contexto. É candidato posterior a benchmark, não otimização já aplicada.
- **Workers reais aparecem em tarefas delimitadas.** O PlayCanvas [converte texturas em Worker e transfere buffers](https://github.com/playcanvas/editor/blob/d7cf2ceb57e92487bdcedc18b16e10f978a57be4/src/editor/assets/assets-texture-convert.ts#L39-L68); o Babylon.js [decodifica malhas Draco e transfere índices/atributos](https://github.com/BabylonJS/Babylon.js/blob/a6b8e226d46464328197447f9fc93054c7b494fb/packages/dev/core/src/Meshes/Compression/dracoCompressionWorker.ts#L336-L353). Esses exemplos sustentam preparação/decodificação fora da thread da interface; não provam que seus editores inteiros, UI ou toda renderização rodem em Worker.
- **OffscreenCanvas exige um contrato de interação.** O [exemplo oficial do Three.js](https://threejs.org/manual/pages/offscreencanvas.html) encaminha tamanho/eventos e adapta os controles porque o Worker não tem acesso ao DOM. Verificar suporte por recurso e testar fallback nos aparelhos usados. Transferir um `ArrayBuffer` pode retirar sua propriedade da thread original; não transferir o único buffer canônico de dados persistidos sem definir propriedade e recuperação. Resultados atrasados precisam respeitar cancelamento e a versão da cena.

Não foi feita uma auditoria completa da arquitetura interna dessas aplicações. As conclusões se limitam aos mecanismos públicos citados; não há evidência comparativa que justifique migrar o Dynamic Diary para PlayCanvas, Babylon.js ou R3F neste momento.

### Prioridades derivadas da pesquisa

1. Preparar conteúdo 3D conforme visibilidade, com margem para navegação e sem alterar o documento persistido. Medir separadamente preparação e desenho.
2. Tornar invalidação/câmera granulares, mantendo mudanças visuais, montagem explodida, resize e restauração de contexto corretos.
3. Testar instancing para peças compatíveis e compartilhamento de recursos, com mapeamento de IDs e propriedade explícita para descarte. Montagens podem exigir grupos separados para conservar transformações independentes.
4. Testar Workers para tarefas com entrada/saída delimitadas, como geometria e decodificação; comparar latência de clique e long tasks, incluindo custo de mensagens.
5. Só então avaliar cache de vistas em FBO, qualidade adaptativa adicional ou outro backend gráfico, caso a medição ainda aponte custo de renderização.

Esta seção documenta referências e pilotos propostos. A implementação de batching/instancing e seus resultados devem ser registrados separadamente no relatório de desempenho, com revisão, cena de teste e limitações; não são considerados entregues por esta pesquisa.

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

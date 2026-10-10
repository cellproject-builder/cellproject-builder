# Consolidação do Dynamic Diary — 10/10/2026

Revisão local após a entrega do Dynamic Board, na branch `codex/visual-studio-tabs`. O objetivo foi corrigir causas reproduzíveis e organizar as fronteiras existentes antes de ampliar o produto. As alterações anteriores do workspace foram preservadas. Esta etapa não realizou merge, deploy, migração remota ou chamadas pagas de IA.

## Correções integradas

| Área | Problema observado | Resultado |
| --- | --- | --- |
| Renderização compartilhada | O compositor desenhava continuamente; editar um modelo recriava o renderer e os outros modelos | Desenho por invalidação, cache por artefato e descarte somente dos recursos substituídos/removidos |
| Visão explodida | Depois de 10 segundos em repouso, o primeiro frame avançava cerca de 59,34% da transição | Primeiro passo de 1/60 s ao retomar; os seguintes usam o tempo real; animação volta ao repouso ao convergir |
| Prévia 3D | Prévia dependia do compositor completo e de suas dependências transitivas | Construção pura de cena em `rendering/modelItem.ts`; prévia com ciclo próprio, sem importar geração/pesquisa |
| Anexos de notas/quadros | A leitura/conversão não era protegida durante todo o percurso; uma saída/exportação podia ocorrer antes de persistir | Um registro de atividade cobre leitura, conversão e aplicação. Cancelamento libera o registro e descarta resultados tardios |
| Abas e pop-ups | Publicações antigas reabriam ferramentas fechadas ao voltar ao canvas; pedidos anteriores ao mount podiam perder o alvo | Recibos por projeto e comando com alvo capturado; entrega uma vez, inclusive no replay de efeitos do StrictMode |
| Desenho nas notas | Cada movimento do novo traço recalculava os caminhos já salvos | Caminho e pressão média memorizados por lista de pontos; eventos e atualização de traços continuam atuais |
| Carregamento | A navegação principal trazia antecipadamente Board, compositor 3D e dependências de decomposição | Canvas, prévia e inspetor carregam sob demanda; verificações de identidade separadas dos serviços em `decompositionState.ts` |

O compositor mantém atualizações por viewport, rotação/zoom, resize, carregamento de mídia e restauração WebGL. Aba oculta não mantém o ciclo de desenho. Os testes cobrem limpeza de observers, subscriptions, frames, geometrias, materiais e imagens que terminam de carregar após a remoção.

No teste de desenho com 1.000 pontos salvos e 20 movimentos novos, a leitura das coordenadas dos traços existentes caiu de 21.000 para zero. Isso mede trabalho evitado no teste controlado, não uma garantia de FPS em qualquer dispositivo.

## Medição de carregamento

O script `scripts/audit-client-bundle.mjs` constrói o grafo real de produção e percorre as dependências estáticas do bootstrap e da aplicação. Também detecta se módulos pesados voltarem ao caminho antecipado por um import transitivo.

| JavaScript no grafo antecipado | Antes | Depois | Redução |
| --- | ---: | ---: | ---: |
| Bytes minificados | 3.103.777 | 2.440.343 | 21,38% |
| Soma gzip dos chunks | 907.687 | 730.871 | 19,48% |

`npm run check:bundle` passa sem os módulos de Canvas/Composer/Preview do Board, compositor Three.js ou extrator de documentos no caminho antecipado. O aviso de import estático/dinâmico misturado do compositor foi eliminado.

Essa medição é do **grafo executável antecipado**, não do tempo de abertura ou de todo o tráfego. O service worker continua fazendo precache dos chunks públicos; o volume de instalação do PWA não foi reduzido por esta mudança.

## Validação executada

- Frontend: **1.317 passaram; 8 testes live foram pulados**, em 150 arquivos. Os pulados dependem de provedores externos e não foram contados como aprovados.
- Gateway: **137 passaram**, sem falhas ou pulados.
- `npm run build`: TypeScript e build de produção aprovados.
- Auditoria de bundle com `--check`: aprovada.
- `git diff --check`: aprovado; apenas avisos locais de normalização LF/CRLF.
- Navegador de desenvolvimento: SVG interativo, maximizar/restaurar quadro, modelo sintético com transparência, Ctrl + arrastar e Ctrl + scroll, enquadramento, desenho/desfazer nas notas.
- Viewport de 390 × 844 CSS px: sem transbordamento horizontal do documento; estúdio abre, minimiza e restaura com o rascunho preservado. Override removido após a conferência.
- Build compilado em origem local isolada: bootstrap, biblioteca do Board, novo canvas e compositor abriram sem erros de console. APIs remotas desativadas nesse teste; servidor temporário encerrado.

As regressões verificam também entrega de pedidos antes do mount, isolamento por projeto, remount real após fechar uma publicação, StrictMode, animação reversível, contexto WebGL restaurado, descarte assíncrono e proteção de ingestão em sucesso/erro/desmontagem. A revisão independente dos limites de transferência, restauração legada e imports não identificou outro bloqueador no escopo inspecionado.

Os dados usados no navegador são amostras locais de QA. O traço temporário foi desfeito e o quadro visual de teste voltou a ficar arquivado. O localhost principal permanece em `http://127.0.0.1:5190/`.

## Organização e limites para a próxima etapa

A referência atual de responsabilidades está em [architecture.md](architecture.md). O documento relacional antigo foi identificado como histórico para evitar confundi-lo com o armazenamento remoto ativo.

Ainda há trabalho mensurável antes de afirmar escalabilidade de produção:

1. **Carregamento de IA e chunks grandes:** o grafo antecipado ainda soma 2,44 MB. O build ainda avisa sobre chunks acima de 500 kB, incluindo aplicação e dependências compartilhadas. Separar o caminho de IA exige preservar os contratos do chat/planner; não foi mascarado aumentando o limite do aviso.
2. **Instalação do PWA:** avaliar precache e cache sob demanda separadamente do carregamento executável, com teste de atualização/offline antes de alterar a política.
3. **Volume de dados:** medir documentos, desenhos, backups e fila de persistência com volumes crescentes. Esta auditoria verifica contratos e corridas, mas não comprova capacidade para muitos usuários simultâneos nem substitui teste de carga.
4. **Integrações e qualidade das gerações:** login, recuperação do cofre, sincronização remota, busca real e geração avançada com provedores não foram refeitos nesta etapa. Fidelidade física dos modelos também não é validada pelos testes sintéticos.

A etapa entrega correções verificadas e fronteiras documentadas. Não representa ausência de todos os bugs nem conclusão automática de toda a fila histórica de funcionalidades.

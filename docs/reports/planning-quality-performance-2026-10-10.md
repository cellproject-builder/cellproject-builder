# Qualidade dos planos e desempenho — 10/10/2026

Esta rodada testa as frentes de engenharia reversa/criação e desempenho sobre a base `e2fd208`. O trabalho está isolado em `planning-quality-performance`; não houve commit, merge, alteração do banco ou deploy nesta rodada. O localhost principal em `127.0.0.1:5190` foi preservado.

## Qualidade: respostas reais e limites

O [piloto](../design/plan-quality/RESULTS.md) executou quatro condições de patinete: criação nova sem fonte, engenharia reversa sem alvo, reversa com documentação delimitada e reversa com conflito entre alvo Scooter 4 Pro e fontes Scooter 4. Cada condição usou os serviços reais de esboço, expansão e decomposição, preservando a primeira resposta. Foram **12 chamadas concluídas**, com custo informado de **US$ 0,3433099**, sem retries. Uma tentativa por condição não constitui taxa de qualidade nem comparação estatística.

A leitura independente encontrou cobertura dos principais subsistemas e perguntas concretas sobre carga, percurso, identidade, códigos e interfaces. A IA preservou desconhecidos e o conflito entre variantes nos trechos revisados. Não foram verificadas BOM, compatibilidade física, ferramentas disponíveis, preços ou funcionamento de um patinete.

Dois problemas acionáveis permaneceram nas respostas: um critério de “Confirmar variante e desempenho” exigia apenas campos de requisitos preenchidos, permitindo passar sem identificar a variante; outro exigia diagnóstico original sem antes estabelecer ferramenta, procedimento e acesso. As novas instruções pedem separar objetivos independentes, estabelecer método disponível e fundamentar limiares, preservando o critério do usuário.

Uma [rodada posterior](../design/plan-quality/RESULTS.md#rodada-posterior-às-regras-de-critério) repetiu apenas fonte/conflito, com seis primeiras chamadas concluídas e **US$ 0,1602416**. O critério de variante passou a comparar código da etiqueta com uma fonte específica, mas objetivos compostos e diagnósticos pouco definidos permanecem. Cada expansão recebeu avaliação parcial de critério (1), com contraprovas. A mudança do filho escolhido na decomposição e a ausência de replicações impedem atribuir causalidade ou declarar a qualidade resolvida. O total das duas execuções foi **18 chamadas / US$ 0,5035515**.

## Correções determinísticas

- IDs temporários vazios/repetidos, autoarestas e ciclos de dependência `direct` agora rejeitam o lote antes de materializar o grafo. Referências a IDs ausentes continuam descartadas conforme o contrato existente; relações de outros tipos não ganham semântica de dependência.
- Replanejamento admite causa indeterminada e nenhum nó novo quando falta evidência. Dificuldade relatada não demonstra uma premissa falsa; perguntas/medições discriminantes vêm antes da substituição. Diagnósticos sem novas partes ficam visíveis e permitem nova tentativa. O diagnóstico pertence ao projeto e ao relato exatos, distinguindo inclusive relatos iguais no mesmo milissegundo. Limpar/substituir a falha ou trocar de projeto impede que uma resposta atrasada recrie diagnósticos/propostas antigos.
- Pesquisa aparece como afirmação documental guardada, sem se declarar observação física ou verificação independente. A lista permitida de URLs permanece preservada.
- Travessias profundas de layout, progresso, resolução e tutoria passam a usar pilhas/ordem iterativa, preservando os resultados dos planos pequenos e fronteiras conhecidas.
- A biblioteca completa de ícones é carregada quando usada, mantendo 318 IDs, busca, cores e fallback local se o chunk falhar.

## Desempenho medido

O [protocolo e dados](../design/plan-quality/performance/README.md) preservam baseline e resultados. A primeira medição guardou sete erros de stack overflow em árvores de 5.000/12.000 níveis. A comparação equivalente após a correção executou 96 combinações sem erros. O protocolo ampliado executou **192 combinações**, com árvores balanceadas, largas e profundas de 100 a 12.000 nós, abertas/resolvidas, sem falha de operação ou invariante. Há aquecimento e cinco amostras por combinação. Isso mede funções de CPU; não comprova fluidez do canvas de 12.000 nós.

O ensaio HTTP local executou **11 cenários / 323 tentativas**, sem chamadas externas: rajadas de 20/50, limites por usuário/globais, associação entre pedidos e respostas, falhas, cancelamento SSE e repetição explícita de escrita. As duas rajadas mistas admitiram 12 operações (IA 6/intake 2/vault 4), rejeitando o excesso com 429 conforme os limites. As vagas foram recuperadas após falha/cancelamento. Sessões/provedores/RPC são simulados; handlers, HTTP e serialização são reais. A escrita repetida preservou os bytes e um único efeito **no RPC modelado**; não valida o banco gerenciado. Latências com barreiras artificiais não são SLA ou capacidade do Railway.

O fechamento inicial de JavaScript de produção passou de **2.566.067 bytes / 765.490 gzip** para **2.177.780 bytes / 668.864 gzip**: redução de **15,13%** no JavaScript inicial e **12,62%** em gzip. Há 17 chunks no fechamento em ambas as versões. O [JSON final](../design/plan-quality/performance/results/2026-10-10/bundle-final.json) e o baseline incluem o grafo completo. A redução vem principalmente do catálogo completo de ícones, antes incluído no App. O App passou de aproximadamente 1.020 kB para 627 kB, mas ele e Three.js ainda excedem 500 kB; o SDK de IA permanece inicial. O pré-cache da PWA continua abrangendo assets; reduzir o fechamento inicial não reduz automaticamente a instalação completa.

## Verificação integrada

Verificação no worktree após a correção do ciclo de diagnóstico:

| Comando | Resultado |
| --- | --- |
| `npm test` | 175 arquivos e 1.560 testes aprovados; dois arquivos/oito testes live ignorados; 34,75 s |
| `npm run test:gateway` | 208 aprovados, um ignorado, zero falhas; adaptadores externos simulados |
| `npm run test:planning-quality` | Nove testes aprovados, sem inferência paga |
| `npm run bench:planner` | Uma execução aprovada, 192 combinações sem falha; dados sintéticos de CPU |
| `npm run test:planner-load` | Dois testes aprovados; inclui detecção deliberada de resposta associada ao pedido errado |
| `npm run bench:gateway` | 11 cenários / 323 tentativas aprovados; zero chamadas externas |
| `npx tsc --project docs/design/plan-quality/tsconfig.json --noEmit` | Aprovado |
| `npm run build` | TypeScript e build Vite aprovados; aviso de chunks grandes mantido |
| `node scripts/audit-client-bundle.mjs --check --output ...` | Aprovado; nenhum módulo pesado proibido no fechamento inicial |
| `npm run check:repo` | 29 documentos, 741 links locais e sete fronteiras transitivas, sem erro |
| `git diff --check` | Aprovado |

Browserslist desatualizado, aviso React de Suspense/`act` em teste de bootstrap e compatibilidade v2 de SDK apareceram, sem falhar os testes. A revisão independente reproduziu e corrigiu o diagnóstico obsoleto antes da suíte final; também conferiu o catálogo de 318 IDs, fallback e limites do benchmark.

No Chrome, usando somente demonstrações em uma origem local isolada com cloud desativada, o App carregou sem o chunk Radix no conjunto de 17 JS iniciais. Ao abrir o seletor, o chunk respondeu 200 e um SVG estendido (`HeartFilledIcon`) estava presente. Cache e service worker foram temporariamente ignorados para observar essa carga e restaurados depois. Não houve medição confiável de LCP/INP, avaliação em dispositivo nem importação do fixture grande. A verificação visual precedeu a última mudança interna do cache de diagnóstico; a suíte/build finais cobrem esse código posterior.

## Pendências desta frente

1. Ampliar robô/Arduino, referências e replanejamento, com revisão humana e múltiplas tentativas; resolver as lacunas de critério que persistiram na rodada posterior.
2. Medir renderização, pan/zoom e latência de interação em projetos grandes e aparelhos físicos. A importação do fixture via extensão encontrou permissão de arquivo local não habilitada; não houve bypass.
3. Ensaiar carga sustentada, corpos grandes, múltiplas réplicas e armazenamento com massa sintética isolada. O ensaio HTTP desta rodada não testa capacidade, autenticação ou durabilidade Supabase/Railway nem dados do usuário.
4. Separar novos caminhos pesados do App/SDK e avaliar o pré-cache da PWA com o contrato offline em andamento, sem misturar este worktree com a frente offline.

Não houve ensaio físico, TypeSafe nesta bateria, teste de aprendizagem ou afirmação de eficácia científica. O objetivo é tornar as falhas reproduzíveis e as próximas decisões revisáveis.

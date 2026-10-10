# Desempenho do planner — protocolo de CPU e bundle

Rodada de 10/10/2026 no Windows 10.0.26300, Node 24.18.1, Intel Core i7-13650HX. A base Git é `e2fd208`; as correções desta rodada estão no worktree `planning-quality-performance`. Os resultados abaixo não medem FPS, latência de interação, rede móvel ou carga do servidor.

## CPU e profundidade

Executar `npm run bench:planner`. O runner usa Vitest/jsdom, um worker, fixtures sintéticas e funções reais do planner. Não usa projetos, chats ou desenhos do usuário. A saída padrão é `.codex-audit-planning-performance/cpu-latest.json`; `PLANNER_PERF_OUTPUT` permite guardar outra execução sem substituir uma evidência datada.

São três formas: árvore balanceada com até cinco filhos por pai, árvore larga e cadeia profunda. Cada forma tem 100, 1.000, 5.000 e 12.000 nós. A versão 2 repete cada caso com folhas abertas e com folhas confirmadas/evidência sintética, totalizando **192 combinações de operação/caso**. Cada combinação tem uma amostra de aquecimento e cinco amostras medidas. O p95 dessas cinco amostras é o máximo observado, não uma estimativa estável de cauda.

As oito operações são layout persistido, layout adaptativo, progresso, progresso com evidência, próximo nó pendente, resolução da árvore, validação da importação e serialização. As invariantes verificam IDs/quantidade/coordenadas finitas, contagens de progresso, resolução esperada, identidade/estado da próxima folha, importação e igualdade do JSON. Essas verificações e a imutabilidade da entrada ficam fora do cronômetro. Qualquer erro é salvo no relatório e faz o benchmark falhar.

| Evidência | Resultado |
| --- | --- |
| [Baseline v1](results/2026-10-10/cpu-baseline.json) | 96 combinações abertas; sete falhas `RangeError` em cadeias profundas. O teste exploratório inicial guardava os erros sem reprovar; não é uma baseline aprovada |
| [Depois, mesmo protocolo v1](results/2026-10-10/cpu-after.json) | 96 combinações, zero falhas após substituir travessias recursivas |
| [Protocolo ampliado v2](results/2026-10-10/cpu-complete.json) | 192 combinações abertas/resolvidas, zero falhas de operação/invariante |

As falhas originais foram layout persistido e resolução em 5.000 níveis; em 12.000 níveis, também progresso, evidência e busca do próximo pendente. Travessias iterativas agora preservam posições, ordem das folhas e fronteiras conhecidas. Testes específicos tratam ciclos alcançáveis; componentes desconectados e ramos abaixo de uma fronteira conhecida mantêm seus contratos anteriores.

Exemplo da execução v2, medianas em milissegundos para 12.000 nós abertos:

| Forma | Layout persistido | Progresso | Validar importação | Serializar |
| --- | ---: | ---: | ---: | ---: |
| Balanceada | 6,75 | 3,30 | 13,44 | 12,23 |
| Larga | 5,62 | 2,82 | 13,76 | 12,20 |
| Profunda | 9,48 | 4,17 | 12,87 | 12,85 |

12.000 nós é um caso de estresse das funções, não uma promessa de capacidade visual. O runner gera um projeto de 1.000 nós para importação manual separada. Nesta rodada, a importação pela extensão do Chrome foi impedida pela permissão de acesso a arquivos locais; não houve alteração dessa permissão nem medição de renderização desse projeto.

## Concorrência HTTP isolada

`npm run bench:gateway` abre um servidor de produção real em `127.0.0.1` e porta efêmera, fechando-o após cada cenário. Não usa `.env`, servidor 5190, credenciais ou rede externa. `npm run test:planner-load` também injeta uma resposta associada ao pedido errado para conferir que o próprio harness a rejeita. Reexecuções salvam `.codex-audit-planning-performance/gateway-load-latest.json`; o [registro datado](results/2026-10-10/gateway-load.json) permanece separado.

Foram 11 cenários e 323 tentativas HTTP: rajadas mistas e por rota com 20/50 clientes, falha/autorização, cancelamento SSE e repetição explícita de escrita após perda da resposta. Rotas de proxy de planejamento, classificação TypeSafe e persistência de vault usam handlers/validadores reais. Sessões, origem, provedor, classificador e RPC atômico são adaptadores simulados. Os bytes do envelope são sintéticos, não dados cifrados de usuário.

| Rajada mista | Sucessos | Rejeições 429 | Picos observados no adaptador |
| --- | ---: | ---: | --- |
| 20 pedidos | 12 | 8 | IA 6 / intake 2 / vault 4 |
| 50 pedidos | 12 | 38 | IA 6 / intake 2 / vault 4 |

As rejeições são o limite esperado do gateway e não travamentos. Verificaram-se associação de resposta/usuário mesmo completando fora de ordem, nenhuma tentativa automática adicional, recuperação simultânea das 12 vagas após falhas, abort de apenas dois streams cancelados e reocupação das seis vagas de IA. Repetir operação de escrita com os mesmos bytes preservou um único efeito no RPC modelado; trocar bytes com o mesmo ID produziu 409. Isso valida o transporte até o adaptador, não CAS, RLS ou durabilidade do Supabase.

As latências incluem barreiras artificiais e liberação invertida; não representam SLA, throughput ou latência do provedor. Clientes, servidor e fixtures compartilham processo; snapshots de memória não isolam o consumo do backend. Não foram testados múltiplas réplicas, corpos grandes, exaustão sustentada da janela por minuto, autenticação gerenciada ou carga da produção.

## Bundle de produção

Executar `npm run check:bundle -- --output caminho.json`. O script compila em memória e calcula o fechamento de imports estáticos do bootstrap e do App, incluindo chunks compartilhados. Bytes são de JavaScript minificado; gzip é calculado por chunk e somado. A contribuição por módulo (`renderedLength`) é anterior à minificação e serve para investigar imports, não representa bytes transferidos.

O [baseline](results/2026-10-10/bundle-baseline.json) revelou o catálogo inteiro de SVGs Radix no fechamento inicial. O catálogo de nomes permanece imediato e pesquisável; SVGs comuns usam a família compartilhada e o catálogo estendido carrega quando necessário. Nenhum dos 318 IDs foi removido. Uma falha no chunk exibe o ícone padrão localmente sem derrubar a aplicação ou alterar o ID salvo; uma nova carga da página permite tentar novamente.

O check agora recusa a biblioteca Radix completa no fechamento inicial, além dos módulos pesados já protegidos. Um projeto com ícone estendido ou a abertura do seletor pode carregar esse chunk legitimamente após o bootstrap. O service worker ainda pré-carrega os assets: esta otimização reduz o código necessário para a aplicação inicial, **não o total baixado na instalação da PWA**.

Os números finais e as verificações integradas estão no [relatório da rodada](../../../reports/planning-quality-performance-2026-10-10.md). Permanecem trabalho posterior: App e Three.js acima de 500 kB, SDK de IA no fechamento inicial, medição de LCP/INP em dispositivo, renderização/interação com volume e carga concorrente do backend.

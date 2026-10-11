# Evidências da bateria PDF

O [relatório datado](../../reports/pdf-performance-2026-10-11.md) interpreta os resultados e os limites. O [protocolo reproduzível](../../../scripts/pdf-performance/README.md) descreve preparação, execução e limpeza.

- `build-manifest.json`: revisão baseline, SHA-256 dos snapshots, fixture, lockfile e assets compilados.
- `browser-results.json`: 36 amostras aceitas, três repetições por variante/superfície, com 30 cartões.
- `browser-initial-reproduction.json`: reprodução inicial, anterior aos controles de reset; preservada fora da comparação principal.
- `browser-excluded-concurrent-suite.json`: tentativa candidata com Vitest concorrendo por CPU, excluída da comparação.
- `browser-100-cards.json`: uma execução de capacidade densa/liberação por superfície, com 100 cartões.
- `browser-reader.json`: minimizar/restaurar na página 2/fechar o leitor.
- `qa/`: capturas reais da fixture compilada, com originais sintéticos.

Todas as amostras principais começam com inventário limpo e terminam sem erro; a carga densa tem a quantidade esperada de canvases. Esses critérios devem ser conferidos ao repetir a bateria: ausência de trabalho pendente sozinha não prova renderização bem-sucedida. A origem de teste precisa ser dedicada, pois o armazenamento local real tem GC próprio. Não usar a origem da aplicação do usuário.

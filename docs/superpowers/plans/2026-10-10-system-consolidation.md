# Dynamic Diary Consolidation Plan

> **For agentic workers:** executar as frentes independentes de diagnóstico e integrar correções verificadas nesta sessão.

**Goal:** corrigir falhas reproduzíveis e reduzir custos desnecessários de carregamento/renderização sem acrescentar funcionalidades.

**Architecture:** manter o grafo como fonte do planner, o workspace como proprietário de notas/quadros e os renderizadores compartilhados independentes da navegação. Isolar ferramentas pesadas por carregamento sob demanda e preservar validação/cancelamento nas fronteiras assíncronas.

**Tech Stack:** React 18, Vite 6, Zustand, React Flow, Three.js, Vitest e gateway Node existentes.

**Spec:** pedido de consolidação desta conversa, após `2026-10-10-dynamic-board.md`.

## Restrições

- Preservar alterações anteriores, dados e localhost em 127.0.0.1:5190.
- Não executar chamadas pagas, alterar serviços remotos, publicar ou integrar branches nesta auditoria.
- Corrigir causas demonstradas; evitar reescrita geral, novas dependências e mudanças cosméticas sem necessidade.
- Testes locais/sintéticos não comprovam carga de produção, segurança absoluta ou fidelidade física.

## Foco da revisão

- GPU/CPU em repouso e descarte de recursos ao trocar modelos/telas.
- Respostas atrasadas e ingestão de dados durante navegação, reset ou logout.
- Isolamento entre abas, popups, planner, notas e quadros.
- Dependências pesadas carregadas antes do uso e regressões no grafo de imports.
- Persistência e restauração de dados legados, inclusive conteúdo visual.

## Execução

- [x] Medir o bundle atual e registrar baseline sem mudanças no código.
- [x] Agente de renderização: reproduzir hotspots e corrigir o ciclo de desenho/descarte nos arquivos acordados.
- [x] Agente de persistência: reproduzir perdas/corridas e corrigir somente os limites afetados.
- [x] Agente de UI/assíncrono: reproduzir vazamentos de sessão/cancelamento e corrigir o fluxo afetado.
- [x] Principal: separar imports pesados, verificar navegação e manter teste do grafo de dependências.
- [x] Revisar diffs, executar suites frontend/gateway/build, conferir navegador desktop/mobile e documentar limites e pendências.

Resultados, evidências e próximos limites estão no [relatório de consolidação](../../consolidation-audit-2026-10-10.md). Não houve merge ou deploy nesta etapa.

# Project workspace implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. The user explicitly requested implementation in this session and a live localhost preview.

**Goal:** Entregar projetos, Kanban, sprints e diário conectados, preservando o construtor.
**Architecture:** Store de gestão independente, ponte explícita para snapshots do grafo, componentes pequenos por módulo. Ações públicas do store serão reutilizáveis pelo agente.
**Tech Stack:** React, TypeScript, Zustand, idb-keyval, CSS, Vitest existentes.
**Spec:** `docs/superpowers/specs/2026-10-08-project-workspace-design.md`

## Global Constraints

- Local-first, sem backend, sem novas dependências de produto.
- Textos em português e inglês, mantendo o seletor de idioma existente.
- Layout utilizável em desktop e mobile; controles acessíveis por teclado.
- Servidor Vite permanece rodando na porta local informada.

## Review Focus

- Troca de projeto não pode misturar tarefas, sprints ou callbacks do planejador.
- Snapshots antigos e migração não podem apagar dados.
- Edição e troca de nota não podem perder texto; lixeira deve permitir restauração.
- Encerrar sprint libera pendências, mantém concluídas e permite iniciar a próxima.
- Mobile e teclado devem permitir as mesmas ações de movimentação do desktop.

## Task 1: Estado e ações

Files: `src/workspace/types.ts`, `store.ts`, `store.test.ts`, `planner.ts`, `planner.test.ts`.
Interfaces: `useWorkspaceStore`, ações de projeto/tarefa/sprint/nota, `capturePlanner`, `openPlanner`, `initializeWorkspace`.

- [x] Testes falhando de isolamento, migração, persistência e ciclos.
- [x] Implementar tipos e ações validadas; ponte sem duplicar projetos existentes.
- [x] Rodar `npm test -- src/workspace` e confirmar aprovação.

## Task 2: Gestão e execução

Files: `src/workspace/Workspace.tsx`, `Projects.tsx`, `Board.tsx`, `Scrum.tsx`, `TaskEditor.tsx`, `messages.ts`, `workspace.css`, `src/App.tsx`.
Consumes: store da Task 1. Produces: entrada em projetos, visão geral, quadro e sprints utilizáveis, acesso ao planejador.

- [x] Implementar UI de projetos, tarefas e sprints com estados vazios reais.
- [x] Incorporar o planejador e remover exigência de chave para gestão.
- [x] Verificar build e fluxos no navegador.

## Task 3: Diário

Files: `src/workspace/Notes.tsx`, estilos e textos compartilhados.
Consumes: ações de notas e pastas; projetos e tarefas para vínculos.

- [x] Implementar navegação de pastas/lista/editor, busca e fixação.
- [x] Implementar blocos, checklist, vínculo, lixeira e restauração com autosave.
- [x] Verificar edição, persistência e mobile no navegador.

## Task 4: Verificação e revisão

- [x] Rodar suite completa, TypeScript e build.
- [x] Revisão independente somente leitura conforme requesting-code-review.
- [x] Corrigir achados relevantes e verificar regressões.
- [x] Documentar entrega e manter localhost ativo.

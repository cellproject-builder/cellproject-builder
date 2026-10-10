# Dynamic Board Implementation Plan

**Goal:** disponibilizar quadros livres, persistentes e independentes com objetos editáveis e motores visuais de IA.

**Architecture:** coleção `boards` no workspace; canvas React Flow com tipos próprios e renderizadores puros existentes. Serviços de IA recebem o ID do quadro e contexto explícito, sem mutar o grafo do planner.

**Tech Stack:** React, TypeScript, Zustand, React Flow, Three.js, SVG declarativo e AI SDK já instalados.

**Spec:** `docs/superpowers/specs/2026-10-10-dynamic-board-design.md`.

## Constraints and review focus

Preservar alterações anteriores e localhost. Sem commit/deploy nesta entrega. Validar dados antes de salvar; respostas de IA não são código. Verificar que trocar de quadro, arquivar ou editar fontes impede aplicar respostas atrasadas; pan/zoom não invalida contexto. Backups legados sem boards continuam válidos. Imagens não podem ser coletadas como órfãs pelo planner. Edges removidos junto com objetos. Editar texto não deve acionar atalhos do canvas.

## Tasks

1. **Modelo e persistência — agente dedicado.** Criar `boards/model.ts` e schemas; coleção/actions no workspace, backups/restore/hidratação. Testes de limites, independência, legado e roundtrip antes da implementação.
2. **IA — agente dedicado.** Criar `boards/generation.ts` e `BoardComposer.tsx`; diagrama/3D/busca/aprimoramento com revisão, contexto limitado e cancelamento. Testes com provedores simulados e sem chamadas pagas.
3. **Objetos — agente dedicado.** `BoardItemNode.tsx`: texto formatado, imagem, SVG, desenho, transformação e Ctrl para 3D; callbacks próprios. Testes de edição, formatação, parâmetros e controles.
4. **Quadro e navegação — agente principal.** `DynamicBoards.tsx`, `BoardCanvas.tsx`, operações e CSS. Criar/abrir/renomear/arquivar, pan/zoom/desenho, clipboard, undo e fullscreen. Integrar entrada lateral e suspensão do chat em fullscreen.
5. **Integração e revisão.** Checar schemas e callbacks compartilhados; testes focados, suíte/build, revisão independente e navegador desktop/mobile. Mostrar resultado real e limites sem declarar validação física ou live IA que não aconteceu.

## Resultado verificado em 2026-10-10

- As cinco etapas foram concluídas. Dynamic Board aparece no menu pessoal, independente de projetos e notas, com biblioteca, arquivamento reversível e canvas próprio.
- Cartões, texto formatado, desenhos, imagens, diagramas e modelos 3D têm posições e dimensões próprias. Clipboard, duplicação, undo/redo e conexões curvas usam ações locais validadas.
- IA recebe somente o quadro/referências selecionados, com orçamento de contexto, revisão antes de inserir e cancelamento de respostas desatualizadas. Minimizar mantém a operação; fechar ou sair do quadro cancela.
- Revisões independentes corrigiram título durante digitação, foco do editor, resize de desenho e ação de refinamento em objetos não suportados. O navegador revelou e confirmou a correção de `measured` e da sobreposição dos handles no React Flow.
- `npm test`: **1.289 passaram / 8 ignorados**, 146 arquivos aprovados. `npm run test:gateway`: **137 passaram**. `npm run build`: aprovado, com avisos de tamanho de chunks e importação estática/dinâmica do compositor. `git diff --check`: aprovado.
- Navegador real: criar, escrever, formatar, mover, desenhar, colar PNG, renderizar/rotacionar uma cena 3D sintética, conectar por clique, mover mantendo ligação, maximizar e restaurar. Em 390 px CSS, página e popup sem overflow horizontal. Recarregar preservou o quadro, a conexão e o slider em 2.
- Uma geração SVG real produziu **Da ideia ao aprendizado**, com slider Tentativas, prévia, minimização durante execução e aplicação no quadro. A primeira tentativa foi interrompida por atualização de desenvolvimento; a segunda concluiu. Busca e geração 3D têm testes de provedor simulados, sem validação live nesta entrega.
- Amostra principal local: **QA · Dynamic Board**. Testes de imagem/3D: **QA · Objetos visuais**, arquivado e recuperável. Screenshot: `.codex-audit-senai-2026-10-09/dynamic-board.png`. Localhost permanece em `http://127.0.0.1:5190/`.

Limites: 3D padrão nesta versão, sem montagem avançada/decomposição; aprimoramento de IA somente em cartões/texto; referências por `@` e imagens do quadro, sem anexos de documentos no composer. Conversão de quadro em plano fica para uma etapa posterior. Sem commit, merge, deploy ou alterações remotas de banco nesta entrega.

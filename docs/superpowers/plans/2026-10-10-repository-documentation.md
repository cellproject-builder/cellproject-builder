# Organização do repositório e documentação dos módulos

> **For agentic workers:** executar as frentes independentes na sessão atual, com ownership explícito de arquivos e integração pelo agente principal.

**Goal:** tornar o repositório navegável e produzir descrições auditáveis das funcionalidades para manutenção e redação de artigos.

**Architecture:** preservar os domínios e contratos existentes. Agrupar uma funcionalidade coesa já identificada (aparência dos projetos), separar materiais históricos e fornecer uma entrada única para documentação operacional, modular e científica.

**Tech Stack:** React/TypeScript, Vite/Vitest, Node e documentação Markdown existentes; sem novas dependências.

**Spec:** pedido do usuário nesta conversa em 10/10/2026; direção científica em `docs/OBJETIVO_DO_ARTIGO.md`.

## Restrições e foco

- Preservar mudanças anteriores, dados, chaves, resultados experimentais e localhost 5190.
- Não ler arquivos `.env`, chamar provedores, modificar serviços remotos, integrar branches ou publicar.
- Não confundir ausência de import com lixo: fixtures, scripts de uso manual, resultados negativos e materiais de artigo têm proprietários próprios.
- Não promover Dairo, frentes, controle físico ou resultados de aprendizagem a funcionalidades entregues sem código/evidência.
- Não renomear chaves persistidas, formatos de backup ou URLs de laboratórios ativos.
- Qualquer movimento de código exige atualizar imports, rever as fronteiras e rodar testes/build. Documentos exigem verificação de links e revisão factual.

## Entregas

- [x] Inventariar fontes, scripts, documentação, caches e artefatos; classificar candidatos antes de limpar.
- [x] Agrupar aparência de projetos em `src/workspace/project-appearance/`, mantendo testes de integração junto de `Projects`.
- [x] Inspecionar geração de ícones: saídas distintas, sem duplicação; preservar ambos e mover autoria PWA para `scripts/pwa`, com hashes das seis saídas idênticos.
- [x] Arquivar os cinco HTMLs de conceitos/identidade antigos em `docs/archive/early-concepts/`, preservando referências entre eles; mover relatório solto da raiz para `docs/reports/`.
- [x] Criar dez fichas em `docs/modules/` por agentes, cada uma com finalidade, fluxo, arquitetura, dados, testes, limites e questões investigáveis.
- [x] Criar `docs/README.md`, `docs/modules/README.md`, mapa de repositório e guia de uso em artigos em `docs/research/`.
- [x] Atualizar README principal e arquitetura; registrar o diagnóstico de modularização e pendências com evidência.
- [x] Verificar links internos/limites de imports; executar testes frontend/gateway, build, bundle e diff check pertinentes; manter localhost disponível.

Extrações delimitadas adicionadas durante o inventário: `graph/treeIndex.ts` e `graph/treeLayout.ts`, com reexports compatíveis no store. Corrigida precedência de configuração Vite por emissões antigas na raiz e adicionada seleção explícita. `.env*` privado ignorado, com exemplos permitidos. Não foi feita uma reescrita integral de coordenadores grandes: próximas separações estão priorizadas no relatório.

## Ownership

Principal: organização de arquivos, imports de aparência, scripts/configuração, README/índices, pesquisa e relatório. Agente visual: three-studio/diagrams/image-references. Agente workspace: dynamic-board/notes/planner-projects/chat-and-dairo. Agente plataforma: ai-orchestration/data-and-privacy/platform-and-delivery. Os agentes de documentação não alteram runtime.

As decisões e os resultados finais serão registrados em `docs/reports/repository-review-2026-10-10.md`.

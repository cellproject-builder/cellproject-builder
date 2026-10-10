# Consolidação do canvas, planos e PWA — Implementation Plan

> **For agentic workers:** Executar por frentes independentes com testes de comportamento e integração final coordenada. Usuário autorizou agentes, review e merge local na main; Supabase/deploy ficam para outra etapa.

**Goal:** fechar os pedidos acumulados desta conversa, preservar dados e potência do motor, validar mobile/tablet e permitir instalação web antes de integrar na main.

**Architecture:** Reutilizar ações, contexto, anexos, referências e revisões já existentes. Compartilhar estado por contratos validados, com alterações localizadas e revisão de contexto antes de aplicar respostas assíncronas. Experimentos permanecem identificados como laboratório.

**Tech Stack:** React, Zustand, ReactFlow, Three.js, AI SDK/OpenRouter, TypeSafe, Vite, Vitest e service worker.

**Spec:** pedidos desta conversa, `docs/OBJETIVO_DO_ARTIGO.md` e `docs/design/interactive-artifacts/BACKLOG_AUDIT.md`.

## Restrições globais

- Preservar evidência física, critério próprio, originais e histórico de revisões.
- Não tratar confiança da IA/TypeSafe como prova de correção, compatibilidade ou segurança.
- Preservar geometria customizada e geração modular avançada.
- .env/chaves ficam fora do commit, bundle público e caches PWA.
- Ordem atualizada pelo usuário: consolidar e integrar esta entrega primeiro; depois migrar persistência para Supabase na organização P&D e fazer deploy no Railway, projeto `externo`.
- O servidor local continua acessível em 127.0.0.1:5190.

## Foco de review

1. Resposta atrasada depois de mudar plano, modelo ou referência deve ser descartada.
2. Editar/restaurar um modelo avançado preserva cena e metadados de módulos coerentes.
3. Ctrl+rolagem modifica a aproximação da vista 3D, sem zoom do grafo, seleção ou mudança de medidas.
4. Instalação/PWA não armazena APIs, credenciais ou respostas privadas em cache.
5. Engenharia reversa sem produto/variante/fonte expõe lacunas; não inventa uma BOM completa.

## Frente A — contexto e abordagem do plano

**Dono:** dbox_plan_engine. **Files:** plannerTools/tests, types/store, ObjectiveScreen, service/tests, montadores DetailPanel/TutorMode/GroundTruth e i18n.

- [x] Reproduzir gap do chat e passar planOverview, knownElsewhere e relatedParts sem expor critérios ocultos.
- [ ] Campo opcional retrocompatível `planApproach`, separado de archetype e estratégia, e alvo de referência quando engenharia reversa.
- [ ] Geração/decomposição/chat e import/export preservam abordagem e contexto.
- [ ] Fixture de patinete com referência delimitada, perguntas, interfaces, cobertura e lacunas; fontes distintas de suposições.
- [ ] Testes focados e relatório de limites científicos do DBox.

## Frente B — edição rápida, refinamento e zoom 3D

**Dono:** artifact_arch_review. **Files:** VisualArtifactNode/tests, generation, modelRevision novo, ModelPromptRefiner/refinement/tests, VisualExplorer, CSS local, visual viewStore/renderer e metadados de revisions.

- [ ] Lápis discreto abre barrinha de texto/anexos/@; OK revisa o mesmo artefato e preserva original/posição/origem.
- [ ] Remover legenda textual de giro, manter Ctrl e controles acessíveis para toque.
- [ ] Ctrl+scroll aproxima/afasta somente a vista do modelo, com limites e reset; não ativa seleção.
- [ ] Refinamento com um campo de ajuste e CTA contextual; eliminar redundância pedido/respostas/check confuso.
- [ ] Guia de refinamento reflete geometrias nativas e modo avançado.
- [ ] Ação de remover proposta aplicada do histórico integrada na UI.
- [ ] Testes de revisão atual/stale, restauração e interações.

## Frente C — PWA e portabilidade

**Dono:** dbox_evaluation. **Files:** src/pwa/**, public/manifest/service worker/ícones, main/index, Workspace e CSS, plugin build mínimo no Vite.

- [ ] Instalação progressiva; instrução manual no iOS quando necessária; estado instalado.
- [ ] Shell público com atualização versionada, sem cache de APIs/chaves/dados privados; IA depende de rede.
- [ ] Ajustes responsivos de workspace/planner/chat e verificação dos limites de toque/rolagem.
- [ ] Testes de cache/install e build de produção.

## Coordenação — laboratório, histórico, avaliação e integração

**Dono:** root. **Files:** docs/design/interactive-artifacts, domain/test apenas remoção de histórico, documentação de consolidação e Git.

- [x] Artigo lido; laboratório de duas arquiteturas e dois prompts; TypeSafe exercitado; tentativas preservadas.
- [x] Remoção de histórico no domínio, preservando artefato/origin/revisions; 52 testes do arquivo passaram.
- [ ] Finalizar QA visual do laboratório (transparência, controles, referências, drag/resize).
- [ ] Spike de montagem com cenas preexistentes, posições/conexões explícitas e originais preservados; sem alegar encaixe físico.
- [ ] Consolidar testes mais intensos de decomposição/fidelidade com critérios e limitações.
- [ ] Conferir frentes, testes gerais/gateway, build, QA desktop/tablet/mobile e review cruzado.
- [ ] Auditar arquivos a versionar (sem chaves/temporários); commit da entrega na branch e merge local na main, mantendo trabalho recuperável.

Itens antigos implementados estão no BACKLOG_AUDIT; lacunas de QA não são automaticamente defeitos de implementação. Atualizar este plano conforme evidências de conclusão, sem marcar etapa concluída só por ter código.

## Etapa seguinte autorizada — persistência remota e deploy

- Supabase como persistência/Auth/Storage; backend próprio permanece, sem Edge Functions.
- Login restrito a `wylgnerbossman@gmail.com`, com autorização no backend e RLS, sem cadastro público.
- Migrar projetos/planos, notas, chat, referências, anexos e mídias; preservar backup local e verificar conteúdo/contagens antes de marcar migração.
- P&D confirmado nesta sessão: organização `hhimdmantemhxnikmklr`, projeto `wxfootrnfiqpzhmjwgck`, saudável. A conexão anterior estava desatualizada; nenhum recurso de MEGA VALE será usado.
- Railway `externo` identificado por listagem: projeto `38067bb4-755b-4caa-b005-e5eee0b9640d`, serviço existente `cellproject-builder` (`cf9b32e5-21a2-4b2f-8e9c-d1ba11562fb8`). Inspecionar estado e configuração antes de mudar/deploy.
- Não expor chaves no bundle, logs, Git ou cache; novas configurações privadas por canal de ambiente.
- Testar autorização, RLS, mídia privada, conflitos/falhas de sincronização e reload em outro dispositivo antes da conclusão.

## Evidência de consolidação (10/10)

- Frentes A/B/C implementadas e revisadas; 933 testes frontend passaram, 8 de API real ficaram pulados. Gateway: 81 passaram.
- Correção posterior PWA de lazy chunks em abas antigas: 14 testes passaram, revisão cruzada confirmou. Build final `npm run build` passou.
- QA real: 390×844 sem overflow, estúdio utilizável; 768×1024 chat em overlay; desktop Ctrl+wheel amplia o modelo sem mudar grafo, página ou seleção. Lápis abre barra com texto, @ e anexos.
- Laboratório React/SVG: parâmetros, seleção de nó, transparência, mover/redimensionar verificados. Spike de montagem preserva três cenas e permite animação montada/explodida; 12 testes do laboratório passaram. Integração deste spike no produto ainda pendente.
- Usuário aprovou a arquitetura declarativa React/SVG como direção dos artefatos interativos. Ensaios não demonstram aprendizagem, precisão física ou superioridade estatística.

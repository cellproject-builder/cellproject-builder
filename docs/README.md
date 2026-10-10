# Documentação do Dynamic Diary

Entrada mantida em 10/10/2026. As fichas descrevem o código desta revisão e apontam suas evidências; os relatórios registram o que foi efetivamente executado em uma data. Eles têm funções diferentes.

## Produto e engenharia

| Documento | Uso |
| --- | --- |
| [Módulos](modules/README.md) | Finalidade, fluxos, contratos, integração, persistência, testes e limites por área |
| [Arquitetura](architecture.md) | Propriedade dos dados e caminho de uma ação |
| [Mapa do repositório](repository-map.md) | Pastas, regras de localização e classificação de artefatos |
| [Sistema visual](design/system.md) | Tokens, superfícies e componentes de interface |
| [Scripts](../scripts/README.md) | Verificações, geração de assets e experiências manuais |

## Pesquisa e artigos

- [Objetivo aprovado SENAI](OBJETIVO_DO_ARTIGO.md): referência canônica da contribuição candidata e do ciclo de evidências.
- [Guia para artigos](research/README.md): como descrever a implementação, selecionar evidências e evitar conclusões além dos testes.
- [Laboratórios e protocolos](research/README.md#experimentos-e-artefatos-existentes): comparações 3D, geometria, diagramas e desconstrução.
- [Qualidade de planos](design/plan-quality/README.md): primeiras respostas reais, condições de referência, rubrica humana e limites; [rodada de qualidade e desempenho](reports/planning-quality-performance-2026-10-10.md).
- [PDF no navegador real](design/pdf-worker-validation/README.md): extração, cancelamento e encerramento do worker com CSP de produção, sem chamadas de IA.
- [Gestos do Board](design/ink-gesture-validation/README.md): pan/pinça, opção de dedo e paleta em canvas estreito/baixo, com limites de hardware explícitos.
- [Template do resumo expandido](Template_ResumoExpandido2026.6bced2c68d504ba99fc5.md) e [referência do congresso](III_Congresso_UniSENAI_SP_2026.md): materiais de redação; verificar as exigências do evento ao submeter.

## Configuração e contratos específicos

| Área | Referências complementares |
| --- | --- |
| Produção e dados | [Cloud](cloud-production.md), [cofre](encrypted-vault.md), [migração cloud](cloud-client-migration.md), [PWA](pwa.md), [edição offline cifrada](offline-editing.md) |
| Projetos e fontes | [Anexos](plan-attachments.md), [aparência](project-appearance.md), [pesquisa no chat](chat-component-research.md) |
| Superfícies visuais | [Abas do estúdio](visual-studio-tabs.md), [caderno](notes-visual-notebook.md), [validação do canvas](visual-canvas-validation.md) |
| Modelagem | [Guia adaptado de skills](visual-modeling-skills.md), [decomposição](design/object-decomposition.md), [geração avançada](design/advanced-model-generation.md) |
| Evolução proposta | [Biblioteca de fontes nos canvases](superpowers/specs/2026-10-10-canvas-source-library-design.md), [direção do Dairo](dairo-direction.md), [assinatura Codex para futura versão open source](design/codex-subscription-feasibility.md), [conceito inicial](CONCEPT.md) |

Os documentos específicos preservam detalhes e validações anteriores; o catálogo dos módulos orienta a leitura atual. Uma recomendação, protótipo ou checklist antigo não prova entrega.

## Histórico de decisões e revisões

[Relatórios](reports/README.md) concentram auditorias; [planos](superpowers/plans/) e [especificações](superpowers/specs/) preservam decisões de implementação. O [arquivo de conceitos](archive/README.md) contém identidade e telas iniciais com nomes antigos.

[data-architecture.md](data-architecture.md) e [database/workspace-schema.sql](database/workspace-schema.sql) incluem um desenho relacional histórico. As migrações ativas estão em [supabase/migrations](../supabase/migrations/), com limites descritos em [dados e privacidade](modules/data-and-privacy.md). Não aplicar o desenho histórico como se fosse o esquema de produção.

## Manter a documentação

Ao alterar um contrato, atualizar a ficha proprietária e seus links. Ao executar uma avaliação, registrar comando, revisão do código, ambiente, resultado e limite em um relatório; não substituir resultados antigos. Ao propor uma funcionalidade, marcar como proposta até existir implementação verificável. Executar `npm run check:repo` após mover arquivos ou atualizar navegação.

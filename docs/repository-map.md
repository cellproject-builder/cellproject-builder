# Mapa e regras do repositório

Organização revista em 10/10/2026. Este mapa localiza responsabilidades; as [fichas dos módulos](modules/README.md) descrevem o comportamento. Nomes de pastas não são prova de uma funcionalidade entregue.

## Diretórios de primeiro nível

| Caminho | Proprietário/conteúdo | Regra |
| --- | --- | --- |
| [src](../src/) | Aplicação cliente e contratos | Código de produto, testes próximos dos proprietários |
| [server](../server/) | Node: Auth, cloud, IA, fontes públicas e mídia | Credenciais/autoridade no servidor; sem importar componentes cliente |
| [public](../public/) | Assets públicos, manifesto e worker | Nunca dados privados, chaves ou saídas de usuário |
| [scripts](../scripts/README.md) | Ferramentas manuais e checks | Explicitar efeitos, entradas, saídas e chamadas pagas |
| [supabase](../supabase/) | Migrações e fixtures SQL | Separar esquema ativo de desenho histórico |
| [docs](README.md) | Módulos, pesquisa, operação e histórico | Índices mantidos; resultados datados e preservados |
| [.agents/skills](../.agents/skills/) | Skills locais usadas como referência | Preservar proveniência e versão; guia adaptado tem contrato próprio |

`node_modules/`, `dist/`, `.vite/`, `*.tsbuildinfo`, `.atlas/` e saídas `.codex-audit-*` são dependências, caches, build ou material local de inspeção ignorados pelo Git. Não são código a modularizar. `.env*` é ignorado, com exceções para `.env.example` e `.env.*.example`, que devem conter somente exemplos sem segredos. Ignore não retira arquivos já rastreados do histórico. Não abrir nem mover valores privados para documentação.

## Domínios em src

| Caminho | Responsabilidade e fronteira |
| --- | --- |
| [store.ts](../src/store.ts), [types.ts](../src/types.ts) | Plano aberto, mutações, critérios e evidências; tipos de domínio |
| [graph](../src/graph/) | Índice/layout de árvore e utilidades do grafo, separados do store |
| [workspace](../src/workspace/) | Projetos, tarefas, sprints, notas, navegação e ponte com planner |
| [workspace/project-appearance](../src/workspace/project-appearance/) | Schema de aparência, catálogo SVG, seletor e estilos coesos |
| [boards](../src/boards/) | Documento, operações, canvas e composição do Dynamic Board |
| [visuals](../src/visuals/) | Pesquisa, modelagem, decomposição, contratos e UI das ferramentas visuais |
| [visuals/diagram](../src/visuals/diagram/) | Contrato e renderização de diagramas declarativos |
| [visuals/rendering](../src/visuals/rendering/) | Renderização/câmera dos artefatos; não orquestrar provedores aqui |
| [visuals/ui](../src/visuals/ui/) | Janelas, abas, rascunhos e composição dos estúdios |
| [chat](../src/chat/), [ai](../src/ai/) | Conversas e preparação/execução das ferramentas e pedidos de IA |
| [attachments](../src/attachments/), [references](../src/references/), [kb](../src/kb/) | Ingestão de fontes, referências explícitas e base de conhecimento |
| [cloud](../src/cloud/), [data](../src/data/) | Persistência, cofre, migração e transferência/backup |
| [components](../src/components/) | Interfaces do planner; não é destino padrão de toda funcionalidade nova |
| [config](../src/config/), [i18n](../src/i18n/), [pwa](../src/pwa/) | Configuração cliente, tradução e instalação/cache do shell |
| [landing](../src/landing/), [hooks](../src/hooks/), [test](../src/test/) | Entrada visual, hooks comuns e infraestrutura de teste |

`src/circuits/` estava vazio na inspeção: não há módulo de circuitos implementado a documentar. Não foi criado um placeholder para sugerir entrega.

Os contratos puros devem depender de tipos/utilidades puras. O check transitivo protege atualmente sete entradas: `boards/model`, `noteCanvasModel`, `projectAppearance`, `diagram/model`, `rendering/modelItem`, `graph/treeIndex` e `graph/treeLayout`. Ele não demonstra ausência de ciclos no repositório inteiro nem detecta toda forma de código morto.

## Documentos e material experimental

| Caminho | Conteúdo |
| --- | --- |
| [modules](modules/README.md) | Fichas atuais por módulo |
| [research](research/README.md) | Direção científica, uso de evidências e protocolos existentes |
| [design](design/) | Sistema visual e laboratórios com páginas/fixtures/resultados |
| [reports](reports/README.md) | Auditorias e resultados datados |
| [archive](archive/README.md) | Conceitos/identidade históricos, sem remover a proveniência |
| [superpowers](superpowers/) | Planos e especificações das rodadas de desenvolvimento |

As URLs dos laboratórios sob `docs/design/` foram preservadas. Um resultado ruim é evidência de uma tentativa e não deve ser apagado por parecer lixo. Os templates de artigo permanecem juntos de seus materiais associados; o índice aponta para eles sem reinterpretar exigências acadêmicas.

## Onde colocar o próximo arquivo

1. Identificar o domínio dono do conteúdo e de suas mutações. Colocar schema/operação junto dele e teste junto do contrato; teste de integração fica junto da superfície integrada.
2. Separar dados persistidos de estado transitório. Janelas/câmeras não devem determinar identidade de documentos ou componentes reais.
3. Compartilhar um renderer ou extrator por contrato comum comprovado. Não obrigar Board/nota a abrir um plano fictício para reutilizar código.
4. Manter exemplos sintéticos nos testes/fixtures e experiências em diretório com protocolo. Nunca usar dados privados como fixture.
5. Documentar o módulo e atualizar imports/índices ao mover. Executar checks apropriados; renomear pastas não prova escalabilidade.

## Classificação usada antes de limpar

- **Fonte ativa:** preservar e reorganizar com imports/testes. Aplicado à aparência e aos helpers de árvore.
- **Gerado e conflitante:** remover somente após identificar origem/efeito. As cópias ignoradas `vite.config.js` e `vite.config.d.ts` na raiz eram emissões antigas; o JavaScript tinha precedência sobre a configuração fonte. Os comandos agora selecionam `vite.config.ts` explicitamente.
- **Histórico útil:** arquivar com descrição. Cinco HTMLs iniciais foram para `archive/early-concepts`; relatório de design foi para `reports`.
- **Ferramenta manual:** documentar e preservar. Os geradores de identidade e de ícones PWA possuem saídas diferentes; não eram duplicados.
- **Resultado/fixture:** preservar versão, entradas e falhas. Não concluir inutilidade apenas por ausência de import de produção.
- **Cache/dependência local:** manter fora do versionamento. Não houve limpeza recursiva de diretórios nesta rodada.

Pendências de separação por risco estão no [relatório da revisão](reports/repository-review-2026-10-10.md). O repositório ainda possui coordenadores grandes; a melhoria desta rodada é delimitada e verificável.

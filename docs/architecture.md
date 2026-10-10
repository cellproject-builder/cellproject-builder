# Arquitetura do Dynamic Diary

Referência de organização do código em 10/10/2026. A direção científica permanece em [OBJETIVO_DO_ARTIGO.md](OBJETIVO_DO_ARTIGO.md); configuração de produção em [cloud-production.md](cloud-production.md).

O [catálogo dos módulos](modules/README.md) detalha contratos, fluxos e limites por funcionalidade. O [mapa do repositório](repository-map.md) orienta a localização de código e documentos; o [guia de pesquisa](research/README.md) distingue implementação, verificação técnica e resultado empírico.

## Propriedade dos dados

| Área | Proprietário | Limite |
| --- | --- | --- |
| Plano aberto | `src/store.ts` | Grafo, critérios, evidências, sugestões e artefatos do plano |
| Projetos, execução, notas e quadros | `src/workspace/store.ts` | Ações validadas; snapshots de planos pela ponte `workspace/planner.ts` |
| Dynamic Board | `src/boards/model.ts`, `operations.ts` | Documento próprio no workspace; não cria notas ou planos fictícios |
| Caderno da nota | `src/workspace/noteCanvasModel.ts` | Documento opcional pertencente à nota; traços, imagens e diagramas |
| Conversas | `src/chat/store.ts` | Histórico e resultados das ferramentas, separados do workspace |
| Abas, janelas e controles 3D | `src/visuals/ui/sessionStore.ts`, `rendering/viewStore.ts` | Estado temporário; não define identidade do conteúdo gerado |
| Persistência | `src/cloud/storage.ts`, `src/data/workspaceRepository.ts` | Adaptadores locais/remotos; componentes não gravam diretamente no banco |

O planner e o workspace mantêm responsabilidades distintas. A ponte captura o plano no projeto e restaura o projeto solicitado. Uma tela visual reutiliza renderizadores e contratos, sem depender de abrir um projeto auxiliar.

Índice de filhos e layout da árvore ficam em [graph/treeIndex.ts](../src/graph/treeIndex.ts) e [graph/treeLayout.ts](../src/graph/treeLayout.ts), sem dependência de store, UI ou IA. `store.ts` mantém reexports compatíveis. Aparência dos projetos fica no domínio coeso [workspace/project-appearance](../src/workspace/project-appearance/). `npm run check:repo` protege sete fronteiras transitivas de contratos puros, sem pretender auditar todos os ciclos da aplicação.

## Caminho de uma ação

1. A interface ou ferramenta do chat chama uma ação de domínio.
2. O domínio valida conteúdo, limites e escopo antes de alterar o store.
3. O adaptador persistente recebe o envelope. A fila de gravações é aguardada por exportação e encerramento da sessão.
4. Geração, busca e importação assíncronas guardam a identidade de seu contexto e verificam essa identidade antes de aplicar resultados.

Operações de IA e de ingestão usam registros de atividade. Uma conversão de arquivo pendente conta como atividade desde a leitura, não somente durante a chamada do provedor. Minimizar uma ferramenta mantém sua operação montada; cancelamento e saída do escopo seguem o contrato da ferramenta.

## Fronteira visual

- React/SVG recebe um documento declarativo validado por `visuals/diagram/model.ts`; não executa código recebido da IA.
- Modelos recebem cenas e geometria validadas. A renderização fica em `visuals/rendering`, separada dos serviços de geração e pesquisa.
- `decompositionState.ts` verifica identidade e atualidade do dossiê sem importar serviços de IA. Pesquisa e aplicação permanecem em `decomposition.ts`.
- Canvas, prévia 3D e inspetor de decomposição carregam sob demanda. `npm run check:bundle` verifica o grafo real de produção, inclusive dependências transitivas.
- Imagens incorporadas em notas/quadros têm limites próprios e não dependem da coleta de mídias do planner.

Os dados geométricos são ilustrativos até que uma fonte ou medição os sustente. Estado de câmera, posição de janela ou zoom não deve invalidar a pesquisa de identidade de um componente.

## Regras para extensão

Reutilizar ações e contratos existentes antes de criar outro store, modal ou formato de documento. Novos motores visuais devem compartilhar renderização, mas receber contexto explicitamente delimitado por plano, nota ou quadro. Uma nova atividade assíncrona precisa definir cancelamento, descarte de respostas atrasadas, aplicação e persistência antes de ganhar interface.

Não extrair um componente genérico só porque duas telas parecem semelhantes: primeiro identificar um contrato comum. Também não ligar o renderer a um serviço de IA para obter uma função de validação; separar consultas de estado das operações caras.

## Documentação histórica

[data-architecture.md](data-architecture.md) descreve a proposta relacional inicial e os formatos de transferência. Seu SQL é um desenho, não o esquema ativo da persistência remota. Para a configuração atual, consultar `cloud-production.md` e o código de `cloud/` e `server/`.

O [plano de consolidação](superpowers/plans/2026-10-10-system-consolidation.md) registra a revisão desta etapa; medições, validação e limites estão no [relatório de consolidação](consolidation-audit-2026-10-10.md).

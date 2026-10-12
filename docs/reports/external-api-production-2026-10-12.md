# API externa e MCP em produção — 12/10/2026

A API foi ativada em `https://builder.cellprojectdiary.com`, no serviço `cellproject-builder` do ambiente `production` do projeto Railway `externo`. O MCP por stdio foi testado contra essa API usando a configuração privada entregue nesta máquina. O runtime externo pode consultar e alterar conteúdo persistente usando sua própria inteligência.

## Ativação e publicação

- Migração [20261012034451_cellproject_external_runtime.sql](../../supabase/migrations/20261012034451_cellproject_external_runtime.sql) aplicada ao Supabase `wxfootrnfiqpzhmjwgck`; versão confirmada no histórico remoto.
- Configuradas pelo Railway CLI as variáveis antes ausentes `EXTERNAL_API_ENABLED`, `EXTERNAL_API_ENCRYPTION_KEY` e `SUPABASE_SECRET_KEY`. As configurações cloud/cofre existentes foram preservadas. Nenhum valor dessas chaves aparece neste relatório ou no JSON MCP.
- A chave de servidor foi verificada por RPC real: HTTP 200 e resultado nulo para um hash sem credencial correspondente.
- SQL verificado: 22 funções, incluindo nove wrappers públicos; `anon` sem execução; `authenticated` limitado a cadastro/listagem/revogação; `service_role` limitado às operações internas de autenticação, snapshot, recibo, commit e blobs. As duas tabelas privadas usam RLS e não têm acesso direto concedido a esses papéis.
- Deployment por CLI verificado: `295e1840-3583-4884-b2f7-68cc829a69cb`, estado `SUCCESS`. `/healthz` e `/demo` responderam 200; o demo manteve CSP. A API recusou acesso sem bearer com 401.
- Fonte integrada em worktree isolada, baseada em `75fd891406864a147069c046c41756dbe57f9727`. Foram preservados o demo público de `e303113`, a leitura durante conflito de `bd2fd1c`, as cópias de conflitos de `db36730` e a correção da sessão offline de `75fd891`.
- Adaptações de integração: `archivedSession: null` no seed do demo; preservação de `archivedSession` e da propriedade explícita do planner nas cópias de conflitos; normalização dos timestamps PostgREST para ISO UTC. Regressões demonstraram falha antes das duas últimas correções e passaram depois.

O primeiro upload da API (`60e68820-1d56-4d89-9327-d7142e27ba6c`) foi substituído pela versão integrada acima. A fonte foi preparada na branch local `codex/api-mcp-production`, sobre a última `main`, para manter a integração nos próximos deploys automáticos. A árvore original do usuário não foi resetada nem teve suas alterações descartadas.

## Verificação da versão entregue

| Verificação | Resultado |
| --- | --- |
| Frontend completo antes dos dois deltas concorrentes | 2.775 passaram, oito ignorados, zero falhas |
| Gateway completo com PGlite real isolado | 336 passaram, um caso de symlink ignorado no Windows, zero falhas |
| Integração de conflito, merge, runtime, cofre, propriedade e demo | 248 passaram, zero falhas |
| Delta de sessão offline e estado cloud | 67 passaram, zero falhas |
| Correção de timestamps, HTTP, segurança e SQL | 32 passaram, zero falhas; inclui preservação da chave selada no replay do cadastro |
| Demo isolado | 19 passaram |
| Build final TypeScript/Vite/worker externo | Passou |
| `check:repo`, `check:gateway`, `check:bundle`, diffchecks | Passaram; nenhum módulo de feature antecipado no bundle |
| Revisão independente da integração | Nenhum achado Critical/Important aberto |

A primeira execução do gateway concorria com builds e teve falhas de inicialização/timeout de workers. A repetição controlada com concorrência dois terminou sem falhas. A auditoria de dependências manteve 27 alertas preexistentes, incluindo dois críticos nas ferramentas de teste já presentes na base; nenhuma dependência adicionada apareceu nesses alertas.

## MCP real e configuração para copiar

O teste de produção terminou em 12/10/2026, às 04:12 UTC, usando o processo MCP real iniciado pelo JSON privado:

1. Conectou e listou **140 ferramentas**.
2. Leu projetos e paginou as pastas com revisão consistente.
3. Criou uma pasta sintética com nome UUID, sem alterar projetos existentes.
4. Repetiu exatamente a mesma operação e recebeu o mesmo resultado com `replayed: true`.
5. Leu a pasta criada e o recurso `cellproject://capabilities`, com catálogo de 140 operações.
6. Removeu somente a pasta sintética de ID/nome confirmados e verificou sua ausência.
7. Verificou que os diagnósticos não continham a credencial.

Resultado: `ok: true`, `projectRead: true`, `writeReadCleanup: true`, `durableReplay: true`, `capabilitiesResource: true`, `syntheticFolderRemoved: true`.

A credencial **Runtime externo** concede leitura e alterações em todos os projetos e no conteúdo da conta. Expira em **11/11/2026 às 01:03, America/Sao_Paulo** (`2026-11-11T04:03:23.703Z`). O cadastro foi confirmado com a mesma identidade após corrigir o formato de timestamp; nenhuma credencial duplicada foi criada. Revogação disponível em **Configurações → API e MCP**.

O JSON completo está em `C:/__dev_ops__/@artigo/cellproject-builder/.mcp-runtime.private.md`, com ACL restrita ao usuário Windows, exclusão verificada no Git e ausência verificada no checkout de publicação. A cópia temporária do navegador foi limpa após a gravação. O [modelo público de configuração](../MCP_RUNTIME.md) mantém somente um marcador para o token.

## Limites

O JSON entregue inicia um processo local e requer runtime com MCP por **stdio**, Node.js 22 ou superior e as dependências do projeto. Em outra máquina, ajustar os caminhos e instalar as dependências. A API é remota; esta entrega não oferece endpoint MCP HTTP remoto ou OAuth. O teste real cobre leitura, gravação, recibo e limpeza; a cobertura detalhada dos módulos está na [matriz de ações](external-action-coverage-2026-10-11.md). Não houve execução física de experimentos nem teste de cada uma das 140 operações contra dados reais do usuário.

Para desativar o acesso externo, usar `EXTERNAL_API_ENABLED=0`, preservando a chave de cifragem e os dados. Para retirar apenas esta integração, revogar a credencial pelo painel.

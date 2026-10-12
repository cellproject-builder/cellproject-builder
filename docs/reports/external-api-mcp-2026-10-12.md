# API externa e MCP — 12/10/2026

Este relatório registra a implementação e a validação local. A ativação posterior e o teste real de produção estão no [relatório de publicação API/MCP](external-api-production-2026-10-12.md).

## Resultado

A implementação local oferece **140 operações** para um runtime externo consultar e alterar o conteúdo persistente do Cellproject usando sua própria inteligência. A API HTTP executa as regras de domínio do aplicativo; o adaptador MCP publica o mesmo catálogo por stdio e chama essa API. Não é necessário configurar um provedor de IA interna para essas operações.

O catálogo reúne 126 operações de domínio, oito de mídia original e seis de backup. Inclui projetos, tarefas, sprints, comentários, notas, boards, construção e execução dos planos, critérios, evidências, falhas, replanejamento, artefatos visuais, conversas, conhecimento pessoal e preferências. A [matriz de cobertura](external-action-coverage-2026-10-11.md) discrimina os módulos; o [guia de integração](../EXTERNAL_API.md) contém ativação, contratos, exemplos HTTP e configuração MCP.

As regras compartilhadas preservam, entre outros casos, a autoridade do plano ativo, a identidade do proprietário, a exigência de resolver falhas antes da conclusão e a invalidação de alternativas quando objetivo, regras ou anexos mudam. A revisão anterior do núcleo está registrada em [Núcleo dos planos](plan-core-audit-2026-10-11.md).

## Acesso, persistência e sincronização

O painel **Configurações → API e MCP** cria credenciais com projetos autorizados, permissões, expiração e revogação. O token completo aparece na criação; o banco recebe seu hash. A delegação permite que o servidor abra o cofre durante uma operação autorizada, mantendo documentos, originais e recibos cifrados no armazenamento. A chave de delegação fica selada com uma chave exclusiva do servidor.

Cada ação exige UUID e revisão do cofre. Autorização, revisão e recibo são conferidos na transação de publicação. Repetir a mesma requisição recupera o recibo; reutilizar o UUID com outro conteúdo ou tentar escrever sobre uma revisão antiga retorna conflito. Expiração e revogação também são verificadas em recuperações de recibos. Alterações remotas de conversa, conhecimento e preferências entram na sincronização do cliente, respeitando edições locais em andamento.

Mídia é validada por formato, tamanho, integridade e proprietário antes da publicação. Backups reutilizam o contrato da interface e permitem preparar documentos em blocos cifrados: o teste de regressão reconstrói um documento de 32 MiB em quatro blocos. A importação confere hashes, tamanhos, ordem, UTF-8 e propriedade antes do commit; conteúdo existente divergente não é sobrescrito.

## Validação observada

| Verificação | Resultado |
| --- | --- |
| `npm test -- --maxWorkers=2 --reporter=json --outputFile=...` | **2.754 testes passaram, oito ignorados, nenhuma falha; 256 arquivos** |
| Regressões focadas nos arquivos finais de integração, cofre, conteúdo e interface | **204 testes passaram, nenhuma falha; 16 arquivos** |
| `node --test --test-concurrency=2 "server/*.test.mjs"`, com `CELLPROJECT_TEST_PGLITE_DIR` configurado | **335 testes passaram, um ignorado, nenhuma falha; 336 testes no total** |
| Banco isolado com PGlite | Seis migrações executadas; permissões SQL, cadastro, publicação com revisão, recibos, revogação e expiração efetiva verificados |
| MCP com processo real | Cliente e subprocesso trocaram catálogo, consultas, ações e recursos; integração completa passou sem provedor de IA configurado |
| Compatibilidade Node 22 | Imports de produção e sondagens independentes passaram; a revisão final de backup e integração teve 21 testes aprovados |
| `npm run build` | TypeScript, Vite e bundles do domínio/validação externa concluídos com código 0 |
| `npm run check:bundle` | Aprovado; nenhuma importação antecipada dos módulos de funcionalidade monitorados |
| Revisão independente | Nenhum achado Critical/Important pendente após correções e regressões |
| `npm run check:repo`, `npm run check:gateway`, `git diff --check` | Aprovados no fechamento da documentação |

O teste ignorado no servidor exige criar symlinks, recurso indisponível neste ambiente Windows. Os testes SQL foram executados. O build conserva os avisos existentes de Browserslist e chunks acima de 500 kB. A auditoria das dependências de produção registrou 11 alertas existentes (cinco baixos e seis altos); não foi aplicada uma atualização forçada fora do escopo.

Os resultados completos ficaram nos arquivos locais `cellproject-api-vitest-20261012.json`, `cellproject-api-focused-final-20261012.json`, `cellproject-api-gateway-delivery-20261012.log`, `cellproject-api-build-final-20261012.log` e `cellproject-api-bundle-final-20261012.log`, no diretório temporário da sessão. Os testes permanentes estão versionáveis no checkout; os logs temporários não fazem parte da entrega.

## Ativação e limites

A entrega está no checkout, sem commit, publicação ou aplicação remota da migração nesta rodada. Para ativar em produção:

1. Aplicar [20261012034451_cellproject_external_runtime.sql](../../supabase/migrations/20261012034451_cellproject_external_runtime.sql) no projeto Supabase correspondente. O nome local foi alinhado ao timestamp atribuído pelo banco na ativação posterior.
2. Configurar `EXTERNAL_API_ENABLED=1`, `EXTERNAL_API_ENCRYPTION_KEY` e `SUPABASE_SECRET_KEY` no servidor, além de cloud/cofre já habilitados.
3. Publicar o build com `dist` e `dist-server`; entrar na conta, desbloquear o cofre e criar a credencial pelo painel.
4. Configurar URL/token no runtime HTTP ou no processo MCP, conforme o [guia](../EXTERNAL_API.md).

A paridade cobre ações e regras persistentes. Navegação, seleção, desfazer em memória, captura de microfone, login/senha e geração pela IA interna permanecem ações do cliente ou do runtime. Dados exclusivamente locais precisam ser migrados para o cofre cloud. O transporte entregue é MCP stdio; endpoint MCP HTTP remoto e OAuth não fazem parte desta versão.

As requisições HTTP/MCP têm limite de 16 MiB. Documentos de backup reconstruídos têm limite de 32 MiB e o manifesto cifrado de 96 MiB. O processamento externo admite duas operações simultâneas no servidor, com worker de domínio limitado a 15 segundos e 512 MiB de heap. A quota de blobs cifrados é 700 MiB por conta, incluindo preparações; blobs imutáveis substituídos ou abandonados permanecem sujeitos à retenção e limpeza.

Não houve cadastro de credencial numa conta real, inspeção visual do painel em navegador real, chamada paga a modelos, ensaio físico ou teste de produção nesta rodada. A validação local não comprova a ativação remota.

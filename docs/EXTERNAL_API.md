# API externa e MCP

Contrato de integração publicado em `https://builder.cellprojectdiary.com` em 12/10/2026. O runtime externo consulta e altera conteúdo persistente usando sua própria inteligência. A API executa operações determinísticas do aplicativo, sem chamar modelos internos. O transporte MCP desta versão é um processo local por stdio que chama a API HTTP; não existe endpoint MCP remoto ou configuração OAuth nesta entrega.

A migração, as variáveis, o deployment e o teste MCP real estão registrados no [relatório de ativação em produção](reports/external-api-production-2026-10-12.md). Para copiar o JSON desta máquina, consultar [Configurar o MCP no runtime](MCP_RUNTIME.md).

## Ativação no servidor

Além da configuração cloud existente, configurar no ambiente do servidor:

| Variável | Valor |
| --- | --- |
| `EXTERNAL_API_ENABLED` | `1` para habilitar a API e o cadastro de integrações |
| `EXTERNAL_API_ENCRYPTION_KEY` | Chave aleatória de 32 bytes em base64 canônico, exclusiva desta integração |
| `SUPABASE_SECRET_KEY` | Chave secreta de servidor do projeto Supabase autorizado; nunca uma chave enviada ao cliente |

Aplicar a migração [20261012034451_cellproject_external_runtime.sql](../supabase/migrations/20261012034451_cellproject_external_runtime.sql) antes de ativar. Ela fornece credenciais, autorização e recibos persistentes. A ativação também exige cloud e cofre cifrado habilitados. A migração foi aplicada ao projeto de produção em 12/10/2026; em outro ambiente, conferir o histórico antes de aplicar.

O servidor abre o conteúdo do cofre durante uma operação autorizada, conforme a delegação criada pelo usuário, e grava novamente o manifesto e os recibos cifrados. A credencial enviada ao runtime não é uma chave de provedor de IA, cookie do navegador, senha ou chave de recuperação. A chave de delegação é selada separadamente; não publicar `SUPABASE_SECRET_KEY` nem `EXTERNAL_API_ENCRYPTION_KEY` em configurações MCP, frontend ou logs.

## Criar e revogar uma credencial

Entrar na conta, desbloquear o cofre e abrir **Configurações → API e MCP**. Informar um nome, os projetos autorizados, permissões e expiração. Copiar a credencial exibida após o cadastro para o ambiente do runtime. O token completo é exibido nessa criação; a lista posterior mostra somente metadados e prefixo. Revogar pelo mesmo painel quando a integração não precisar mais de acesso.

As rotas de gestão usam a sessão autenticada do navegador e suas proteções de origem:

| Método e rota | Finalidade |
| --- | --- |
| `GET /api/integrations/external` | Estado de ativação e metadados das credenciais |
| `GET /api/integrations/external/enrollment` | Chave pública temporária para selar a delegação |
| `POST /api/integrations/external/credentials` | Registrar hash do token, concessões e delegação selada |
| `DELETE /api/integrations/external/credentials/:uuid` | Revogar uma credencial |

Usar o fluxo do painel para o cadastro: ele prepara a delegação criptográfica. Enviar apenas um token a esse endpoint não constitui um cadastro válido. A autorização é conferida em cada operação; revogar uma credencial também bloqueia chamadas posteriores de um processo MCP já aberto.

## API HTTP v1

Todas as chamadas usam `Authorization: Bearer <credencial-da-integração>`. Cookies não substituem esse bearer. O servidor verifica dono, expiração, revogação, permissões e projetos autorizados. O catálogo descreve operações; sua presença no catálogo não concede permissão para executá-las.

| Método e rota | Entrada | Saída |
| --- | --- | --- |
| `GET /api/v1/capabilities` | Sem corpo | `{version:1, revision, catalog}` |
| `POST /api/v1/query` | `{name, input?, projectId?}` | `{revision, result}` |
| `POST /api/v1/actions` | `{name, input?, projectId?, operationId, baseRevision}` | `{revision, result, replayed?}` |

Cada entrada do catálogo informa `name`, `kind`, `description`, `inputSchema`, `permission`, `projectRequired` e, quando presente, `scope`. Consultar esse schema antes de construir o corpo. O `projectId` pertence ao envelope da chamada, fora de `input`. Operações que exigem projeto recebem esse identificador; operações da conta ou de descoberta de projetos não o recebem.

`baseRevision` é a revisão inteira positiva do cofre retornada pela leitura atual. `operationId` é um UUID gerado pelo cliente para uma tentativa lógica. Repetir exatamente o mesmo corpo com esse UUID recupera o recibo em vez de aplicar novamente a operação; reaproveitar o UUID com conteúdo diferente causa conflito. O commit verifica autorização e revisão na mesma transação que registra o recibo cifrado.

Em `409`, reler o estado e decidir como reconciliar a intenção. Não trocar a revisão e repetir automaticamente. Se uma resposta se perder, repetir o corpo original com o UUID original permite consultar o recibo. Não gerar um novo UUID apenas porque houve timeout.

Exemplos no PowerShell, com URL e credencial já colocadas nas variáveis de ambiente do runtime:

```powershell
# Descobrir operações e obter a revisão atual.
curl.exe --fail-with-body --silent --show-error `
  --header "Authorization: Bearer $env:CELLPROJECT_API_TOKEN" `
  "$env:CELLPROJECT_API_URL/api/v1/capabilities"

# Ler os projetos permitidos para esta credencial.
'{"name":"projects","input":{}}' | curl.exe --fail-with-body --silent --show-error `
  --header "Authorization: Bearer $env:CELLPROJECT_API_TOKEN" `
  --header 'Content-Type: application/json' --data-binary '@-' `
  "$env:CELLPROJECT_API_URL/api/v1/query"
```

Exemplo de ação, após conferir o schema de `task.create` no catálogo e substituir o projeto:

```powershell
$caps = Invoke-RestMethod "$env:CELLPROJECT_API_URL/api/v1/capabilities" `
  -Headers @{ Authorization = "Bearer $env:CELLPROJECT_API_TOKEN" }
$action = @{
  name = 'task.create'
  projectId = '<id-do-projeto-autorizado>'
  input = @{ title = 'Conferir o suporte do servo' }
  operationId = [guid]::NewGuid().ToString()
  baseRevision = $caps.revision
} | ConvertTo-Json -Depth 10 -Compress
$action | curl.exe --fail-with-body --silent --show-error `
  --header "Authorization: Bearer $env:CELLPROJECT_API_TOKEN" `
  --header 'Content-Type: application/json' --data-binary '@-' `
  "$env:CELLPROJECT_API_URL/api/v1/actions"
# Para recuperar uma confirmação perdida, reutilizar $action sem reconstruí-lo.
```

Falhas HTTP usam `{error:{code,message}}`. `401` exige revisar a credencial; `403` indica acesso insuficiente; `409` indica conflito de revisão, identidade ou recibo; `429` indica limite de concorrência/requisições. O MCP mantém status e códigos reconhecidos, com mensagens locais seguras, sem retransmitir corpos de erro brutos do servidor.

O servidor permite até duas operações externas simultâneas no total e por credencial. Cada operação de domínio usa um worker novo, com prazo de 15 segundos, entrada serializada de até 128 MiB e limite de 512 MiB na geração antiga do heap. Esses limites acomodam um manifesto completo sem compartilhar caches entre contas; não aumentam o limite de 16 MiB por requisição HTTP/MCP.

## Executar o MCP local

Para copiar a configuração desta máquina, abrir [JSON para configurar o MCP no runtime](MCP_RUNTIME.md).

Requisitos: Node.js 22 ou superior e as dependências instaladas pelo lockfile. A produção usa Node22. O adaptador usa o SDK oficial `@modelcontextprotocol/server@2.3.1`; os testes usam `@modelcontextprotocol/client@2.3.1`.

Configurar no ambiente do processo:

```text
CELLPROJECT_API_URL=https://cellproject.example
CELLPROJECT_API_TOKEN=<credencial-gerada-no-painel>
```

`CELLPROJECT_API_URL` deve ser a origem canônica da aplicação, sem caminho, usuário/senha, query ou fragmento. HTTPS é obrigatório, com exceção de HTTP para `localhost`, `127.0.0.1` ou `[::1]` em desenvolvimento. Usar a URL final: o adaptador recusa redirecionamentos. A credencial somente vai no cabeçalho de autorização de rotas fixas `/api/v1/*`.

No checkout:

```powershell
npm run mcp
```

Em um cliente MCP que aceita processos stdio, usar `node` diretamente. Adaptar o caminho absoluto para a máquina do runtime:

```json
{
  "mcpServers": {
    "cellproject": {
      "command": "node",
      "args": ["C:/__dev_ops__/@artigo/cellproject-builder/server/mcp.mjs"],
      "env": {
        "CELLPROJECT_API_URL": "https://cellproject.example",
        "CELLPROJECT_API_TOKEN": "<credencial-gerada-no-painel>"
      }
    }
  }
}
```

O subprocesso usa stdout exclusivamente para mensagens MCP; diagnósticos redigidos usam stderr. Lançar `node` diretamente no cliente evita banners do npm misturados ao protocolo. O adaptador oferece:

- `tools/list`: uma ferramenta `query_<name>` ou `action_<name>` para cada entrada do catálogo; por exemplo, `query_projects` e `action_task.create`.
- `tools/call`: consultas aceitam `{input?, projectId?}`; ações também exigem `{operationId, baseRevision}`. `projectId` é obrigatório quando o catálogo indica `projectRequired`.
- `resources/list` e `resources/read`: recurso JSON `cellproject://capabilities`, consultado novamente na API a cada leitura.

Cada listagem e chamada consulta a API com a credencial vigente. As ações não ganham UUID ou revisão automaticamente e não recebem retry automático. Chamadas canceladas cancelam a requisição HTTP em voo; uma gravação já confirmada pelo servidor pode precisar ser recuperada pelo recibo. O bridge limita mensagens e respostas a **16 MiB** e cada requisição HTTP a 30 segundos. Leituras maiores precisam de paginação do catálogo/API; o bridge não converte respostas truncadas em sucesso.

Resultados acima de 1 MiB são entregues em `structuredContent`, com um aviso curto em `content`, para evitar duplicar arquivos em base64 na mesma mensagem. O cliente precisa consumir `structuredContent` e aceitar mensagens de 16 MiB; no SDK oficial, configurar `maxBufferSize: 16 * 1024 * 1024` no transporte stdio do cliente. Clientes que só leem texto podem usar a API HTTP para esses resultados.

O processo usa `serveStdio` do SDK, aceitando o protocolo `2026-07-28` e clientes legados suportados pelo SDK. Não depender de callbacks ao modelo, sampling, navegador aberto, provedores internos ou conectores hospedados. Clientes que aceitam somente um endpoint MCP HTTP remoto precisam de um transporte adicional, que não faz parte desta versão.

## Mídia original

`media.list` e `media.read` consultam os originais de um projeto; `media.put` e `media.delete` os alteram. Usar o `projectId` no envelope. As variantes `personal_media.list/read/put/delete` operam nos originais pessoais e exigem credencial de conta, sem `projectId`. O servidor resolve os identificadores usados pela interface para notas, cadernos, boards e planos e mantém o isolamento por proprietário; um identificador de plano enviado pelo cliente não concede acesso a outro projeto.

`put` recebe `{id,name,mime,base64,sha256,createdAt?}`. `id` é a identidade lógica estável escolhida pelo runtime; `sha256` é o hash SHA-256 hexadecimal dos bytes originais, conferido pelo servidor. São aceitos `application/pdf`, `text/plain`, `text/markdown`, `image/png`, `image/jpeg` e `image/webp`. O limite é 10 MiB por original, 5 MiB por imagem e 16 milhões de pixels decodificados por imagem; formatos e dimensões são validados. A soma de originais ativos tem limite de 50 MiB por escopo e 500 MiB por conta; o armazenamento cifrado mantém uma quota adicional de 700 MiB por conta.

Cada upload recebe um novo UUID de blob, é cifrado antes do armazenamento e só entra no manifesto após o commit que confere revisão e autorização. Substituir um `id` do mesmo escopo mantém a identidade lógica; não é permitido assumir uma identidade de outro escopo. `read` confere hash/tamanho do blob cifrado, autenticação da cifra e hash/tamanho do original antes de retornar `{metadata,base64}`. `list` pagina metadados por `offset`/`limit`, com até 100 itens.

`delete` retira o original do manifesto quando nenhum documento persistido referencia sua identidade. A checagem é conservadora e também pode bloquear uma menção textual ao identificador. Blobs cifrados imutáveis anteriores ficam retidos para a política de limpeza; excluir ou substituir uma referência não apaga imediatamente esses bytes. Os anexos textuais de projeto e da conversa guardam texto extraído; enviar esse texto não arquiva automaticamente o arquivo binário, que deve passar por `media.put` quando necessário.

## Conversas e conhecimento da conta

As consultas `conversations`, `conversation`, `conversation.references` e `knowledge` e as ações de conversa/conhecimento são globais. Exigem uma credencial com projetos `*`; uma credencial restrita a projetos não pode ler essas conversas, referências ou a base pessoal. Não enviar `projectId` no envelope dessas operações. Listagens persistentes usam `offset`/`limit` e retornam `items`, `total`, `offset` e `nextOffset`.

`conversations` lista metadados com filtro `status: active|archived|deleted|all`; `conversation` recebe `{id}` e lê o histórico. `conversation.new`, `rename`, `archive`, `restore` e `delete` mantêm a identidade das conversas. Arquivar a conversa ativa abre outra vazia; restaurar não muda o editor ativo. Excluir apaga mensagens, título e checkpoints, preservando somente o recibo de exclusão para impedir que um dispositivo antigo restaure o conteúdo.

`conversation.message.append` recebe `{id,role,text?,references?,files?,referenceProjectId?}`. `role` aceita `user` ou `assistant`; o runtime fornece a resposta e o servidor gera identidade/data, atualiza o transcript e o histórico correspondente. A operação recusa conversas excluídas, arquivadas ou com turno pendente. Mensagens de usuário podem guardar referências atuais resolvidas pelo servidor e anexos de texto extraído externamente. Quando somente fontes são enviadas, a interface e a API usam o mesmo pedido padrão no idioma da conta. Mensagens de assistente exigem texto e não recebem fontes.

`conversation.references` recebe `{query?,referenceProjectId?,offset?,limit?}` e fornece identidades/fingerprints sem o corpo das fontes, com o limite de 100 sugestões da interface. Cada item selecionado entra em `references` como `{id,kind,projectId,planId?,fingerprint,noteSelection?}`. `noteSelection` usa `{blockId,start,end,original}` para validar a versão e a ocorrência exata; somente o trecho resolvido e limitado entra no snapshot, sem o campo `original`. O servidor recusa fingerprints antigos, fontes ausentes e duplicações. `referenceProjectId` informa o contexto das fontes e deve existir, sem mudar a autorização global.

Cada arquivo fornecido em `files` usa `{name,kind,size,text,truncated,pages?}`; `kind` aceita `text`, `pdf` ou `document`. A extração ocorre no runtime. O servidor calcula o fingerprint sobre o texto recebido, cria ID/data e guarda até 24.000 caracteres, marcando recorte quando necessário. Entradas aceitam até 4 Mi caracteres de extração; arquivos de texto têm limite de 1 MiB na origem, PDF/DOCX de 8 MiB e PDF de 100 páginas. Quando `referenceProjectId` está presente, o anexo também entra na coleção do projeto pela mesma deduplicação da interface. O limite é 20 referências e 12 anexos por mensagem/projeto. O histórico usa os mesmos avisos de fontes não confiáveis e os mesmos recortes de contexto da interface, sem classificação ou geração interna. O catálogo publica o schema estrito; snapshots fornecidos pelo cliente, IDs/data de arquivo ou fingerprints de anexo não substituem os valores calculados pelo servidor.

`knowledge.add` recebe `{filename,sizeBytes,pageCount,extractedText,summary}`: texto integral extraído externamente e resumo estruturado compatível com `KBSummarySchema`. O limite é 40.000 caracteres, 100 páginas e 8 MiB no arquivo de origem. A API calcula o fingerprint compartilhado com a interface, devolve o ID existente para conteúdo duplicado e invalida seleções de relevância quando a base muda. `knowledge.delete` recebe `{id}`; `knowledge.clear` esvazia documentos, uso e seleções. Nenhuma dessas ações executa OCR, extração de PDF, resumo ou seleção por IA interna.

## Backup global com originais

As seis operações de backup exigem credencial de conta (`*`) e não recebem `projectId` no envelope. O runtime monta ou lê o arquivo ZIP/`.ddvault`; a API fornece conteúdo validado e a transação do cofre. O formato de manifesto, seu hash e as regras de notebook/board são compartilhados com a validação de backup da interface. Credenciais de provedores são removidas dos documentos exportados e não são aceitas na importação.

| Operação | Uso |
| --- | --- |
| `backup.manifest` | Header compatível com o arquivo da interface, descritores dos documentos e metadados de até 100 originais por página |
| `backup.document` | `{key,offset?,limit?}` lê um documento em trechos de até 1.048.576 caracteres, com hash SHA-256 do texto UTF-8 completo |
| `backup.document.stage` | `{key,base64,sha256}` cifra um bloco de até 8 MiB de um documento UTF-8 e devolve `{key,descriptor,sha256,size}` |
| `backup.media.read` | `{id}` lê os bytes originais da conta como base64, incluindo identidades históricas de plano |
| `backup.media.stage` | Cifra e armazena um original de até 10 MiB, sem publicá-lo na coleção; devolve `{metadata,descriptor}` para a importação |
| `backup.import` | Valida o manifesto, documentos e todos os originais preparados e os publica no commit atômico |

Para exportar, guardar o header de `backup.manifest`, paginar seus metadados, concatenar os trechos de cada documento e ler os originais. Conferir hashes e a mesma revisão do cofre em todas as respostas antes de montar o arquivo; se a revisão mudar durante a leitura, reiniciar a captura. O header contém `{format:'cellproject-global-backup',version:1,exportedAt,operationId,manifestHash}`. Preservar a ordem das propriedades recebidas ao reconstruir os dados usados pelo hash do arquivo.

Para importar, abrir o arquivo no runtime e preparar cada original com `backup.media.stage`, fornecendo `{id,name,mime,projectId?,createdAt?,sha256,base64}`. Valem as validações de formato, hash e imagem descritas acima. Guardar o par `{metadata,descriptor}` retornado; o descritor identifica o blob cifrado no cofre de destino. Uma preparação também é uma ação e exige UUID/revisão no envelope: se a confirmação se perder, repetir o corpo e o UUID originais recupera esse descritor do recibo cifrado sem criar outro upload.

Documentos pequenos podem ser enviados diretamente como `{key,value}`. Para um documento maior, codificar o texto completo em UTF-8, calcular seu SHA-256 e separar os bytes em blocos de até 8 MiB. Preparar cada bloco com `backup.document.stage`, enviando seu base64 e seu hash. Essa ação também gera recibo recuperável pelo UUID original. Guardar os descritores na ordem dos blocos e montar `{key,parts:[{descriptor,sha256,size}],sha256,size}`, com até 128 blocos por documento. O hash/tamanho em cada parte descreve seus bytes originais; dentro de `descriptor`, descreve o blob cifrado. O hash/tamanho no documento descreve os bytes originais completos. Os blocos podem dividir uma sequência UTF-8, pois a decodificação ocorre depois da concatenação, preservando inclusive um BOM existente.

Enviar `backup.import` com o header do arquivo, a coleção `documents` contendo documentos diretos ou descritores de blocos e `media:[{metadata,descriptor}]` dos originais preparados. Para preservar o hash do arquivo da interface, usar seus metadados originais, com a ordem das propriedades mantida, associados ao descritor cifrado retornado pela preparação no destino. O `operationId` do header identifica o backup; o UUID no envelope identifica a tentativa de commit. O servidor confere as cifras, hashes/tamanhos de blocos e documentos, reconstrói UTF-8 com rejeição de sequências inválidas e executa a validação compartilhada da interface antes do commit atômico. Cada documento reconstruído tem limite de 32 MiB e o manifesto serializado completo, incluindo a tag de autenticação da cifra, tem limite de 96 MiB. Conteúdo existente precisa ser idêntico; divergência retorna `409` e não sobrescreve o cofre.

Cada requisição HTTP/MCP continua limitada a 16 MiB. A importação por descritores permite que o conteúdo reconstruído ultrapasse esse tamanho sem transmitir todos os documentos na requisição final. A quota de 700 MiB de blobs cifrados inclui os blocos de documentos preparados e os originais. Preparações ficam sujeitas à quota e à política de retenção mesmo quando o commit não é concluído.

## Cobertura e validação

A [matriz de operações externas](reports/external-action-coverage-2026-10-11.md) registra a cobertura e os limites por módulo. A paridade refere-se a conteúdo e regras de domínio persistentes. Navegação do navegador, captura de microfone, autenticação/senha da conta e chamadas ao modelo interno não são operações remotas desse contrato. Dados de uso exclusivamente local precisam ser migrados para o cofre cloud antes de aparecerem na API; o bridge não lê IndexedDB nem arquivos locais do navegador.

Os testes focados são executáveis com `node --test server/mcp.test.mjs server/externalMedia.test.mjs` e `npx vitest run src/external/domain/contentOperations.test.ts --maxWorkers=2`. O transporte lança o processo real e usa uma API HTTP controlada: versões atual/legada, catálogo, consultas, ações/recibos, recursos, conflito sem retry, revogação, cancelamento, redirecionamento, limites e proteção do bearer. Mídia verifica bytes originais cifrados, integridade e propriedade; conteúdo verifica histórico, tombstones e base de conhecimento. Esses testes não comprovam deployment, migração remota, autenticação de uma conta real nem paridade física de um experimento. As validações completas de domínio, HTTP e banco estão no [relatório da entrega de 12/10/2026](reports/external-api-mcp-2026-10-12.md).

Referências oficiais: [SDK 2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1), [compatibilidade de protocolo do SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.3.1/docs/migration/support-2026-07-28.md), [transporte stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), [ferramentas MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

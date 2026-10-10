# Persistência local e futura migração para Supabase

> Documento histórico da proposta inicial. A aplicação evoluiu desde esta revisão: a organização atual está em [architecture.md](architecture.md) e a configuração remota em [cloud-production.md](cloud-production.md). O SQL abaixo continua sendo um desenho relacional, não uma descrição do banco ativo.

A aplicação continua local. Não há cliente Supabase, autenticação remota, conexão de banco, sincronização, implantação ou nova dependência neste trabalho. O arquivo [database/workspace-schema.sql](database/workspace-schema.sql) é um desenho SQL para revisão futura; não foi aplicado e não é uma migration.

## Limite de persistência

As telas e as ferramentas do agente usam as ações de domínio do workspace. O Zustand serializa os dados persistidos e delega a leitura/escrita a `src/data/workspaceRepository.ts`:

```ts
interface WorkspaceRepository {
  load(storageName: string): Promise<string | null>;
  save(storageName: string, serializedWorkspace: string): Promise<void>;
  remove(storageName: string): Promise<void>;
}
```

`IndexedDbWorkspaceRepository` usa o `idb-keyval` já instalado, com o mesmo banco e object store padrão. `createWorkspaceStorage(repository)` adapta o contrato para `StateStorage`; `workspaceRepository` é a instância desse adaptador usada pelo store. A fila de gravações e `flushWorkspacePersistence` pertencem ao store. O repositório propaga falhas de leitura, escrita e remoção, permitindo ao chamador informar e repetir uma operação.

A chave `cellproject-workspace` e os envelopes antigos continuam compatíveis. O store passou da versão Zustand `1` para `2` ao acrescentar comentários e normaliza `comments` ausente; essa migração pertence ao store. O repositório não interpreta, converte ou reescreve o JSON. Isso também preserva campos desconhecidos dos envelopes que ele recebe. A versão `1` dos formatos de exportação abaixo é independente da versão de persistência do Zustand. `cellproject-graph` mantém sua persistência separada; a ponte do planejador continua responsável pela importação local que já existia.

## Dados transferíveis

`src/data/workspaceTransfer.ts` define `WorkspaceData` com os mapas de projetos, tarefas, sprints, notas, pastas, comentários e `legacyImported`. O campo `comments` é opcional na entrada para aceitar dados anteriores aos comentários; as saídas o normalizam para um mapa vazio. Métodos do store, projeto selecionado, superfície aberta e preferências/chaves do provedor de IA ficam fora desse contrato.

Há três funções puras; o chamador fornece o horário em milissegundos:

```ts
const backup = createWorkspaceBackup(workspace, Date.now());
// { format: 'cellproject-workspace-backup', version: 1, exportedAt, data }
const restoredData = restoreWorkspaceBackup(JSON.parse(JSON.stringify(backup)));

const snapshot = workspaceToDatabaseRows(workspace, authenticatedUserId, Date.now());
// { format: 'cellproject-workspace-rows', version: 1, exportedAt, ownerId, rows }
```

As funções não leem storage, não chamam rede e não alteram o workspace. As cópias são independentes, inclusive os blocos e os snapshots do planejador. O backup mantém os timestamps locais em milissegundos; o snapshot de linhas converte timestamps para ISO 8601 em UTC. Datas sem horário permanecem `YYYY-MM-DD`; `dueDate: ''` vira `due_date: null`. IDs locais, inclusive os gerados com `nanoid`, permanecem strings e são colunas `text` no desenho SQL. Somente `owner_id` usa o UUID do futuro usuário autenticado. O conversor rejeita proprietário sem formato UUID e timestamps inválidos.

`restoreWorkspaceBackup` verifica formato, versão, horário de exportação e a presença dos mapas do envelope. Não é uma tela de importação nem substitui a validação completa de entidades, referências e regras de domínio. Antes de aplicar um arquivo externo ao store, a futura importação deve validar seu conteúdo, apresentar o resultado e fazer a substituição de forma atômica. Arquivos com versão desconhecida são rejeitados, sem adivinhar conversões.

| Dados locais | Linhas futuras | Decisão |
| --- | --- | --- |
| `projects` | `projects` | Nome, objetivo, arquivo e timestamps; snapshot completo em `planner_snapshot` JSONB |
| `sprints` | `sprints` | Datas e estado; uma sprint ativa por projeto |
| `tasks` | `tasks` | Estado compartilhado entre Kanban e Scrum; origem do plano em IDs de texto |
| `folders` | `folders` | Mantém somente os campos atuais; não inventa timestamps |
| `notes` | `notes` | Blocos ordenados em JSONB; projeto, tarefa e pasta opcionais; lixeira preservada |
| `comments` | `task_comments` | Referências à tarefa/projeto, texto, autor e timestamps |
| `legacyImported` | `workspace_settings` | Marca a importação local já realizada |

O grafo, as sugestões pagas, os rascunhos, os arquivos do planejador e seus IDs internos têm estruturas próprias e evoluem juntos. Mantê-los em um snapshot JSONB por projeto permite migrar sem perder essas informações nem criar uma tabela para cada detalhe do editor. Blocos de notas usam JSONB para preservar ordem, IDs, tipo, marcação e formatação; a nota continua sendo a unidade de edição e salvamento. As entidades operacionais ficam normalizadas para consultas e integridade relacional.

O chat possui um escopo separado, persistido em `dynamic_diary-chat` com versão de envelope `1`. `ChatData` contém `sessionId`, mensagens visíveis, `modelHistory` e sessões arquivadas opcionais. `chatToDatabaseRows(chatData, authenticatedUserId)` produz outro snapshot versionado (`cellproject-chat-rows`, versão `1`), sem misturar conversas com `WorkspaceData`. Sessões atuais e arquivadas viram `chat_sessions`; mensagens viram `chat_messages` com posição estável, papel, `content` vindo de `text`, ações JSONB, estado de interrupção e horário ISO. O contexto estruturado do modelo fica em `model_history` JSONB, preservando as mensagens de ferramentas.

Durante uma solicitação, o envelope local também mantém `pendingHistory`, além do registro das ações e seus resultados/IDs. Esse marcador é transitório e não integra o contrato SQL. Ao recarregar, o store recupera o pedido com a auditoria, marca a resposta interrompida e orienta a leitura dos registros atuais antes de repetir mutações. Para exportar durante uma execução, interromper a solicitação e aguardar a persistência primeiro; os exportadores não controlam trabalhos de IA.

O conversor do chat seleciona somente os campos do contrato e remove configurações do provedor e campos conhecidos de credenciais do contexto estruturado. O desenho não inclui colunas para chaves de API ou tokens de autenticação. O campo `author: 'assistant'` de um comentário identifica o participante exibido; ele não altera autorização. Conteúdo digitado pelo usuário continua sendo conteúdo: a exportação não tenta remover palavras que pareçam credenciais de textos de notas, comentários ou conversas. Configurações e credenciais devem continuar fora do histórico na origem.

## Propriedade e integridade no desenho SQL

Cada linha pertence a um usuário em `auth.users`. A chave primária `(owner_id, id)` permite preservar os IDs atuais e manter usuários isolados. As referências incluem o proprietário, e tarefas/sprints/comentários/notas incluem também o projeto quando necessário: uma nota não pode apontar para a tarefa de outro projeto; uma tarefa não pode apontar para a sprint de outro projeto. Excluir uma tarefa desassocia suas notas e remove seus comentários. Excluir uma pasta desassocia suas notas. O aplicativo atual arquiva projetos; não há ação de exclusão definitiva de projeto, e as referências restringem essa exclusão no desenho.

O SQL propõe RLS em todas as tabelas, políticas `TO authenticated` com `auth.uid() = owner_id` em `USING` e `WITH CHECK`, permissões explícitas para usuários autenticados e nenhuma permissão para visitantes. Não usa metadata editável pelo usuário, funções `SECURITY DEFINER`, views, extensões ou chaves privilegiadas. FKs compostas complementam RLS impedindo referências entre proprietários.

Checks e índices cobrem estados e prioridades conhecidos, nomes obrigatórios, datas válidas/ordenadas, timestamp de conclusão coerente, uma sprint ativa por projeto, referências no mesmo projeto e importação única de cada origem do plano. As mudanças de ciclo de vida entre linhas continuam exigindo operações de domínio: concluir uma sprint deve devolver tarefas pendentes ao backlog e manter as concluídas no histórico em uma única transação futura. Somente substituir o storage por chamadas CRUD remotas não garante essas regras nem resolve concorrência.

## Caminho para a migração futura

1. Gerar um backup versionado local e preservar também o envelope bruto antes da migração.
2. Criar um ambiente Supabase de desenvolvimento e adaptar/testar o desenho SQL com dois usuários. Verificar leitura, inserção, atualização e remoção próprias; negar acesso e referências cruzadas; testar os estados de sprint e os vínculos de notas/comentários.
3. Implementar autenticação e um repositório remoto que reconstrua `WorkspaceData` na leitura e converta as linhas na escrita. O contrato atual guarda envelopes inteiros: uma implementação remota deve assumir explicitamente o custo de converter e reconciliar esse snapshot. Para sincronização frequente e concorrente, evoluir para operações por entidade e revisão, mantendo as ações de domínio compartilhadas.
4. Acrescentar importação transacional, conversão inversa das linhas, estratégia de conflitos/repetição e tratamento de mudanças de conta. Não usar gravações sequenciais independentes para ações que alteram várias entidades.
5. Importar as linhas em ordem: configurações/projetos/pastas, sprints, tarefas, notas/comentários; confirmar contagens, IDs, relações e conteúdo contra o backup. Só marcar a migração como concluída após validação e confirmação persistida. Manter possibilidade de voltar ao backup local.
6. Depois de verificar em ambiente descartável, gerar uma migration com o CLI e rodar os advisors antes da implantação. Reconsultar a documentação/changelog vigente nessa ocasião.

## Verificação desta entrega

Os testes usam IndexedDB com `fake-indexeddb` e verificam compatibilidade do envelope bruto, isolamento entre nomes de storage e propagação de falhas. Os testes de transferência verificam ida e volta do backup JSON, ausência de ações/chaves e estado visual, dados antigos sem comentários, versões inválidas, IDs/referências, datas opcionais, timestamps e cópias independentes de conteúdo estruturado. O chat tem verificações próprias de sessões arquivadas, ordenação, ações, interrupção, contexto de ferramentas e exclusão de configurações/credenciais estruturadas.

O SQL foi revisado contra documentação oficial. Não havia `psql`, Supabase CLI ou Docker disponível nesta execução; o desenho não foi executado em PostgreSQL e suas políticas não foram testadas num banco. Nenhum projeto Supabase foi acessado ou alterado.

Referências consultadas em 2026-10-08: [changelog Supabase](https://supabase.com/changelog), [aviso PostgreSQL 15.19/17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api) e [constraints do PostgreSQL](https://www.postgresql.org/docs/current/ddl-constraints.html). O aviso de atualização trata de extensões/operadores que este desenho não utiliza; não exige mudança nesta proposta.

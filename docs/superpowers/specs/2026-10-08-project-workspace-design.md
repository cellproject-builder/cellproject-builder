# dynamic_diary: projetos, execução e diário

O usuário aprovou o conceito de arquitetura de planos + gerenciamento de execução e pediu implementação incremental, com localhost aberto para acompanhar. Esta entrega implementa a primeira versão funcional dos quatro módulos solicitados.

## Experiência

- A aplicação abre em Meus projetos; nenhum módulo de gestão exige chave de IA.
- Projetos possuem nome, objetivo e estado ativo/arquivado. Cada projeto abre em visão geral e oferece Kanban, Scrum, notas e construtor de planos.
- Kanban possui A fazer, Em andamento, Em revisão e Concluído. Criar, editar, excluir e mover tarefas; arrastar no desktop e seleção de estado acessível no mobile.
- Scrum usa as mesmas tarefas: backlog, sprints com objetivo e datas, iniciar e encerrar, uma sprint ativa por projeto. Pendências voltam ao backlog ao encerrar; itens concluídos permanecem no histórico da sprint.
- Notas pertencem ao usuário, com projeto/tarefa opcionais. Referência Apple Notes: sidebar de pastas, lista de notas e editor; busca, fixação, salvamento automático, blocos de texto/título/lista/checklist, lixeira e restauração. Formatação inicial por bloco, sem anexos ou sincronização remota.
- Planos existentes são preservados e importados uma única vez. O construtor atual continua disponível como ferramenta. Tarefas derivadas de passos mantêm referência à célula de origem; importar novamente não duplica tarefas. Estado operacional da tarefa não atesta os critérios de validação do plano.
- Alternar entre projetos preserva os snapshots do construtor, rascunhos e sugestões. Enquanto um trabalho de IA está ativo no construtor, a troca desse contexto é bloqueada com explicação.

## Arquitetura

A identidade atual usa apenas o nome `dynamic_diary`, sem símbolo. A aparência oferece OLED (preto, padrão), Escuro (cinza uniforme, sem degradê) e Claro, com preferência persistida. Navegação, lista e editor de notas formam ilhas com espaçamento e cantos arredondados. O cabeçalho superior se integra ao fundo da tela, sem superfície, bordas ou sombra de ilha. Os materiais translúcidos permanecem nas áreas apropriadas, respeitando as preferências de redução de transparência.

Novo módulo `src/workspace`: store Zustand persistido em IndexedDB, tipos de projetos/tarefas/sprints/notas/comentários e ações compartilhadas com as ferramentas do agente. O pedido posterior incluiu o chat nesta entrega: popup acessível em todo o workspace, respostas em streaming, ações reais, histórico e cancelamento. O plano complementar registra esse escopo em `../plans/2026-10-08-ai-workspace.md`.

O armazenamento passa por um repositório substituível, preservando as chaves locais. Contratos de transferência versionados e um desenho SQL com propriedade, relações e RLS preparam a migração futura ao Supabase. Nenhum banco remoto foi conectado ou alterado; o SQL permanece não executado.

O store de grafo original permanece compatível. Uma ponte guarda/restaura somente campos de sessão do planejador e migra o projeto atual e o arquivado sem apagá-los. A nova raiz renderiza a gestão e incorpora o planejador existente.

## Restrições

- Local-first, sem backend, sem novas dependências de produto.
- Textos em português e inglês, mantendo o seletor de idioma existente.
- Layout utilizável em desktop e mobile; controles acessíveis por teclado.
- Servidor Vite permanece rodando na porta local informada.

## Validação

Testes de isolamento entre projetos, reidratação, migração idempotente, tarefa/sprint de projeto incompatível, ciclo da sprint, notas restauráveis e importação idempotente do plano. Suite existente, TypeScript/build e inspeção real da interface desktop/mobile.

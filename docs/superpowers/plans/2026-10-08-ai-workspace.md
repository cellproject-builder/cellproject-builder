# Chat de ações e preparação de dados

Pedido autorizado: chat flutuante de IA em toda a aplicação, com acesso às ações de projetos, tarefas/issues, sprints, notas e comentários; preparar a migração futura ao Supabase mantendo a aplicação local.

## Implementação

- Registro tipado de ferramentas com Zod, chamando os stores existentes e as mesmas validações da interface. Leitura paginada de contexto sem chaves de provedores. Ações do planejador preservam seus critérios e snapshots.
- Chat com provedor BYOK existente, respostas em streaming, chamadas de ferramentas reais, estado de execução, cancelar e histórico local. Navegação não desmonta a execução.
- Comentários ligados às tarefas com autor humano/assistente, edição, exclusão e persistência; consulta sobre GitHub enviada ao usuário para resolver o significado de issues.
- Contrato de repositório substituível, adaptador IndexedDB compatível com os dados atuais, exportação versionada e mapeamento para tabelas. SQL de referência com propriedade e RLS, sem conectar ou aplicar alterações no Supabase.
- Verificação: testes de ferramentas/dados/comentários, loop real do SDK com modelo controlado, suite completa e build, interface no navegador; revisão independente do conjunto.

O chat não lê credenciais nem executa JavaScript arbitrário. Conteúdo de notas, comentários e resultados de ferramentas é dado, não instrução. Uma observação de validação física deve vir do usuário.

## Resultado verificado em 2026-10-08

- Suite completa: **257 testes aprovados, 8 testes de integração opt-in ignorados**. TypeScript e build de produção aprovados. Avisos existentes de Browserslist antigo e chunk acima de 500 kB continuam informativos.
- Provedor configurado real, em origem de teste separada (`127.0.0.1:5173`): um pedido criou projeto, tarefa em andamento, comentário de assistente e nota vinculada ao projeto/tarefa, depois abriu a nota. Cinco ações concluídas; tarefa e comentário conferidos na interface, dados e conversa preservados após reload.
- Aparências OLED, cinza e claro conferidas. No cinza, sidebar, cabeçalho e chat têm `background-image: none`. Popup no viewport CSS de 390 px cabe entre as margens, com rolagem interna e sem overflow horizontal da página.
- Revisão independente somente leitura concluída. Corrigidos e cobertos por regressões: leitura de outro plano sem trocar o editor visível, critérios protegidos ocultos, resultado honesto de ações bloqueadas, falha de gravação do planejador, IDs de blocos duplicados, navegação com recurso de outro projeto e recuperação de pedido/IDs/resultados de ações após interrupção.
- Gravações do chat e ações de ferramentas são serializadas. Falhas de leitura não sobrescrevem histórico; falhas de escrita ficam visíveis com nova tentativa. Histórico preserva resultados de ações concluídas e pede leitura do estado real antes de retomar mutações interrompidas.
- “Issues” foi tratado como tarefas internas enquanto a consulta opcional sobre GitHub ficou sem resposta. Não há integração GitHub.
- Repositório local e exportadores verificados por testes. Esquema SQL de referência revisado, **não executado**; nenhum projeto Supabase acessado ou alterado.
- Servidor Vite mantido na porta 5173; visualização principal em `http://localhost:5173/`, com o assistente aberto. Nenhuma publicação remota realizada.

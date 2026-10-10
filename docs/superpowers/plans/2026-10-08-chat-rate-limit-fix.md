# Controle de chamadas do chat e cabeçalho integrado

Pedidos: corrigir o erro de muitas requisições no chat e mesclar a barra superior ao fundo da tela.

## Diagnóstico e mudanças

- Uma chamada simples ao provedor configurado respondeu `OK`. O erro original não estava no histórico disponível; testes controlados reproduziram a amplificação de chamadas depois de um limite em uma ferramenta interna.
- O chat agora espaça o início das chamadas em pelo menos 1,5 segundo. O planejador, a pesquisa opcional e a seleção de documentos da base usam o mesmo controle, sem retries automáticos do SDK nesse fluxo.
- Um limite interrompe o ciclo e as ferramentas seguintes. Ações concluídas permanecem no estado e no histórico; a aplicação não repete mutações automaticamente.
- O prazo informado em `Retry-After`/`retry-after-ms` estabelece um bloqueio de envio persistido por provedor/modelo. Sem prazo, o bloqueio dura 60 segundos. O popup mostra a contagem regressiva e preserva texto digitado durante a espera. Falta explícita de créditos recebe a orientação correspondente, sem sugerir que uma espera curta resolverá.
- Erros estruturados, wrappers do SDK e erros OpenRouter embutidos em HTTP 200 são reconhecidos.
- A barra superior usa fundo transparente, sem borda, raio, sombra ou blur, e não participa dos materiais de ilha. Navegação e áreas de notas continuam como ilhas.

## Verificação

Regressões cobrem interrupção após limite, ausência de novas mutações, preservação das ações concluídas, cancelamento durante espaçamento, seleção da base, erros de pesquisa/planejador, classificação de quota e Retry-After, recarga durante cooldown e rascunho/contador no popup. A contagem final está registrada após a execução completa.

No navegador, o provedor real executou cinco ações: duas consultas de estado, criação de pasta, criação de nota pessoal e abertura da nota. O resultado apareceu no editor e na conversa. Uma execução anterior foi interrompida pelo reload de desenvolvimento; o pedido seguinte consultou o estado e não duplicou registros.

A barra superior foi conferida em OLED, cinza e claro: fundo transparente, sem borda, sombra, raio ou blur. O menu desktop recolhido mede 72 px; no viewport móvel de 390 px, o drawer continua com 240 px, textos e controles completos, sem overflow da página.

## Pedidos posteriores

O usuário pediu recolhimento da coluna lateral. A preferência é persistida localmente, os atalhos de ícones têm nomes acessíveis e tooltip, e a mesma ação está disponível no chat. Controles de aparência e idioma aparecem ao expandir o menu. O usuário também pediu dados de demonstração para visualizar a estrutura preenchida; os exemplos são adicionados sem substituir os registros existentes.

O dataset de demonstração contém três projetos, três planos de escopo, 36 tarefas, nove sprints, 15 notas, 30 comentários e quatro pastas. Os exemplos são identificados como fictícios, têm vínculos de projeto/tarefa e usam as ações validadas do workspace. O botão em Projetos carrega os exemplos e abre o primeiro painel; a IA tem acesso à mesma função. Testes verificam integridade, portabilidade, persistência, idempotência e preservação de dados existentes.

Na origem principal `localhost:5173`, os três exemplos foram carregados junto aos dois projetos anteriores. Kanban, edição de issue/comentários, Scrum e notas vinculadas foram conferidos com os registros preenchidos.

## Resultado final verificado

- `npm test -- --maxWorkers=4 --minWorkers=1`: **302 testes aprovados, 8 integrações opt-in ignoradas**.
- `npm run build`: TypeScript e produção aprovados. Avisos informativos de Browserslist antigo e bundle acima de 500 kB permanecem.
- O layout dos planos usa o cálculo de árvore existente. Um fixture inicial com folhas sobrepostas foi corrigido e os exemplos já carregados receberam reparação restrita à geometria original, preservando conteúdo e posições personalizadas. Árvore com dez nós conferida no navegador sem sobreposição.
- Dados e preferência de lateral recolhida preservados após reload. Repetir a carga confirmou ausência de duplicatas. Busca e botão de demonstração conferidos em viewport móvel de 390 px, sem espremer o campo nem gerar overflow.
- Preview principal mantido em `http://localhost:5173/`, aberto no painel de `(Demo) Lançamento do produto`, com lateral recolhida e barra superior integrada. Servidor Vite continua ativo.

O controle evita a sequência indevida de chamadas; limites e disponibilidade do provedor continuam externos à aplicação.

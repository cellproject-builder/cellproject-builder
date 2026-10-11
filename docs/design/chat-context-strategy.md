# Contexto e continuidade do chat

Pesquisa verificada em 11 de outubro de 2026. O Dynamic Diary mantém os adapters atuais de OpenAI, Anthropic e OpenRouter. A referência abaixo orienta o gerenciamento do contexto; não transforma a aplicação no runtime do Codex.

## Referência e decisão

Foi consultado o repositório oficial público [openai/codex](https://github.com/openai/codex), na revisão `27065a91ccbf5ba8532844be3777fcf83b77820d`, sob Apache-2.0. Os arquivos foram lidos pela API do GitHub, sem executar código externo.

O Codex separa eventos persistidos da sessão e contexto ativo, registra checkpoints e mantém uma representação menor para continuar. Seu prompt de compactação preserva progresso, decisões, restrições, próximos passos e referências. A implementação também mantém textos recentes dentro de um orçamento e reaplica contexto canônico. Ver [persistência das sessões](https://github.com/openai/codex/blob/27065a91ccbf5ba8532844be3777fcf83b77820d/codex-rs/rollout/src/recorder.rs#L1), [construção do checkpoint](https://github.com/openai/codex/blob/27065a91ccbf5ba8532844be3777fcf83b77820d/codex-rs/core/src/compact.rs#L370-L417) e [prompt de continuidade](https://github.com/openai/codex/blob/27065a91ccbf5ba8532844be3777fcf83b77820d/codex-rs/prompts/templates/compact/prompt.md).

**O limiar de 60% é uma decisão do Dynamic Diary solicitada pelo usuário.** A revisão consultada do Codex usa um limite configurável, com padrão em 90% da janela. Não atribuímos nosso percentual ao Codex. [Cálculo original](https://github.com/openai/codex/blob/27065a91ccbf5ba8532844be3777fcf83b77820d/codex-rs/protocol/src/openai_models.rs#L522-L539).

## Contrato implementado

- [contextBudget.ts](../../src/chat/contextBudget.ts) prepara o histórico do modelo sem alterar o transcript visual. Conta mensagens, prefixo estável, fontes atuais e reservas de saída; compacta o prefixo antigo e mantém os dois turnos completos mais recentes. Chamadas de ferramentas e resultados ficam no mesmo grupo.
- [chatCompaction.ts](../../src/ai/chatCompaction.ts) produz uma memória candidata pelo adapter atual, sem ferramentas, mutações ou repetição automática de chamadas. Não reenvia bytes de imagens ou arquivos para esse resumo textual. A serialização compartilhada remove data URLs, `ArrayBuffer` e views binárias também quando aparecem dentro de resultados de ferramentas. Preserva IDs, nomes e origem textual sem alegar ter analisado pixels.
- O checkpoint guarda versão, resumo, modelo/provedor de origem, horário, número da janela e quantidade de mensagens resumidas. O próximo resumo combina esse checkpoint somente com os turnos que ficaram antigos desde então.
- A memória é identificada como conteúdo gerado pela aplicação e falível. Não representa uma nova instrução ou autorização humana. IDs e resultados de ações ajudam a consultar o estado atual e evitar repetir uma mutação já aplicada.
- Só há troca após resumo válido, limitado e menor. Falha, cancelamento ou resultado truncado preservam o histórico anterior. Uma fonte atual ou pedido isolado grande demais interrompe o envio com erro; não é cortado silenciosamente para caber.
- Históricos legados longos são resumidos em lotes de turnos completos que cabem no orçamento. Se um lote falhar, o resultado parcial não substitui a conversa.

O helper considera contexto atual apenas para a contagem. A injeção canônica de tela/projeto/seleção pertence ao agente do workspace e ocorre uma vez por envio. Uma referência histórica não define qual tela está aberta agora.

## Orçamento e medição

Quando uma janela verificada for informada pelo catálogo, ela pode ser passada como `contextWindowTokens` com origem `catalog`. A implementação atual não inventa limites para IDs reconhecidos por nome. Sem esse dado, usa um **orçamento conservador da aplicação de 32.768 tokens**, identificado como `fallback`; isso não é o tamanho real declarado pelo provedor.

O limiar é o menor entre 60% desse orçamento e o espaço restante após reservar saída e margem de segurança. O pipeline do workspace calcula o prefixo enviado pelo agente: usa o mesmo construtor de instruções, o contexto atual e os nomes, descrições e schemas JSON das ferramentas. A conversão dos schemas é cacheada uma vez, sem armazenar conteúdo privado do turno. Essa estimativa substitui a reserva fixa no preflight; o contexto atual já está incluído nela e não é somado novamente.

Medições locais, com contexto vazio e seis ferramentas, encontraram aproximadamente 16.400 tokens pelo estimador da aplicação na primeira revisão e 16.900 após ampliar o contrato de leitura paginada. Isso evidenciou que uma reserva fixa de 12.000 era insuficiente. Essas contagens são diagnósticos do prompt nessas revisões, não uso faturado nem limites estáveis: novas instruções e schemas mudam o cálculo. A estimativa textual usa bytes UTF-8, com adicional para partes multimodais de imagens e arquivos; não equivale à tokenização exata de cada modelo. Data URLs dentro de texto comum ou JSON de ferramentas são contadas integralmente no pedido principal: sua remoção é específica do resumo, evitando subestimar um resultado grande.

A saída reserva 3.000 tokens ou 7.000 para os modelos de raciocínio reconhecidos, incluindo pensamento; a margem adicional é de 2.048 tokens. Antes de cada requisição do loop, o agente reconta as mensagens, incluindo chamadas e resultados de ferramentas. Se o conjunto exceder o orçamento, interrompe a próxima requisição e preserva a auditoria das ações concluídas. Não compacta nem corta um par de ferramentas em andamento para continuar silenciosamente.

A leitura de planos também limita o que entra no contexto: [planContext.ts](../../src/ai/planContext.ts) retorna uma projeção pública paginada, com IDs, relações e resumos textuais. Propostas pendentes e guardadas possuem páginas próprias, com `parentId` e `tempId` para revisá-las sem adivinhar identificadores. Geometria, imagens embutidas, planos arquivados e corpos dos anexos ficam fora dessa resposta. O agente pode consultar detalhes de um nó ou recuperar campos extensos em partes; a resposta informa páginas seguintes e campos truncados, para que um resumo parcial não seja confundido com o conteúdo completo. A revisão usada para validar mutações continua vinculada ao plano real.

Uma observação de input do servidor pode servir como baseline apenas quando corresponde ao mesmo modelo e posição do histórico. O adapter retorna o uso da última etapa, e os itens posteriores são estimados; totais históricos de cobrança não são somados como ocupação atual. O Codex também distingue observação do servidor e estimativas locais. [Uso observado e crescimento posterior](https://github.com/openai/codex/blob/27065a91ccbf5ba8532844be3777fcf83b77820d/codex-rs/core/src/context_manager/history.rs#L922-L953).

O modelo/provedor e a conversa pertencem ao envio iniciado. Trocar a configuração durante a preparação ou o loop interrompe aquele envio, mantendo o pedido para uma nova tentativa. O cancelamento alcança também geradores chamados por ferramentas enquanto aguardam o provedor; um resultado atrasado não deve aplicar um plano ou artefato depois dessa troca. Reidratação ou substituição da conversa invalida callbacks antigos, para que texto, checkpoint ou finalização de outra sessão não sejam aplicados à conversa atual. O indicador de contexto é aproximado; quando usa fallback, seu tooltip informa que se trata de um orçamento conservador da aplicação e que a janela real do modelo é desconhecida.

## Histórico e apresentação

Cada conversa possui identidade estável, título, horários e estado explícito de arquivamento. A coleção legada de conversas inativas não é tratada automaticamente como arquivada. A normalização é determinística também na conciliação entre dispositivos, para que a primeira atualização não transforme a inclusão de metadados em uma falsa troca de identidade.

Arquivar mantém a conversa disponível para leitura; enviar e usar seus botões de alteração exige restaurá-la. Excluir remove mensagens, título, snapshots de referência e checkpoint do registro da conversa, mantendo apenas um recibo de exclusão para impedir que uma cópia antiga ressuscite o conteúdo. Isso descreve a persistência ativa da aplicação, não apagamento de backups históricos do provedor. Alterações concorrentes da mesma conversa ainda podem exigir conciliação: os históricos do modelo não são concatenados automaticamente.

Ao recuperar um envio interrompido, tanto na conversa ativa quanto ao abrir uma inativa, o sistema mantém o contexto pendente compacto, o checkpoint, o texto parcial e a auditoria. Ações em execução são marcadas como interrompidas; ações concluídas continuam registradas para evitar repetição de mutações.

Se uma ação já aplicada terminar de salvar depois que a resposta foi cancelada, seu recibo terminal pode atualizar somente a mensagem de origem, com ID, ferramenta e ação previamente iniciados naquele turno. Esse caminho funciona em conversa inativa, conserva o recibo durante preparação de outro envio ou recarga e ignora duplicatas e conversas excluídas. Texto, checkpoint e finalização continuam sujeitos ao guard estrito do turno; o recibo não autoriza uma nova mutação.

O modo expandido reutiliza a conversa e o rascunho de texto, referências e anexos já lidos. A interface mostra inicialmente as 60 mensagens mais recentes e permite carregar anteriores sem apagá-las. Deltas de texto são agrupados em intervalos de até 80 ms, com flush final e ao cancelar; eventos de auditoria continuam imediatos. Isso reduz atualizações e serializações durante o stream, mas não constitui um benchmark de desempenho geral.

## Caching e limites

Caching reutiliza um prefixo idêntico. Mantemos instruções e schemas estáveis antes dos dados variáveis; a conversa cresce sem reescrever turnos anteriores até precisar compactar. Uma compactação altera o prefixo histórico e pode reduzir o cache no primeiro pedido seguinte. Caching não permite omitir o histórico exigido por Chat Completions nem garante um cache hit. [Documentação de prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

`previous_response_id` reduz o conteúdo transportado, mas os inputs anteriores ainda entram na cobrança. A compactação nativa da Responses API retorna estado opaco, que não é intercambiável com nossos outros adapters. Por isso o primeiro caminho usa resumo semântico independente de provedor. [Estado da conversa](https://developers.openai.com/api/docs/guides/conversation-state), [compactação nativa](https://developers.openai.com/api/docs/guides/compaction).

Compactações repetidas podem perder detalhes; a fonte completa continua necessária para conferência. Não há garantia de memória perfeita nem de economia num percentual fixo. A [implementação do Codex também registra essa limitação](https://github.com/openai/codex/blob/27065a91ccbf5ba8532844be3777fcf83b77820d/codex-rs/core/src/compact.rs#L419-L424).

## Verificação

Os testes locais exercitam o orçamento de 60%, continuidade incremental, turnos recentes, ferramentas, troca de modelo, dados atuais, Unicode, fontes grandes, falhas e cancelamento. O adapter é testado com o SDK real e modelo determinístico: confirma ausência de ferramentas, remoção de bytes multimodais e rejeição de saída vazia, longa ou truncada. Nenhum benchmark com chamada paga foi executado nessa implementação; latência, tokens faturados, cache e precisão de continuidade precisam de avaliação com o provedor real.

# Chat contextual e histórico — Dynamic Diary

## Resultado esperado

Um único assistente funciona no popup e numa área expandida, acessível pela barra lateral. Expandir conserva conversa, rascunho e referências. O contexto visível informa a tela, o projeto e a entidade aberta. Referências escolhidas com `@` podem vir de outra tela ou projeto e mantêm sua origem, sem mudar silenciosamente o alvo das ações.

## Contexto de cada envio

Capturar uma fotografia imutável no envio: tela, projeto visível, plano, seleção, nota, board, lente e modo. Diário pessoal, lista de projetos e boards não herdam o último projeto ativo. Metadados e um trecho curto do foco bastam inicialmente; ferramentas leem os registros atuais quando necessário. Fontes são dados, nunca autorização. Critérios independentes ocultos e pixels não são enviados implicitamente.

## Conversas

Histórico com busca, título editável, recentes e arquivadas. Arquivar é reversível. Excluir pede confirmação e remove o conteúdo da conversa, conservando somente identidade/data de exclusão para impedir ressurgimento na sincronização. O formato persistido v1 continua compatível; conversas antigas inativas não se tornam arquivadas automaticamente. Uma solicitação em andamento impede troca/remoção da conversa.

## Contexto do modelo

Manter o transcript visível completo, separado do histórico ativo do modelo. Aos 60% do orçamento do modelo, compactar o prefixo antigo em resumo incremental de continuidade, conservando turnos recentes e pares de ferramentas completos. Preservar decisões, restrições, IDs, resultados e pendências. O resumo é memória falível, não instrução superior; mutações exigem releitura dos registros atuais.

Calcular instruções, ferramentas, contexto, referências, anexos e pedido, reservando saída. Usar metadados de janela conhecidos ou fallback conservador identificado como estimativa. Só substituir o histórico ativo após resumo válido e menor. Falha/cancelamento preserva o original; não enviar silenciosamente uma entrada além do orçamento. Não repetir chamadas pagas automaticamente nem compactar em loop.

## Referência de arquitetura

Adaptar a separação transcript/contexto e checkpoints do repositório oficial `openai/codex` (revisão `27065a91ccbf5ba8532844be3777fcf83b77820d`, Apache-2.0). Os 60% são uma escolha deste produto; a revisão pesquisada do Codex usa 90% por padrão. Não copiar o runtime nem migrar os provedores atuais. Prefixos estáveis favorecem caching quando o provedor oferece suporte; não garantem cache nem eliminam o envio do contexto exigido pela API.

## Validação

Testes de mudança de tela/nota, referências cruzadas e alteradas, migração, arquivo/exclusão, recuperação interrompida, compactação incremental/falha/cancelamento, limites e pares de ferramentas. Verificação visual local de popup/expandido, rascunho preservado, teclado e viewport estreito. Compaction e streaming usam modelos simulados nos testes; ganhos de custo/qualidade com modelos reais não serão presumidos.

Fora desta entrega: runtime do Dairo, memórias diárias, nova engine de providers, integração de assinatura Codex e alterações gerais de sincronização colaborativa.

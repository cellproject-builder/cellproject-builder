# Revisão do chat e da interface — 2026-10-11

## Problema e contrato esperado

O pedido «revise o plano» podia consumir os 16 passos do agente em consultas e terminar sem uma revisão escrita. O adaptador aceitava essa saída vazia e a interface mostrava «Ações processadas», confundindo conclusão de ferramentas com conclusão do pedido. Um teste anterior aceitava exatamente esse comportamento.

O chat deve conectar o objetivo do projeto às premissas, às investigações e aos artefatos, às evidências observadas e à revisão justificada do plano. A revisão precisa apresentar achados e limites de cobertura; consultar dados ou exibir um modelo ilustrativo não demonstra que um ensaio físico ocorreu. Uma análise deve preservar o plano, e uma edição autorizada deve manter seus recibos mesmo que a explicação final falhe.

## Execução e contexto

- O limite continua em 16 passos do loop principal, incluindo uma etapa final sem ferramentas. Compactação e ferramentas com IA podem gerar requisições adicionais. O limite não foi aumentado para encobrir o problema.
- Três leituras consecutivas com a mesma ferramenta, argumentos normalizados e resultado encerram a exploração e antecipam a síntese. Leituras continuam consultando os dados atuais; páginas e resultados diferentes não são cacheados nem classificados como repetição.
- O bloqueio da etapa de síntese também é verificado na execução das ferramentas. Uma resposta do provedor que ignore a indicação de não chamar ferramentas não pode aplicar uma mutação nessa etapa.
- A conclusão escrita é separada da narração intermediária. Respostas vazias, interrompidas por limite de saída ou filtragem não se tornam sucesso genérico. O erro de conclusão preserva as mensagens das ferramentas, o contexto compacto e o uso informado pelo provedor.
- As instruções orientam a revisão geral a começar por páginas estruturais e consultar detalhes relevantes. Essa orientação não garante a estratégia escolhida pelo modelo. Campos truncados precisam ser lidos integralmente antes de serem substituídos; isso não obriga a carregar todo o texto do projeto para emitir uma análise com limites claros.
- `planner_read` anuncia modos explícitos `overview`, `node` e `text`, com seletores inativos nullable e compatibilidade com chamadas antigas. `overview` não muda para leitura de campo quando seletores inativos são preenchidos. Projeto do workspace e plano interno têm IDs/nome identificados separadamente no retorno. A captura HTTP offline com o SDK/OpenRouter instalados descartou a hipótese de conversão local de opcionais em obrigatórios; o defeito comprovado era a seleção implícita do tipo de leitura.
- `hiddenCriterionNodeIds` distingue critérios da IA armazenados e ocultos dos campos vazios, limitado aos nós retornados ou ao campo solicitado. Não revela conteúdo, tamanho ou fragmentos e mantém a regra temporal de revelação. O critério humano e a evidência observada continuam separados.
- O gerenciamento de contexto continua usando o SDK instalado `ai@6.0.168`, com compactação antes das etapas. A documentação pública consultada já apresenta v7; suas alterações de persistência de `prepareStep.messages` não foram transplantadas para v6.
- A regressão integrada com janela de 16 mil tokens detectou crescimento das instruções após o novo contrato. Condensar o parágrafo de plano e a descrição de leitura reduziu o custo fixo com ferramentas de plano de 11.710 para 11.263 tokens estimados, já incluindo a orientação sobre critérios ocultos. O mesmo pedido e último par de ferramentas voltaram a caber com memória compacta, sem alterar janela, fixture, compactador ou políticas de mutação. A primeira compactação final mede 15.379, abaixo do teto de 15.616. O prefixo inicial vazio final mede 4.534 tokens estimados.

## Interface

O cabeçalho agrupa ações de conversa e apresentação. Símbolos menores mantêm áreas de interação de 40 px no desktop e 44 px no recorte móvel verificado. Origem, modelo e orçamento ficam em um controle recolhível. Consultas repetidas aparecem como um grupo, com os recibos individuais acessíveis; erros e aprovações permanecem destacados. O campo de mensagem, o histórico e os cantos receberam acabamento consistente, sem adicionar desfoque pesado.

Os modos central, lateral e expandido usam a mesma conversa e preservam o rascunho. A adaptação web segue os princípios de hierarquia, agrupamento e economia de controles das diretrizes oficiais de [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) e [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) da Apple. Não utiliza o material nativo Liquid Glass.

## Baterias de regressão

| Bateria | Evidência principal | Critério |
| --- | --- | --- |
| Execução e resposta | `assistant.finalAnswer.test.ts`, `assistant.test.ts`, `assistant.lifecycle.test.ts` | Síntese reservada; fim antecipado de leituras repetidas; conclusão separada do progresso; saída vazia ou parcial recusada; cancelamento e limite do provedor sem repetição automática. |
| Contexto e integridade | `assistant.review-flow.test.ts`, `assistant.context.test.ts`, testes de store e conversação do planejador | Plano denso de 17 nós com duas páginas e detalhe relevante; plano vazio explicado; origem congelada após navegar; compactação sem restaurar histórico bruto; edição aplicada preservada após falha final. |
| Interface e integração | `AssistantChat.test.tsx`, `store.test.ts`, `CreatorAiAccess.test.tsx`, inspeção visual local | Contexto recolhível; auditoria agrupada; aprovação/erro/undo acessíveis; rascunho e sessão preservados entre modos; provedor do servidor utilizável sem chave local. |

Os modelos roteirizados usam o loop real do SDK e ferramentas/stores locais. Demonstram o contrato de integração, a paginação e a preservação dos registros; não demonstram qualidade semântica universal, latência do provedor ou desempenho em todos os aparelhos.

## Verificação final

- `npm test -- --maxWorkers=4`: 245 arquivos aprovados; **2.661 testes passaram**, 8 testes opcionais de provedor ao vivo não executados. Rodada final incluindo a distinção entre critério oculto e ausente: 167,57 s.
- `npm run test:gateway`: **226 testes passaram**, 1 teste opcional não executado.
- `npm run build`, `npm run check:bundle` e `git diff --check`: aprovados. A auditoria não encontrou módulos de funcionalidades pesadas antecipados no carregamento inicial. O build ainda avisa sobre chunks grandes existentes de App e Three.js; esta entrega não representa uma conclusão da otimização global da aplicação.
- Revisão independente de código: sem achados materiais confirmados; 163 testes de 11 suítes repetidos pelo revisor no recorte avaliado.
- Conferência visual local com dados de demonstração: tela de 390 × 844 CSS px, largura do documento de 390 px, sem overflow horizontal do chat, controles do cabeçalho de 44 × 44 px. Rascunho preservado entre os modos central, lateral e expandido em desktop. A emulação de dimensões foi removida ao final; não substitui o teste físico em tablet.

## Ensaio com provedor real

No localhost principal, usando o GPT-6.1 Sol configurado e o plano existente de 15 nós, duas conversas novas receberam o mesmo pedido de análise, com o mesmo nó selecionado e sem autorização de edição.

| Medida | Antes de explicitar a leitura | Depois |
| --- | --- | --- |
| Tempo até conclusão | 112,671 s | 34,094 s |
| Consultas ao plano | 15 | 5 |
| Cobertura declarada | Limitada ao nó selecionado, com conexões omitidas | Visão geral dos 15 nós e quatro detalhes relevantes |
| Resultado | Síntese com escopo insuficiente para revisão global | Premissas, riscos priorizados e próximos testes, com limites explícitos |
| Integridade | Plano preservado, sem erro de execução | Plano preservado, sem erro de execução |

A segunda revisão distinguiu o projeto «robo dois braços» do plano «arm 6axis» e explicou a diferença de escopo, sem interpretar os IDs diferentes como acesso ao projeto errado. Conectou as premissas de torque, estrutura e alimentação aos ensaios ainda necessários, sem afirmar validação física. A referência do objeto do plano permaneceu idêntica antes/depois do turno; os cinco recibos foram apenas leituras. O projeto e a conversa de teste ficaram abertos no localhost.

Uma terceira conversa recebeu apenas «Revise o plano. Somente análise, sem alterar dados.»: terminou em 28,113 s, com cinco leituras e o plano preservado. A inspeção semântica encontrou um defeito adicional: a projeção devolvia `comoConfirmar` vazio para critérios da IA ainda ocultos, e a resposta tratou isso como ausência. Nos dados originais, os 15 critérios existiam e os 15 estavam ocultos pela regra de revelação. Essa observação exige distinguir visibilidade de existência, preservando o sigilo do conteúdo.

Depois da correção, a quarta conversa recebeu o mesmo pedido curto, no mesmo plano e com a mesma seleção. Terminou em **26,033 s**, com **cinco leituras** e uma revisão escrita sobre a estrutura e quatro passos relevantes. A resposta declarou «Existem critérios de IA ocultos; não avaliei seu conteúdo», sem classificá-los como inexistentes, e diferenciou critérios de evidência física. Não houve erro de execução; a referência do objeto do plano permaneceu idêntica. A conversa final ficou aberta no localhost em modo lateral.

As execuções demonstram comportamento no cenário observado; não estabelecem percentis, custo faturado ou qualidade universal. Os testes opcionais de provedor em lote continuam não executados. A redução de tempo não deve ser extrapolada ao desempenho global da aplicação.

A publicação segue o fluxo já autorizado de integração na `main`, deploy automático no Railway e conferência de saúde/arquivos servidos; o recibo final de publicação é informado na entrega.

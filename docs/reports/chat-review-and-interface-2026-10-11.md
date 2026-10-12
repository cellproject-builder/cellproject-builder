# Revisão do chat e da interface — 2026-10-11

## Problema e contrato esperado

O pedido «revise o plano» podia consumir os 16 passos do agente em consultas e terminar sem uma revisão escrita. O adaptador aceitava essa saída vazia e a interface mostrava «Ações processadas», confundindo conclusão de ferramentas com conclusão do pedido. Um teste anterior aceitava exatamente esse comportamento.

O chat deve conectar o objetivo do projeto às premissas, às investigações e aos artefatos, às evidências observadas e à revisão justificada do plano. A revisão precisa apresentar achados e limites de cobertura; consultar dados ou exibir um modelo ilustrativo não demonstra que um ensaio físico ocorreu. Uma análise deve preservar o plano, e uma edição autorizada deve manter seus recibos mesmo que a explicação final falhe.

## Execução e contexto

- O limite continua em 16 requisições do agente, incluindo uma etapa final sem ferramentas. Não foi aumentado para encobrir o problema.
- Três leituras consecutivas com a mesma ferramenta, argumentos normalizados e resultado encerram a exploração e antecipam a síntese. Leituras continuam consultando os dados atuais; páginas e resultados diferentes não são cacheados nem classificados como repetição.
- O bloqueio da etapa de síntese também é verificado na execução das ferramentas. Uma resposta do provedor que ignore a indicação de não chamar ferramentas não pode aplicar uma mutação nessa etapa.
- A conclusão escrita é separada da narração intermediária. Respostas vazias, interrompidas por limite de saída ou filtragem não se tornam sucesso genérico. O erro de conclusão preserva as mensagens das ferramentas, o contexto compacto e o uso informado pelo provedor.
- A revisão geral começa por páginas estruturais e consulta detalhes relevantes. Campos truncados precisam ser lidos integralmente antes de serem substituídos; isso não obriga a carregar todo o texto do projeto para emitir uma análise com limites claros.
- O gerenciamento de contexto continua usando o SDK instalado `ai@6.0.168`, com compactação antes das etapas. A documentação pública consultada já apresenta v7; suas alterações de persistência de `prepareStep.messages` não foram transplantadas para v6.

## Interface

O cabeçalho agrupa ações de conversa e apresentação. Símbolos menores mantêm áreas de interação de 40 px no desktop e 44 px em superfícies de toque. Origem, modelo e orçamento ficam em um controle recolhível. Consultas repetidas aparecem como um grupo, com os recibos individuais acessíveis; erros e aprovações permanecem destacados. O campo de mensagem, o histórico e os cantos receberam acabamento consistente, sem adicionar desfoque pesado.

Os modos central, lateral e expandido usam a mesma conversa e preservam o rascunho. A adaptação web segue os princípios de hierarquia, agrupamento e economia de controles das diretrizes oficiais de [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) e [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) da Apple. Não utiliza o material nativo Liquid Glass.

## Baterias de regressão

| Bateria | Evidência principal | Critério |
| --- | --- | --- |
| Execução e resposta | `assistant.finalAnswer.test.ts`, `assistant.test.ts`, `assistant.lifecycle.test.ts` | Síntese reservada; fim antecipado de leituras repetidas; conclusão separada do progresso; saída vazia ou parcial recusada; cancelamento e limite do provedor sem repetição automática. |
| Contexto e integridade | `assistant.review-flow.test.ts`, `assistant.context.test.ts`, testes de store e conversação do planejador | Plano denso de 17 nós com duas páginas e detalhe relevante; plano vazio explicado; origem congelada após navegar; compactação sem restaurar histórico bruto; edição aplicada preservada após falha final. |
| Interface e integração | `AssistantChat.test.tsx`, `store.test.ts`, `CreatorAiAccess.test.tsx`, inspeção visual local | Contexto recolhível; auditoria agrupada; aprovação/erro/undo acessíveis; rascunho e sessão preservados entre modos; provedor do servidor utilizável sem chave local. |

Os modelos roteirizados usam o loop real do SDK e ferramentas/stores locais. Demonstram o contrato de integração, a paginação e a preservação dos registros; não demonstram qualidade semântica universal, latência do provedor ou desempenho em todos os aparelhos.

## Verificação final

- `npm test -- --maxWorkers=4`: 244 arquivos aprovados; **2.652 testes passaram**, 8 testes opcionais de provedor ao vivo não executados. Rodada da árvore estabilizada: 142,83 s.
- `npm run test:gateway`: **226 testes passaram**, 1 teste opcional não executado.
- `npm run build`, `npm run check:bundle` e `git diff --check`: aprovados. A auditoria não encontrou módulos de funcionalidades pesadas antecipados no carregamento inicial. O build ainda avisa sobre chunks grandes existentes de App e Three.js; esta entrega não representa uma conclusão da otimização global da aplicação.
- Revisão independente de código: sem achados materiais confirmados; 163 testes de 11 suítes repetidos pelo revisor no recorte avaliado.
- Conferência visual local com dados de demonstração: tela de 390 × 844 CSS px, largura do documento de 390 px, sem overflow horizontal do chat, controles do cabeçalho de 44 × 44 px. Rascunho preservado entre os modos central, lateral e expandido em desktop. A emulação de dimensões foi removida ao final; não substitui o teste físico em tablet.

Ensaio com provedor real e publicação serão registrados após a integração local.

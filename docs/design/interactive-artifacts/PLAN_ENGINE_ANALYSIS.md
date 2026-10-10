# DBox e o motor de planos — análise de aplicação

Data: 10/10/2026. Escopo: leitura do artigo, inspeção do código e correção localizada do contexto do chat. Não houve geração paga nem estudo com usuários nesta análise.

**O maior aproveitamento está no motor de revisão dos planos.** Artefatos interativos podem ajudar a examinar uma relação, mas não precisam virar outro sistema de planejamento ou outra árvore concorrente.

O DBox oferece co-decomposição em programação, revisão por nó preservando a estrutura, ajuda progressiva e associação entre código e etapas. Seu estudo não avalia construção física. A implementação usa saídas JSON estruturadas e interface HTML/JavaScript; não demonstra geração livre de componentes React. Esses limites importam para interpretar o link. Fontes: [estrutura e revisão, §4.3](https://arxiv.org/html/2502.19133v1#S4.SS3), [ponte código–etapas, §4.4](https://arxiv.org/html/2502.19133v1#S4.SS4), [implementação, §4.6](https://arxiv.org/html/2502.19133v1#S4.SS6), [limitações, §8.5](https://arxiv.org/html/2502.19133v1#S8.SS5).

## Onde faz sentido aproveitar

As adaptações abaixo são propostas para este projeto, não resultados demonstrados pelo artigo.

| Aproveitamento | Diferença no código atual | Adaptação recomendada | Prioridade |
| --- | --- | --- | --- |
| Revisar uma parte mantendo a autoria | `decomposeNode` já considera conteúdo, critério próprio, irmãos e, quando fornecidos, outras partes do plano. Produz filhos em uma área de sugestões. | Acrescentar revisão localizada: qual premissa merece exame, qual relação pode estar ausente e quais nós sustentam o diagnóstico. Mostrar uma proposta antes/depois, preservando IDs e partes válidas. | Alta |
| Ajuda progressiva | `explainNode` entrega uma explicação extensa de uma vez. O bloqueio do critério independente já é uma proteção importante. | No tutor existente, oferecer pergunta → pista → exemplo/proposta explícita, sob escolha do usuário. Distinguir aprender/compreender de executar rapidamente; não impor tentativas artificiais ao produto geral. | Alta para um ensaio pequeno |
| Co-decomposição | A geração inicial oferece alternativas e expande a escolhida; a decomposição posterior também é gerada pela IA. | Permitir começar por um esboço do usuário e pedir revisão, ou escrever alguns filhos antes de pedir ajuda. Registrar quais contribuições são humanas e quais foram sugeridas, sem confundir autoria com verdade. | Alta para o recorte de aprendizagem |
| Preservar o que funcionou depois de uma falha | `replanFromFailure` manda não reutilizar a decomposição anterior e presumir que uma premissa estava errada. | Separar hipóteses de causa: premissa, execução, material, medição ou informação insuficiente. Justificar a alteração mínima; permitir conservar os filhos ainda sustentados. | Alta |
| Documentos/código ↔ plano | Anexos já entram na geração; `planner_structure` adiciona, atualiza e move nós com fontes, revisão e undo. | Relacionar uma afirmação do nó a trecho/linha/página e versão do arquivo. Comparar requisito e implementação como correspondência documental, deixando pendente a validação física. | Alta; evolução do que existe |
| Contexto consistente entre chat e painel | O chat omitia a visão restante do plano, conhecimentos já dominados e partes relacionadas. | Corrigido neste incremento usando os seletores existentes; a decomposição recebe recursos definidos em outras categorias, e explicação/crítica recebem pai, filhos e irmãos. | Implementado; regressões abaixo |
| Diagramas, gráficos e simuladores | A árvore já organiza o projeto; imagens e modelos são artefatos com posição independente. | Usar um artefato como uma lente sobre alguns nós: torque × alcance, fluxo de sinais ou previsão × observação. Selecionar um elemento deve destacar o nó relacionado. Expandir detalhes sob demanda, sem duplicar o plano inteiro. | Experimental |

## Pontos concretos do código

- [service.ts:1500](C:/__dev_ops__/@artigo/cellproject-builder/src/ai/service.ts:1500): a decomposição já respeita o objetivo e evita repetir partes quando o contexto é fornecido. Não precisamos substituí-la por um motor novo.
- [service.ts:565](C:/__dev_ops__/@artigo/cellproject-builder/src/ai/service.ts:565) e [service.ts:1666](C:/__dev_ops__/@artigo/cellproject-builder/src/ai/service.ts:1666): o tutor já protege a escrita do critério próprio, mas não implementa os níveis de ajuda sugeridos acima.
- [service.ts:1874](C:/__dev_ops__/@artigo/cellproject-builder/src/ai/service.ts:1874): as instruções de replanejamento tratam a decomposição anterior como fracassada. Um servo defeituoso, por exemplo, não demonstra que todas as etapas de montagem estavam erradas.
- [plannerTools.ts:150](C:/__dev_ops__/@artigo/cellproject-builder/src/ai/plannerTools.ts:150): o contexto do chat agora usa `planOverviewFor` e `relatedPartsFor`, inclui habilidades concluídas/conhecidas e mantém o critério da IA oculto até a condição de revelação existente.
- [planStructure.ts:29](C:/__dev_ops__/@artigo/cellproject-builder/src/ai/planStructure.ts:29): há uma base para mudanças locais atômicas com preservação dos registros e desfazer. `sourceAttachmentIds` identifica arquivos; não representa, sozinho, uma correspondência verificável com um trecho específico.

## TypeSafe: onde ajuda e onde não decide

Já existe classificação de intenção em [server/typesafe.mjs:98](C:/__dev_ops__/@artigo/cellproject-builder/server/typesafe.mjs:98): referência, extensão, revisão, reorganização ou esclarecimento. Ela retorna probabilidades e orienta o encaminhamento; não executa a mudança. Esse reaproveitamento é mais coerente do que criar outra camada para classificar toda frase.

Uma classificação adicional poderia sugerir **qual ação ajuda a pergunta atual**: explicar um nó, revisar uma relação, localizar uma fonte, visualizar parâmetros ou pedir esclarecimento. Só vale adicioná-la se um teste mostrar menos encaminhamentos errados que as regras/contexto já disponíveis, considerando também latência e custo. O pedido explícito do usuário continua prevalecendo.

TypeSafe não deve decidir que uma peça é compatível, que um ensaio aconteceu, que a premissa foi comprovada ou que um participante aprendeu. Probabilidade do modelo não é qualidade de medição nem verificação independente. Isso também vale para outra LLM usada como crítica.

## Limite científico e visual

Co-decomposição com IA e árvore interativa já têm precedente; somente acrescentar diagramas ou 3D não estabelece novidade. O recorte registrado em [OBJETIVO_DO_ARTIGO.md](C:/__dev_ops__/@artigo/cellproject-builder/docs/OBJETIVO_DO_ARTIGO.md) é investigar a passagem **premissa → previsão própria → ensaio → observação → revisão justificada**, no caso físico do robô. Uma contribuição possível precisa ser delimitada pela comparação com trabalhos relacionados e sustentada pela avaliação desse processo.

A interface deve separar **hipótese da IA**, **afirmação de fonte** e **relato/medição do ensaio**. A crítica pode dizer “há indícios de conflito” ou “falta informação”; não deve pintar um nó como fisicamente correto. Um diagrama bonito pode reforçar um erro e um simulador só vale sob as hipóteses declaradas. O próprio artigo discute julgamentos incorretos do modelo: [§8.4.1](https://arxiv.org/html/2502.19133v1#S8.SS4.SSS1).

## Próximos testes que realmente discriminam a decisão

1. **Revisão localizada:** casos com falha de execução, peça defeituosa, premissa falsa e observação insuficiente. Avaliar causa proposta, mudanças indevidas e conservação das partes válidas. Comparar o prompt atual com uma proposta conservadora; não aceitar os rótulos da IA como gabarito.
2. **Contexto entre entradas:** o mesmo pedido pelo chat e pelo painel, com um recurso já definido em outra categoria. Verificar duplicações, contradições e respeito ao critério próprio.
3. **Ajuda:** comparar explicação direta e ajuda progressiva mantendo modelo e tarefa. Medir uso e esforço; aprendizagem exige uma tarefa equivalente posterior sem assistência.
4. **Ponte documental:** requisitos presentes, ausentes e contraditórios em anexos. Conferir trechos citados e recusa de conclusões físicas sem ensaio.
5. **Artefatos:** escolher perguntas específicas que a árvore não responde bem. Verificar se interação torna uma relação examinável, sem esconder hipóteses ou ocupar mais espaço do que a informação exige.

Os itens 1, 3, 4 e 5 são propostas, não resultados executados. Para o item 2, três regressões determinísticas reproduziram o contexto ausente antes da correção e passaram depois dela: decomposição pelo chat recebe recurso já definido fora do ramo e habilidade conhecida sem duplicar o nó; explicação e crítica recebem partes relacionadas; nenhum dos três revela o critério oculto. A geração externa foi substituída no teste, portanto isso valida passagem de contexto e preservação do estado, não a qualidade de uma resposta real da IA.

Comando executado: `npm test -- src/ai/plannerTools.test.ts src/ai/planStructure.test.ts` — 13 testes aprovados. A recomendação é experimentar revisão localizada a seguir, enquanto o laboratório de artefatos testa liberdade visual, interação e encaixe no canvas em paralelo.

## Incremento autorizado: ponto de partida e referências

O formulário agora distingue **Engenharia reversa** e **Criação nova**, independentemente do arquétipo e da estratégia. Os campos opcionais `planApproach` e `referenceTarget` acompanham persistência, importação/exportação, geração, decomposição, tutor, crítica e chat. A referência é uma descrição humana ainda não verificada. Sem variante/material suficiente, o motor pede identificação ou registra desconhecidos; ele não inventa uma BOM comercial para o projeto caseiro.

Os prompts separam afirmação documentada, hipótese de projeto e informação ausente. Isso é uma orientação ao modelo, cuja fidelidade ainda exige avaliação externa. A interface e o chat descartam respostas de geração/expansão se abordagem, referência ou anexos mudaram durante o pedido, preservando o plano anterior.

Verificação dirigida final desta frente: **182 testes em 7 arquivos**, incluindo regressões de contexto, campos opcionais, portabilidade e respostas obsoletas. O [laboratório do patinete](C:/__dev_ops__/@artigo/cellproject-builder/docs/design/plan-approach/README.md) acrescenta **24 testes offline** com referência oficial delimitada, omissões, troca de variante e transferência indevida de especificações. Os casos desse laboratório foram escritos para exercitar o verificador: não são resultados de LLM nem evidência de funcionamento físico. O protocolo de comparação com IA está preparado e não foi executado por esta frente.

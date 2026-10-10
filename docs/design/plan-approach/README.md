# Abordagem do plano e teste de patinete

Este laboratório usa casos escritos para testar o tratamento de cobertura, fontes e lacunas. **Não são respostas de uma LLM, uma BOM de fabricação nem uma montagem validada.**

Na aplicação, **Criação nova** parte do objetivo/requisitos e compara caminhos. **Engenharia reversa** parte de um sistema real de referência e examina suas funções, partes e interfaces. A escolha não altera automaticamente aprender/construir nem reaproveitar/fabricar do zero. O alvo de referência e os anexos seguem no contexto; dados ausentes continuam sendo perguntas.

## Referência delimitada

Foram consultadas as [especificações globais do Xiaomi Electric Scooter 4](https://www.mi.com/global/product/xiaomi-electric-scooter-4/specs/) e a [descrição oficial do produto](https://www.mi.com/global/product/xiaomi-electric-scooter-4/) em 10/10/2026. As afirmações em `benchmark.ts` trazem a fonte e a seção. A referência comercial serve para comparar funções; ela não identifica as peças que o usuário possui nem define o patinete caseiro. As páginas consultadas não fornecem uma BOM interna completa, pinagem do controlador ou dimensões das fixações.

Os 12 tópicos e 6 interfaces do roteiro são **critérios deste teste**, não uma lista oficial de componentes. O verificador recebe correspondências declaradas e detecta omissões, citações não registradas, troca de variante e transferência indevida de afirmações. Ele não avalia automaticamente a verdade de paráfrases, cálculos, capacidade estrutural, segurança ou compatibilidade.

## Casos e execução

| Caso sintético | O que discrimina |
| --- | --- |
| Lista genérica | Componentes nomeados sem controle, frenagem, carregamento, conexões ou ensaios suficientes |
| Referência copiada | Fonte real usada para prometer o mesmo desempenho em um projeto diferente |
| Modelo trocado | Nome semelhante confundido com a variante efetivamente documentada |
| Roteiro delimitado | Funções/interfaces abordadas, perguntas concretas e evidência ainda pendente |

`npx vitest run --config docs/design/plan-approach/vitest.config.ts`

Os testes removem cada tópico e cada interface separadamente e exercitam citações inválidas, variantes, incerteza e preservação dos dados. Ter todos os tópicos presentes continua retornando compatibilidade física desconhecida e nenhum ensaio concluído.

## Protocolo para uma comparação real com IA (ainda não executada aqui)

Manter modelo, parâmetros e orçamento iguais; salvar a primeira tentativa, erros, tempo e fontes. Usar o fluxo real de esboço → expansão do aplicativo e uma tarefa comum: “Quero construir um patinete elétrico caseiro; ainda não tenho arquitetura, peças ou desempenho selecionados”.

1. **Criação nova sem referência:** deve definir requisitos e escolhas, sem transformar o objetivo genérico em valores precisos ou em compra automática.
2. **Engenharia reversa sem alvo:** deve pedir identificação do produto/variante/material, preservando desconhecidos; não inventar uma referência comercial.
3. **Engenharia reversa com as duas páginas oficiais anexadas:** examinar o produto documentado, distinguir suas afirmações de hipóteses para o caseiro e mostrar as interfaces não especificadas.
4. **Referência contraditória:** informar no texto “4 Pro”, anexando somente material do “Scooter 4”. O plano deve expor o conflito e solicitar a variante correta, sem combinar as duas especificações.

A avaliação independente deve conferir cada afirmação contra a fonte indicada. Cobertura de temas e formato JSON são verificações técnicas; não demonstram fidelidade da IA, resultado de aprendizagem ou funcionamento do veículo.

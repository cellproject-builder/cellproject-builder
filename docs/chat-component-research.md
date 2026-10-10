# Pesquisa contextual de componentes pelo chat

O chat usa o carrossel existente para apresentar uma lista de componentes com imagens. Cada item ganha um filtro com sua quantidade de referências; um item sem resultado continua visível. **Escolher** adiciona somente aquela imagem ao canvas e ao rascunho de referências do chat. **Base 3D** prepara o mesmo estúdio já existente. Pesquisar não insere imagens nem aprova uma lista de materiais.

## Contexto e comparação

A busca considera o objetivo, as regras, os textos públicos dos nós, sua hierarquia e conexões, as notas e tarefas do projeto e o texto dos anexos salvos. Referências selecionadas com `@` também participam. Notas pessoais não selecionadas, fontes de outros projetos e critérios independentes ocultos ficam fora do contexto. Um modelo explicitamente pedido tem prioridade sobre o contexto; divergências são mostradas, sem trocar o produto silenciosamente.

O agente deve repetir a lista ao pesquisar pedidos como “busque imagens desses itens” e dividir listas maiores em chamadas de até oito objetos. A recuperação consulta cada objeto separadamente. O TypeSafe ordena a **relevância textual** das referências; seu score e sua confiança não demonstram compatibilidade técnica. Contrato do classificador: [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice).

A aplicação lê o texto das páginas reais dos produtos pelo gateway local e solicita uma comparação documental com os requisitos. A interface mostra:

- **Requisitos consultados atendidos:** os checks devolvidos possuem requisitos e especificações citados, sem lacunas declaradas. O rótulo se limita aos requisitos consultados.
- **Conflito encontrado:** ao menos um check documental indica divergência.
- **Compatibilidade pendente:** identidade, variante, requisitos, fontes ou especificações insuficientes; inclui falhas de pesquisa.

As citações precisam existir nos textos recuperados, e a identidade deve corresponder à página e à variante da imagem. Letras nominais, códigos, revisões e unidades não podem desaparecer. Diferenças de caixa, pontuação de nomes e extensão de arquivo não mudam a identidade. Uma comparação entre placa e cabo, por exemplo, exige identidade e especificações de ambos, com o outro candidato explicitamente identificado. Alternativas não são tratadas como peças já escolhidas.

O pedido original da pessoa pode fornecer requisitos; a consulta reescrita pelo agente não cria novos requisitos. Trechos das notas, arquivos e nós mantêm suas próprias fontes. A comparação semântica continua sendo uma interpretação do modelo: conferir a existência de citações não prova que ele interpretou corretamente as especificações. Aparência, confiança e correspondência documental não substituem medição, ensaio de encaixe, teste elétrico ou funcionamento real.

## Atualização e limites

Uma alteração nos requisitos, nas fontes, na hierarquia ou nas conexões invalida a análise anterior e bloqueia novas escolhas daquela busca até pesquisar novamente. A validação se repete imediatamente antes da inserção, inclusive depois de baixar a imagem. Mover um objeto visual não muda um requisito. Escolher várias imagens da mesma busca permanece possível.

O contexto automático usa até 120 fontes e aproximadamente 32 kB de trechos, mais até 8 mil caracteres de referências selecionadas e 4 mil do pedido humano. Recortes são sinalizados. Cada busca apresenta até 12 imagens e lê até seis páginas de especificações, priorizando uma página por item antes de mais alternativas. Uma página bloqueada, sem texto legível, ou sem identidade suficiente mantém a avaliação pendente e preserva as imagens. PDF escaneado continua dependendo de OCR externo. O módulo não pesquisa automaticamente uma BOM inteira nem certifica compatibilidade física.

## Verificação em 9 de outubro de 2026

Regressões cobrem isolamento e recorte de contexto, mudanças estruturais, revisão desatualizada, variantes nominais e conectores diferentes, citações inventadas, requisitos ausentes, comparação de dois componentes, falha documental, cancelamento, agrupamento com resultados vazios, origem humana do pedido e escolhas pelo carrossel. Os testes controlados verificam contratos e estados, sem medir a qualidade geral da interpretação do modelo.

No navegador local, com OpenRouter e TypeSafe reais, o assistente criou a nota sintética **QA · Bancada Arduino** no projeto de demonstração e buscou **Arduino UNO R3** e **cabo USB Type-A para Type-B**. Retornou seis referências de cada item. A documentação do cabo trouxe seus conectores; a análise da placa permaneceu pendente por falta de comprovação suficiente. A seleção de uma placa e de um cabo adicionou ambos ao canvas e criou dois chips de referência no chat. A árvore não foi modificada e nenhum ensaio foi registrado. A inspeção motivou ainda a separação entre pedido humano e consulta reescrita e ajustes de identidade e idioma, cobertos pelas regressões.

[Captura do carrossel agrupado e das duas escolhas](design/screenshots/2026-10-09-chat-component-fit.png).

Verificação final: **829 testes da aplicação e 81 do gateway passaram**; oito testes externos ficaram ignorados. O build TypeScript/Vite passou, com 562 módulos.

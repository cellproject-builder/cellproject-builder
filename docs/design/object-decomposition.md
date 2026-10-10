# Decomposição documentada de objetos reais

Objetivo: relacionar um objeto do canvas a um produto real e à composição documentada da variante escolhida, exportar essa ficha em TXT e gerar peças identificáveis em uma cena didática montada/explodida. A decomposição cria um artefato derivado conectado ao original, mantendo ambos visíveis. O TXT exporta a ficha documental, sem criar notas ou anexos duplicados.

## Fluxo e contrato

1. A ação contextual **Decompor** abre a seção Componentes do Estúdio 3D existente. A criação comum continua disponível ao voltar.
2. O usuário identifica o produto e sua variante. A pesquisa usa fontes retornadas pela busca e lê seu conteúdo por um gateway HTTPS público limitado.
3. Cada componente aceito contém trechos presentes nos documentos recuperados, especificações e lacunas. URLs inventados, citações ausentes e listas sem evidência são rejeitados. O recorte documental e eventuais divergências ficam explícitos; a ficha não promete BOM completa.
4. O usuário seleciona até oito componentes. A pesquisa individual aprofunda as especificações e conserva os documentos já lidos do conjunto: um datasheet genérico de componente não comprova, sozinho, que ele pertence à placa escolhida. Ausência de documentação adicional legível é declarada, sem presumir especificações. O modelo recebe a cena e os pixels das imagens de origem para identificar quais meshes originais pertencem a cada peça; o reuso conserva IDs, tipo, posição, rotação, escala, cor e detalhes existentes. A aprovação confere novamente a igualdade de cada mesh reutilizado. Geometria nova fica reservada a peças ausentes da cena original e é identificada como aproximação.
5. A aprovação cria um modelo derivado ao lado do original, com uma curva tracejada entre eles. O original conserva sua cena, posição e histórico; somente a ficha documental recebe o resultado aprovado. O modo automático respeita a preferência existente. A relação de derivação não significa conexão elétrica.
6. Montado/Explodido e a seleção de peça atuam no derivado, sem modificar o original. A composição mantém grupos semânticos; pernas de um chip não se tornam peças independentes. A interface permite abrir a decomposição pela origem e voltar ao original pelo derivado, no mesmo Estúdio. Seleções menores que a lista documentada são identificadas como vista parcial.
7. Baixar TXT conserva identidade, IDs da origem e do derivado, proveniência, trechos, fontes, limites, geometria original, grupos e posições. Remover ou alterar a base torna a ficha derivada desatualizada; o artefato visível permanece disponível como registro.

O registro `ObjectDecomposition` é opcional no artefato, validado na recuperação/importação e incluído no JSON portátil. `sourceArtifactId` vincula o modelo derivado à origem. Assemblies antigos aplicados no próprio original são materializados em um derivado de ID estável durante a normalização, sem duplicar filhos nas recuperações seguintes. O marcador `assemblyArtifactId` impede recriar uma decomposição removida pelo usuário. A origem dos modelos conserva IDs de imagens/mídias e instrução mesmo após a retenção limitada de propostas. O renderer usa a cena de componentes apenas no derivado; o original sempre exibe sua própria cena.

## Validação inicial — 2026-10-09, anterior aos artefatos separados

Os testes cobrem evidência documental, fontes falsas, variantes, limites, importação, troca transitória de projeto, exclusão/alteração de base, concorrência, composição parcial, aprovação e restauração do modelo original. O renderer conserva posições base, agrupa meshes por peça, enquadra a vista explodida e reverte a animação.

No navegador desktop, a pesquisa real de **Arduino UNO R3 DIP A000066, revisão UNO-TH Rev3e** retornou nove componentes com trechos verificáveis. O resultado declarou a lista incompleta e a ausência de detalhes suficientes para confirmar essa revisão específica. Algumas especificações foram descartadas por falta de trecho correspondente. A identidade informada pelo usuário não comprova a revisão dos documentos.

Foram escolhidos **Microcontrolador ATmega328P** e **Conector USB B**. A pesquisa individual ampliou o conjunto para oito fontes, com uma falha de leitura declarada. A geração produziu **38 primitivas em dois grupos**. Após o aceite, a interface marcou **2 de 9 peças documentadas · vista parcial**. Montado/Explodido funcionou nos dois sentidos; selecionar o microcontrolador atenuou o outro grupo. O TXT baixado conservou os **103 objetos da cena original**, os 38 objetos dos componentes, oito URLs de fontes e os dois grupos, com todos os objetos associados exatamente uma vez.

As falhas reais de schema excessivamente restritivo e resposta truncada motivaram um formato compacto para o provedor, mantendo validação local rigorosa e orçamento adequado de saída. Nenhum resultado dessas falhas substituiu a cena original. A amostra valida o fluxo de pesquisa, geração e inspeção; não mede fidelidade geométrica nem confirma uma BOM completa ou a revisão física da placa.

A proposta de regeneração contém pesquisa enriquecida e geometria pendentes. O aceite aplica ambas juntas; cancelamento, falha ou outra aprovação preservam a vista anterior e invalidam propostas antigas. Na recuperação do workspace, visuais válidos e estruturalmente idênticos preservam a referência original, evitando gravações sem mudança durante reinicialização/HMR. Esse ajuste cobre o gatilho de sobrescrita por aba ociosa; não implementa edição simultânea sincronizada entre abas.

Verificação dessa entrega inicial: **755 testes passaram**, oito live ignorados; **78 testes do gateway passaram**; TypeScript/Vite concluídos. O [primeiro TXT da amostra real](samples/arduino-decomposition-2026-10-09.txt) conserva o resultado exportado antes da última rodada de ajustes de recuperação.

Na repetição após o ajuste de recuperação, a pesquisa de **Arduino UNO R3 DIP A000066** retornou 13 candidatos. Foram selecionados os conectores de alimentação e USB: sete fontes, dois grupos e 12 primitivas. A aplicação conjunta de pesquisa e geometria foi exportada; após recarregar a página e reabrir o projeto, os controles de montagem e restauração permaneceram disponíveis.

Essa rodada também revelou uma distinção essencial: o código da peça estar presente em uma citação não comprova a classificação traduzida pela IA. Alguns nomes sugeridos estavam incorretos. Por isso, o código documentado tem prioridade visual; nomes e funções ficam explicitamente identificados como interpretações, e o enriquecimento pode revisá-los sem trocar a identidade da peça. A geração deve priorizar código, especificações e trechos, sem tomar a classificação sugerida como autoridade geométrica. As fontes e o modelo ilustrativo não substituem a conferência da peça real.

Evidências finais: [TXT dos conectores com interpretações identificadas](samples/arduino-connectors-decomposition-2026-10-09.txt) e [interface de decomposição no canvas](screenshots/2026-10-09-object-decomposition.png).

## Validação da preservação e do vínculo — 2026-10-09

No teste real com **Arduino UNO R3 DIP A000066**, a origem `model-V1KnAwp7tTawkyHoARM-Q` permaneceu no canvas e foi criada a decomposição `decomposition-tJMpkENP89d20YTZiZH9g`. O TXT anterior e o posterior contêm a mesma cena original, com **122 objetos**, sem diferenças. A vista parcial contém **11 objetos em dois grupos**: quatro para alimentação e sete para USB Tipo B. Todos os 11 são cópias exatas da origem, incluindo tipo, posição, rotação, escala e cor; `geometryBasis` é `source`. A conservação geométrica não comprova que a identificação dos grupos pela IA esteja correta ou que o modelo original corresponda a medidas físicas.

A pesquisa inicial leu quatro fontes e retornou 11 candidatos. As tentativas de aprofundamento sem novas evidências revelaram que a pesquisa por componente descartava documentos já lidos do conjunto. Agora esses documentos acompanham o aprofundamento; quando nada novo é confirmado, conservam-se os componentes com trechos já verificados e a lacuna é declarada. Não se aceitam especificações novas sem trechos correspondentes.

Montado/Explodido atua somente no derivado, com retorno ao original no mesmo Estúdio. A revisão anterior da origem conserva o artefato derivado e torna sua ficha desatualizada quando a cena muda. Resultados antigos são materializados em filhos separados; filhos removidos não reaparecem na recuperação.

Verificação atual: **793 testes passaram**, oito live ignorados; TypeScript/Vite concluídos. Os testes incluem Ctrl + arrastar sem seleção, preservação e segmentação, propostas adulteradas, cancelamento, concorrência, migração/importação e pesquisa complementar com evidências existentes. No navegador, Ctrl + clique não selecionou o modelo; o arraste contínuo com Ctrl foi validado pelos testes de interação, pois a ferramenta de navegador não disponibiliza esse gesto com a tecla mantida.

Evidências: [TXT da decomposição vinculada](samples/arduino-linked-decomposition-2026-10-09.txt) e [original e derivado no mesmo canvas](screenshots/2026-10-09-linked-object-decomposition.png).

## Limites

A ficha exige documentação de objeto existente. Fotografias orientam aparência, sem provar medidas nem componentes ocultos. A visão explodida de peças soldadas é didática; não representa um procedimento de desmontagem nem valida um conjunto fabricável. Circuitos, redes elétricas e encaixes não são inferidos como fatos. Fontes oficiais também podem divergir entre revisões: não fundir UNO R3 DIP A000066 com SMD A000073.

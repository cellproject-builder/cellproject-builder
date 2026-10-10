# Estado da fidelidade 3D e da decomposição

Revisão de 10/10/2026, baseada nos arquivos preservados. Nenhuma inferência, chamada paga, remodelagem ou medição física foi feita nesta revisão.

O motor demonstra capacidade geométrica e a montagem modular funciona na amostra salva. A fidelidade a produtos reais e a decomposição em componentes internos continuam abertas. Os resultados existentes não sustentam um vencedor geral entre geração com e sem guia de skills.

## O que foi efetivamente ensaiado

| Conjunto | Natureza da evidência | Conclusão permitida | Limite |
|---|---|---|---|
| [Geometry tests](../geometry-tests/) | Quatro fixtures determinísticas, construídas em TypeScript: extrusão com furos, revolução, tubo e malha livre | O renderer consegue expressar essas geometrias além das primitivas simples | Não são saídas de IA, reproduções de produtos ou encaixes validados |
| [Primeira comparação](../three-skills-comparison/comparison.json) | Duas respostas reais preservadas: ESP32 sem referências, uma por condição de guia; 98 e 49 objetos | Permite inspecionar aquele par e seus custos | Uma saída por condição; mais objetos não provam mais fidelidade |
| [Matriz v2](../three-skills-comparison/matrix/README.md) | 32 primeiras respostas reais: 2 objetos × 4 referências × 2 condições de guia × 2 repetições | Comparação controlada dentro do contrato antigo `SceneV1`; respostas, consumo e IDs preservados | Piloto pequeno; sem matriz de notas de fidelidade, avaliadores cegos ou validação física |
| [Pré-execução arquivada](../three-skills-comparison/matrix/preflight-audit-failure-20261009/README.md) | Bloqueio local da auditoria antes do transporte remoto | Evidência de um problema de integração corrigido | Zero respostas de modelo; não contar como falhas de modelagem nem como mais 32 inferências |
| [MG90S avançado](../mg90s-advanced/) e [TXT](../samples/mg90s-advanced-2026-10-10.txt) | Uma montagem válida salva, apresentada na página como geração real: 69 objetos em 3 módulos; 20 extrusões, 9 revoluções e 3 tubos | Demonstra geração modular com geometria ampliada e inspeção reversível | O TXT não traz um ledger completo de tentativas/consumo/IDs de resposta; `sources=[]`, unidades ilustrativas e variante não confirmada |

Conferência offline dos arquivos da matriz: 32 estados `success`, 32 IDs de resposta, 16 entradas com imagem, nenhum desacordo entre arquivos individuais e manifesto; custo registrado somado US$ 1,3180004. Isso verifica os registros, sem reexecutar inferência ou atribuir qualidade às 32 cenas.

Nesta revisão foram inspecionadas cinco capturas preservadas: [MG90S sem referência, repetição 1](../three-skills-comparison/matrix/screenshots/mg90s-none-1.png), [MG90S com imagem, repetição 1](../three-skills-comparison/matrix/screenshots/mg90s-image-1.png), [ESP32 com imagem, repetição 1](../three-skills-comparison/matrix/screenshots/esp32-image-1.png), [montagem avançada](../screenshots/2026-10-10-mg90s-advanced.png) e [geometrias técnicas](../screenshots/2026-10-10-geometry-tests.png). Isso não equivale a uma nova avaliação visual integral das 32 saídas.

## Skills e referências são eixos independentes

| Eixo | Condições da matriz | Pergunta que permite investigar |
|---|---|---|
| Instrução de modelagem | Prompt anterior / guia adaptado | O guia muda a execução do mesmo pedido, dadas as mesmas evidências? |
| Evidência sobre o objeto | Nenhuma / pixels / especificações / pixels + especificações | A informação fornecida reduz erros de identidade, disposição e proporção? |

Cada par recebeu a mesma referência. O guia não substitui a referência; a referência não é uma skill. A intervenção é um guia adaptado de três skills, com regras e receitas próprias, e não o texto upstream isolado. A receita específica de ESP32 foi acionada, enquanto a expressão “microservo MG90S” recebeu somente o guia geral: comparar os dois objetos como se tivessem recebido a mesma intervenção específica seria incorreto.

A matriz usa o contrato anterior de cinco primitivas, com limite de 128 objetos. A montagem avançada usa extrusão, revolução e tubos, mas não tem um controle equivalente sem guia. Não se pode atribuir sua diferença visual exclusivamente a skill, referência ou geração por módulos. A página antiga descreve o uso de referências no aplicativo daquela data; isso não é auditoria do fluxo de produção atual.

## Qualidade fraca ainda aberta

- **Identidade e acessórios:** a captura do MG90S sem referência mostra horn instalado nas duas condições; a captura com foto não o mostra, acompanhando a referência escolhida. A análise registrada da matriz relata esse padrão nos quatro resultados sem referência e nos 12 com referência. Isso demonstra mudança de premissa, não confirmação da variante comercial exata.
- **Conectividade:** na captura MG90S com imagem, repetição 1, os segmentos do cabo da condição com guia estão visivelmente separados. O registro relata ausência desse defeito na repetição 2. Portanto, é um erro concreto de uma saída, sem evidência de falha geral do guia.
- **Detalhe correto:** a análise dos JSONs registrada na matriz aponta contagens diferentes de contatos do ESP32 com imagem apenas. Com especificações, os oito resultados preservam as dimensões nominais de PCB e as duas fileiras de 19 contatos fornecidas. Contagem de meshes e uma silhueta reconhecível não substituem essa conferência. A ilustração de referência superior, pequena, não fornece altura dos pinos.
- **Escala:** o viewer reenquadra cada resultado individualmente. Tamanhos na tela não medem escala absoluta. As espessuras não fornecidas e as divergências dimensionais da fonte MG90S continuam incertezas.
- **Granularidade da decomposição:** a amostra avançada separa servo completo com acessórios, suporte em U e elo curto. Os 59 objetos do servo permanecem naquele módulo. O próprio pedido exclui engrenagens internas. Não é uma decomposição documentada em motor, trem de engrenagens, eletrônica e carcaça, nem um BOM real completo.
- **Interfaces físicas:** as âncoras e superfícies da montagem avançada são ilustrativas. Não confirmam estriado, rosca, folga, alinhamento fabricável, resistência ou transmissão de movimento. A documentação primária não foi recuperada nesse ensaio; não preencher essas lacunas com dimensões inventadas.

Reexecução offline de `npx vite-node --mode test docs/design/mg90s-advanced/validate.ts`: passou com cobertura exata dos 69 objetos nos 3 módulos, caixas dos módulos disjuntas na explosão completa, posições restauradas com tolerância de teste de `1e-9` e JSON original inalterado. Esse teste valida organização e reversibilidade; não mede fidelidade ao fabricante, colisões na trajetória inteira ou qualidade mecânica. Os números de suítes escritos nas páginas são registros históricos, não uma nova execução geral nesta revisão.

## Rubrica mínima para a próxima avaliação

Pontuar cada critério separadamente: **0** = contradição/erro observável; **1** = atendimento parcial; **2** = atendimento dos itens verificáveis da referência. Usar **NV** quando faltar evidência ou vista suficiente, registrando o motivo. Não somar notas para anunciar um vencedor neste piloto.

| Critério | Conferência mínima |
|---|---|
| Identidade e variante | Produto e versão confirmados; conector, eixo e acessórios compatíveis; aproximações identificadas |
| Cobertura de peças | Checklist congelado dos componentes visíveis ou documentados; ausências, duplicações e inventados; distinguir módulo de mesh e de peça física |
| Silhueta e disposição | Vistas superior, frontal e lateral contra a mesma referência; proporções e posições relativas, sem inferir faces ocultas |
| Escala e interfaces | Unidade única; dimensões efetivamente fornecidas; furos, eixos e contatos coerentes; peças contínuas; distinguir verificação virtual de ensaio físico |
| Incertezas e proveniência | Origem, variante, partes não verificadas e dimensões aproximadas explícitas; ausência de alegação de CAD/encaixe sem fonte ou ensaio |

Ainda não existe um preenchimento completo dessa rubrica para as 32 cenas. A matriz de geração está concluída; a matriz de fidelidade humana está pendente. “Cena válida” é apenas aceitação pelo contrato.

## Avaliação offline executada: oito saídas MG90S, repetição 1

Rodada de revisão de 10/10/2026: duas condições de guia × quatro condições de referência, **somente repetição 1**. Este recorte foi solicitado para cobrir todos os tipos de referência, em lugar do recorte nenhuma/ambas com duas repetições proposto abaixo. As oito primeiras saídas já estavam preservadas; nenhuma foi gerada, alterada ou escolhida depois de observar sua qualidade. Avaliação por um agente, sem cegamento, com leitura dos oito JSONs, da foto oficial local e das quatro capturas pareadas existentes: [nenhuma](../three-skills-comparison/matrix/screenshots/mg90s-none-1.png), [imagem](../three-skills-comparison/matrix/screenshots/mg90s-image-1.png), [especificações](../three-skills-comparison/matrix/screenshots/mg90s-specs-1.png), [ambas](../three-skills-comparison/matrix/screenshots/mg90s-both-1.png).

Checklist externo fixo: caixa escura, duas abas opostas com indicação de furos, ressalto circular e eixo deslocados, eixo metálico sem horn, três vias de cabo junto à base e continuidade entre partes. Para silhueta/identidade visual, também foram observados ressalto secundário e painel roxo da foto; **texto foi excluído**, conforme o pedido original. A foto sem horn serve como alvo comparável, mas as condições sem referência não receberam essa informação: a diferença de acessórios indica a consequência dessa ausência, sem ser rotulada como desobediência ao prompt.

Na tabela, **I** = identidade visual, **C** = cobertura do checklist externo, **S** = silhueta/disposição, **E** = escala virtual informada, **R** = relações/conectividade observáveis, **U** = incertezas/proveniência comunicadas pelo artefato. E e R desdobram o quarto critério da rubrica. Aplicam-se 0/1/2/NV definidos acima; `2` cobre apenas o que a evidência disponível permite conferir. Variante exata, escala física, tolerâncias e componentes internos são **NV em todas as linhas**. Os IDs são links para os resultados integrais.

| Run ID | I | C | S | E | R | U | Evidência e limite específico |
|---|---:|---:|---:|---:|---:|---:|---|
| [mg90s-none-1-baseline](../three-skills-comparison/matrix/runs/mg90s-none-1-baseline.json) | 1 | 1 | 1 | NV | 1 | 1 | 36 objetos. Abas, eixo deslocado e três fios presentes; horn instalado, caixa superior em bloco e painel azul diferem da foto não fornecida. Escala sem unidade. Vista não mostra integralmente a saída do cabo ou face traseira. |
| [mg90s-none-1-skills](../three-skills-comparison/matrix/runs/mg90s-none-1-skills.json) | 1 | 1 | 1 | NV | 1 | 1 | 40 objetos. Horn instalado, tampa metálica clara e quatro indicações de furos nas abas, diferentes da aparência da foto não fornecida; painel ocre. Eixo deslocado e três vias estão presentes. Sem unidade e sem conferência das faces ocultas. |
| [mg90s-image-1-baseline](../three-skills-comparison/matrix/runs/mg90s-image-1-baseline.json) | 2 | 2 | 2 | NV | 1 | 1 | 44 objetos. Sem horn; caixa escura, ressalto principal + secundário, eixo estriado e painel roxo acompanham a foto. Cabo curto de três vias com junções indicadas. Pixels não fornecem medidas; continuidade e perfil traseiro não foram integralmente conferidos. |
| [mg90s-image-1-skills](../three-skills-comparison/matrix/runs/mg90s-image-1-skills.json) | 2 | 2 | 2 | NV | 0 | 1 | 50 objetos. Detalhes de identidade da foto presentes, sem horn. Três vias existem, mas os segmentos finais do cabo estão separados dos anteriores; defeito visível e confirmado pelas coordenadas. Saída do cabo fica relativamente mais alta na caixa; precisão física NV. |
| [mg90s-specs-1-baseline](../three-skills-comparison/matrix/runs/mg90s-specs-1-baseline.json) | 1 | 2 | 1 | 2 | 1 | 1 | 30 objetos. Atende às famílias de peças descritas, sem horn; corpo X=22,8/Z=12,2, eixo X=5,7. Não reproduz painel e ressalto secundário da foto não fornecida. Cabo parcialmente oculto na captura; JSON contém três vias. |
| [mg90s-specs-1-skills](../three-skills-comparison/matrix/runs/mg90s-specs-1-skills.json) | 1 | 2 | 1 | 2 | 1 | 1 | 23 objetos. Corpo X=22,8/Z=12,2, eixo X=5,6; abas, furos indicados e três vias, sem horn. Sem painel/ressalto secundário da foto não fornecida; cabo reto sai da face Z positiva. Essa posição não contradiz o texto genérico, mas não reproduz a foto. |
| [mg90s-both-1-baseline](../three-skills-comparison/matrix/runs/mg90s-both-1-baseline.json) | 2 | 2 | 2 | 2 | 1 | 1 | 45 objetos. Sem horn, painel roxo, ressaltos principal + secundário e estrias. Corpo X=22,8/Z=12,2, eixo X=5,1. O painel omite a faixa escura da foto, sem impedir reconhecimento; face traseira/saída completa do cabo não observadas. |
| [mg90s-both-1-skills](../three-skills-comparison/matrix/runs/mg90s-both-1-skills.json) | 1 | 2 | 1 | 2 | 1 | 1 | 33 objetos. Sem horn; corpo X=22,8/Z=12,2, eixo X=5,0 e três vias. Mantém ressaltos/estrias, mas omite inteiramente o painel roxo apesar dos pixels fornecidos. JSON confirma ausência do painel; não é apenas oclusão da captura. |

**Conferências numéricas offline:** nos quatro resultados com especificações, o intervalo da face inferior da tampa inferior até o topo do cilindro principal do eixo mede 28,5 unidades; X/Z do corpo principal são 22,8/12,2. Isso confirma uso dos números de entrada no conjunto virtual, sem validar detalhes, saliências, a divergência da fonte ou encaixe. Os furos são indicados por cilindros escuros/toros sobre abas sólidas: não são passagens reais, mas o checklist deste contrato antigo só exigia indicação.

**Defeito de continuidade reproduzível:** em `mg90s-image-1-skills`, `cabo-marrom-curva` tem centro `[2,-0.65,-0.36]` e diâmetro 0,115; `cabo-marrom-final` é um cilindro com centro `[2.3123,-0.7567,-0.36]`, comprimento 0,66, diâmetro 0,115 e rotação Z=1,9 rad. Aplicando a transformação usada pelo renderer, a distância mínima do centro da esfera ao segmento de eixo do cilindro é aproximadamente **0,20193**, superior à soma dos raios **0,115**. Há separação geométrica; as vias vermelha e laranja repetem as mesmas posições XY/rotação. Esses valores são unidades de cena, não milímetros. A captura confirma o defeito. R=1 nas outras saídas significa inspeção parcial sem defeito grosseiro registrado, não certificação de toda conexão.

**Limites das notas:** identidade visual 2 não autentica fabricante/variante. Cobertura 2 significa famílias externas presentes, não BOM, engrenagens ou eletrônica interna. Silhueta foi observada somente na vista oblíqua salva; faltam vista ortográfica superior, perfil lateral oposto, traseira e inferior, e não há foto de referência desses lados. U=1 em todas: os registros externos preservam proveniência e as cenas se dizem ilustrativas, mas seus rótulos não carregam todas as incertezas de dimensões/variante. O contrato antigo não tem um campo próprio para isso; não se trata de exigir texto fora do schema. Nenhuma linha recebeu nota global.

**Conclusão desse recorte:** a foto melhorou a correspondência de elementos visíveis nas duas condições de guia; as especificações fixaram proporções numéricas, preservando simplificações visuais. O guia apresentou tanto detalhes adicionais quanto perda de detalhe e um erro de conectividade. A saída com ambas e sem guia retém mais sinais visuais da foto do que sua parceira nesta repetição; isso não prova superioridade geral. Restam a repetição 2, avaliação independente e vistas adicionais antes de comparar estabilidade. Nenhuma das oito cenas avalia decomposição interna ou geração modular avançada.

## Próximo ensaio delimitado

Primeiro, sem custo de inferência: preencher a rubrica nas oito saídas MG90S das condições **nenhuma** e **ambas**, cobrindo guia ligado/desligado e duas repetições. Preservar IDs, capturar três vistas iguais e ocultar o rótulo de condição durante a avaliação, preferencialmente por duas pessoas. Fixar checklist a partir do `cases.json`; registrar desacordos e NV. Isso compara o efeito das evidências no contrato antigo, sem misturá-lo com o motor novo.

Depois, se for autorizada uma nova rodada paga: uma articulação MG90S + suporte + elo, **8 primeiras saídas** no motor atual = guia ligado/desligado × nenhuma referência/pacote confirmado de referências × duas repetições. Fixar modelo, orçamento geométrico, tokens, checklist de módulos e interfaces e ordem contrabalançada; preservar falhas e todos os retornos, sem reparos seletivos. O pacote deve confirmar variante e disponibilizar fotos/documentos legíveis; se não houver medidas confiáveis, o resultado permanece ilustrativo. Avaliar montado e explodido pela mesma rubrica, incluindo continuidade de cabos e conservação da cena original. Componentes internos exigem documentação própria e devem ser outro ensaio, em vez de serem inventados para aumentar detalhe.

A avaliação de oito saídas da repetição 1 acima foi executada; os dois desenhos adicionais propostos nesta seção não foram executados integralmente. Nenhuma conclusão sobre aprendizagem ou funcionamento do robô decorre desses testes de renderização.

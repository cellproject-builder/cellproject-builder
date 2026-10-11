# Estúdio 3D: cenas ilustrativas, conjuntos modulares e decomposição

Este documento descreve o código inspecionado em 10/10/2026. **Implementado** significa que há fluxo e contrato no aplicativo; não significa qualidade geométrica garantida, validação física ou eficácia educacional demonstrada. Os testes citados são evidências de comportamento do software; esta auditoria documental não executou inferências, ensaios físicos ou novas comparações.

O nome de interface atual é Dynamic Diary; caminhos, formatos e nomes internos ainda usam `cellproject`. O recorte científico canônico está em [Objetivo do artigo](../OBJETIVO_DO_ARTIGO.md): explicitar premissa, registrar previsão própria, realizar ensaio, observar e revisar com justificativa. O 3D pode ajudar a examinar a premissa; sua aparência não realiza esse ciclo.

## Finalidade e estado

O estúdio transforma um pedido e referências delimitadas em uma representação 3D examinável no mesmo canvas do plano. O diferencial técnico observável é combinar contexto por identidade, geometria declarativa, aprovação, revisões e inspeção de partes, conservando a separação entre documentação e ilustração. Não há avaliação que estabeleça novidade científica ou superioridade geral dessa combinação.

| Capacidade | Estado observado | Limite principal |
|---|---|---|
| Geração padrão | Implementada: uma inferência de `SceneV1`, validada antes da proposta | Até 128 objetos na geração padrão; não produz CAD validado |
| Geração avançada | Implementada: seleção de contexto → pesquisa opcional → contrato modular → inferência por módulo → composição | Envelopes e contatos são convenções geométricas ilustrativas |
| Geometria customizada | Implementada: extrusão, revolução, tubo e malha indexada, além das primitivas | Não equivale a kernel CAD, tolerâncias ou malha imprimível certificada |
| Refinar o texto do pedido | Implementada, sob ação explícita, no mesmo campo de escrita | Exige texto; preserva referências e não inicia geração nem cria evidência física |
| Editar modelo existente | Implementada: substituição completa da cena como revisão do mesmo artefato | O LLM pode alterar detalhes; o sistema não prova equivalência semântica de cada peça |
| Decomposição documental | Implementada: identidade informada, fontes lidas, peças com trechos e lacunas | Trecho presente não prova que a interpretação da IA ou a identidade escolhida está correta |
| Vista decomposta com original preservado | Implementada: artefato filho separado, com proveniência de reaproveitamento | A classificação de primitivas em peças continua sendo uma interpretação |
| Montagem rígida de cenas salvas arbitrárias | Laboratório em [assembly.html](../design/interactive-artifacts/assembly.html) | Não é um compositor de artefatos reais do workspace com persistência do conjunto |
| Controle do robô, comunicação, ensaios automáticos | Futuro, fora deste módulo | Não há comprovação de integração física ou robô concluído |

Há duas estruturas diferentes chamadas montagem no código: `VisualModelAssembly` é o contrato da **geração avançada**; `DecompositionAssembly` é uma **vista de peças de um objeto pesquisado**. A primeira não exige que cada módulo seja uma peça documentalmente demonstrada. A segunda exige um dossiê, mas sua geometria e posições permanecem ilustrativas.

## Fluxo de uso

1. Abra o plano e o estúdio pelo botão de cubo. Escolha 3D e geração padrão ou avançada. A entrada reúne texto, menções `@` e anexos. A geração avançada pode incluir o nó selecionado como referência inicial.
2. Selecione notas, nós e imagens disponíveis no escopo do plano. Imagens podem vir de arquivo local, galeria ou referência já inserida no canvas. Usar uma imagem como base seleciona seu ID; envio dos pixels depende de `analyzeImages`.
3. Opcionalmente, use **Refinar pedido com IA** para aprimorar o texto já escrito. A resposta substitui apenas o texto do mesmo campo, preservando menções, anexos e modo de construção. O compositor e seus botões permanecem visíveis; não há conversa de confirmação nem geração automática. Sem texto, a ação fica desabilitada. Editar o rascunho, fechar o editor ou trocar de projeto cancela o refinamento; minimizar mantém a operação. Se o contexto mudar, o resultado não substitui o rascunho. Digitar, selecionar `@` ou anexar um arquivo não inicia uma inferência por si só.
4. Gere. Em `approval`, o resultado válido e atual fica `ready` até **Aplicar**. Em `automatic`, o mesmo contrato permite aplicação imediata se o contexto ainda for atual. `stale` indica referência/contexto alterado e impede aplicação.
5. No canvas, mova e redimensione o objeto, alterne a rotação ou use os gestos disponíveis. O vínculo opcional com um nó é associação de contexto; não impõe posição nem conexão mecânica.
6. Para ajustes, abra o editor do artefato e confirme **OK**. A revisão pertence ao mesmo ID e preserva o layout atual, mesmo se a pessoa moveu o artefato durante a inferência. Reverter recupera a revisão anterior.
7. Para examinar componentes, abra o inspetor. Um conjunto avançado já apresenta módulos e contrato. A pesquisa documental é um fluxo adicional: confirme a identidade exata, pesquise fontes, examine peças/trechos/lacunas e selecione até oito peças para preparar uma vista decomposta.
8. Aplique essa vista quando pronta, conforme a política ativa. O original continua inteiro e surge um artefato filho ao lado. Separação, destaque da peça e retorno ao conjunto alteram a vista. Exportar TXT registra o dossiê/contrato; não cria automaticamente nota, tarefa ou ensaio.

As ferramentas têm abas independentes, destaque em janelas e progresso por pedido. Minimizar ou mover uma aba preserva a operação; fechar uma aba em processamento a recolhe, e **Cancelar** interrompe o pedido. Recarregar ou sair do construtor não promete retomar requisições. A descrição completa desse ciclo está em [Abas e janelas](../visual-studio-tabs.md).

## Responsabilidades e pipeline

| Camada | Arquivos e responsabilidade |
|---|---|
| Entrada e ciclo de abas | [TabbedVisualExplorer](../../src/visuals/ui/TabbedVisualExplorer.tsx), [sessionStore](../../src/visuals/ui/sessionStore.ts), [VisualExplorer](../../src/visuals/ui/VisualExplorer.tsx), [PromptComposer](../../src/visuals/ui/PromptComposer.tsx) |
| Ponte com canvas | [VisualWorkspaceBridge](../../src/visuals/VisualWorkspaceBridge.tsx): posicionamento, anexos, referências, handoff e carregamento do compositor GPU |
| Orquestração | [controller](../../src/visuals/controller.ts): geração comum, colocação no viewport e publicação de resultados externos |
| Domínio | [domain](../../src/visuals/domain.ts): projeto proprietário, fontes acessíveis, fingerprint, rascunhos, propostas, aplicação, vínculo e reversão |
| Geração padrão | [generation](../../src/visuals/generation.ts): snapshot, mídia selecionada, uma inferência e validação local |
| Refinamento no compositor | [refinement](../../src/visuals/refinement.ts): reescrita explícita, referências selecionadas, limites do renderer e guardas de contexto; [VisualExplorer](../../src/visuals/ui/VisualExplorer.tsx) aplica somente o novo texto |
| Geração avançada | [advancedContext](../../src/visuals/advancedContext.ts), [advancedGeneration](../../src/visuals/advancedGeneration.ts), [modelAssembly](../../src/visuals/modelAssembly.ts): ramo pertinente, contrato e composição |
| Geometria e contrato | [types](../../src/visuals/types.ts), [normalize](../../src/visuals/normalize.ts), [geometrySchema](../../src/visuals/geometrySchema.ts), [modelingGuide](../../src/visuals/modelingGuide.ts) |
| Revisão do objeto | [modelRevision](../../src/visuals/modelRevision.ts), [ModelArtifactEditor](../../src/visuals/ui/ModelArtifactEditor.tsx) |
| Pesquisa e decomposição | [decompositionResearch](../../src/visuals/decompositionResearch.ts), [decomposition](../../src/visuals/decomposition.ts), [decompositionGeometry](../../src/visuals/decompositionGeometry.ts), [decompositionState](../../src/visuals/decompositionState.ts) |
| Inspeção e desenho | [DecompositionPanel](../../src/visuals/ui/DecompositionPanel.tsx), [ModelAssemblyInspector](../../src/visuals/ui/ModelAssemblyInspector.tsx), [VisualArtifactNode](../../src/visuals/rendering/VisualArtifactNode.tsx), [VisualCanvasLayer](../../src/visuals/rendering/VisualCanvasLayer.tsx), [modelItem](../../src/visuals/rendering/modelItem.ts) |

### Geração padrão

`generateVisualScene` copia a entrada, congela o contexto selecionado e observa alterações de projeto e fontes. Verifica anexos e, quando autorizado, carrega os bytes das imagens selecionadas. O provedor recebe um schema simplificado para transporte; o retorno passa pelo `sceneSchema` local, que é mais restritivo. Resposta truncada, cena inválida, cancelamento e projeto diferente não são convertidos em sucesso.

`generateVisualModel` registra proposta com entrada, fingerprint, snapshot de contexto e IDs de mídia. `applyVisualProposal` revalida escopo, contexto e cena antes de inserir. As chamadas usam `maxRetries: 0`; não há reparo pago oculto neste fluxo.

### Geração avançada

O índice de contexto percorre descendentes do nó selecionado, ancestrais que explicam sua finalidade e pré-requisitos pelas arestas de entrada. Não expande automaticamente os irmãos de um ancestral. Imagens ligadas ao ramo também podem entrar no índice. São no máximo 120 nós e 24 imagens, com índice limitado a 16 KB e aviso sobre omissões.

A primeira inferência escolhe até 12 nós, seis imagens e dois alvos de pesquisa, verificados contra IDs disponíveis. A pesquisa procura documentos das variantes pertinentes; o gateway lê os documentos. Falha de pesquisa permanece em `unknowns`; resumo de busca não se torna especificação.

Uma segunda inferência prepara de dois a oito módulos no mesmo sistema de coordenadas, com centros, envelopes, orçamentos e até 24 interfaces. O plano local limita cada módulo a 96 objetos e o total a 512. `sourceIds` só pode apontar para documentos realmente obtidos; imagem, nota e anexo não viram IDs documentais.

Cada módulo é gerado separadamente em coordenadas comuns. O sistema confere orçamento, limites de cena, contenção no envelope e objeto indicado para cada contato. A tolerância geométrica dessa conferência é 3% da maior dimensão do envelope; é uma margem de implementação, não tolerância de fabricação. IDs recebem o prefixo do módulo e os grupos devem cobrir a cena inteira sem atribuição duplicada. O resultado parcial não é gravado quando um módulo falha.

O campo `units` admite `illustrative` ou `mm`, mas a validação numérica não certifica a origem metrológica da escala. Âncora comum e sobreposição de caixas delimitadoras não verificam colisão, encaixe, ligação elétrica, cinemática, resistência ou segurança.

### Decomposição documental e preservação do original

O dossiê registra identidade, fontes com texto e data, peças, códigos/quantidades quando documentados, trechos e lacunas. A extração usa texto efetivamente lido, incluindo PDF com texto quando disponível. Trechos precisam ocorrer nas fontes após normalização; códigos precisam constar dos trechos, especificações sem trecho são retiradas e quantidades sem formulação documental explícita ficam desconhecidas. Isso verifica correspondência textual, não a verdade do documento ou toda inferência de pertencimento.

Uma imagem também pode receber pesquisa/dossiê. Gerar a vista decomposta exige um artefato `model` com cena: o fluxo não extrai automaticamente uma montagem 3D segmentada de qualquer fotografia. Artefatos filhos remetem ao original para nova pesquisa, evitando decomposição recursiva tratada como nova evidência.

Ao gerar a vista das peças, a prioridade é **segmentar e reaproveitar** as primitivas existentes. Para cada peça selecionada, a resposta aponta `sourceObjectIds` ou propõe geometria nova quando a peça estiver ausente. Não pode misturar reaproveitamento e substituição na mesma peça nem atribuir a mesma primitiva a duas peças. A aplicação copia os objetos selecionados exatamente e verifica tipo, posição, rotação, escala, cor e geometria de cada ID reaproveitado.

`geometryBasis` distingue `source`, `generated` e `mixed`; essa proveniência geométrica é independente da evidência documental. A aplicação cria um filho com `sourceArtifactId`, conserva o original e coloca a vista sem sobrepor os artefatos existentes. Formas não classificadas do original permanecem como contexto, sem serem apresentadas como novas peças demonstradas. A inspeção explodida usa grupos, offsets e transição reversível; esses deslocamentos são didáticos.

Fingerprints do objeto e do dossiê invalidam pesquisa ou montagem desatualizada. Mover/redimensionar e girar a vista não mudam a identidade pesquisada. Uma revisão geométrica muda essa base e retira o dossiê ativo do modelo revisado. Recuperação de versões antigas migra a decomposição que antes era sobreposta ao original para uma vista separada; ciclos de `sourceArtifactId` são recusados.

## Contratos, dados e persistência

`SceneV1` contém versão, rótulo e objetos com ID, tipo, posição XYZ, rotação Euler em radianos, escala e cor hexadecimal. Os tipos básicos são caixa, esfera, cilindro, cone e toro. `custom` exige uma geometria admitida: `extrude`, `lathe`, `tube` ou `buffer`. Coordenadas são finitas e delimitadas; escalas são positivas; IDs da cena são únicos. O contrato completo e os limites de pontos, segmentos e índices estão em [geometrySchema](../../src/visuals/geometrySchema.ts). O orçamento estimado agregado é de 600.000 triângulos, conferido antes da alocação de buffers.

O guia atual declara `scene-v1-modeling-guide/2`; a versão anterior continua no código para comparações reproduzíveis. É uma adaptação revisada de instruções Three.js para esse contrato. A cena não configura scripts, câmera, luzes ou materiais PBR livres: o aplicativo escolhe renderer, iluminação e propriedades de material, enquanto o modelo fornece forma e cor admitidas.

O artefato pertence a `Project.visuals` e contém layout, cena, origem, revisão ativa, revisões, vínculo opcional, dossiê e/ou contrato modular. `VisualWorkspace` guarda modo, artefatos, até 40 propostas e último rascunho de busca/modelo. O schema admite até 512 artefatos e 100 revisões por artefato. As fronteiras de recuperação/importação estão em [normalize](../../src/visuals/normalize.ts) e [projectBoundary](../../src/visuals/projectBoundary.ts).

Bytes de anexos e imagens são referenciados por ID. [media](../../src/visuals/media.ts) usa IndexedDB local ou o runtime de mídia cloud quando ativo. [portable](../../src/visuals/portable.ts) exporta snapshot do plano e os bytes necessários a artefatos, revisões, propostas e anexos, validando o pacote antes da importação. O detalhe de orçamento e coleta está em [Mídia e portabilidade](../design/visual-media-portability.md).

Ângulo, inclinação, zoom, separação e peça destacada ficam em [viewStore](../../src/visuals/rendering/viewStore.ts), como estado de inspeção em memória. Não criam revisões nem evidências. Abas, janelas e resultados temporários são estado de sessão; o último rascunho persistido não representa todos os rascunhos de abas.

## Contexto e integrações

- **Plano:** o modelo é um artefato visual no [GraphCanvas](../../src/components/GraphCanvas.tsx), com posição independente do layout conceitual. `linkedNodeId` é opcional; o filho decomposto pode mostrar vínculo de origem com outro artefato. Nenhum desses vínculos é uma conexão física.
- **Notas:** menções oferecem notas pessoais e do projeto proprietário. O corpo visual de uma nota selecionada contém título e blocos; não se deve presumir que todo o canvas da nota ou seus pixels foi enviado. Nós têm serialização explícita, que omite critérios de IA ainda ocultos e explicações relacionadas.
- **Imagens:** a seleção por ID e os bytes autorizados são descritos em [Referências de imagem](image-references.md). `vision.ts` não busca imagens ocultamente: no fluxo do plano, usa somente imagens selecionadas e `analyzeImages: true`, com até oito imagens e 20 MiB agregados. Provedor sem suporte a imagem produz erro explícito, sem repetir como texto.
- **Chat:** [visualTools](../../src/ai/visualTools.ts) expõe listar referências, buscar imagens, gerar modelo e gerar diagrama através dos mesmos serviços e da política humana de aplicação. O chat força geração padrão; não expõe geração modular avançada ou decomposição como ações dessa ferramenta. Não pode mudar a política. O handoff do estúdio envia apenas menções selecionadas ao compositor; preserva o rascunho e não envia mensagem automaticamente.
- **Board:** [generation](../../src/boards/generation.ts) reutiliza `SceneV1`, guia e componentes de renderização, mas tem contexto, geração e documento próprios. [BoardCanvas](../../src/boards/BoardCanvas.tsx) adapta seus modelos ao compositor GPU. Colar modelo do plano cria cópia da cena; não transporta contrato modular, dossiê, vínculo ao plano ou sincronização. Essa fronteira não é uma montagem de modelos dos dois domínios.
- **TypeSafe:** atua na relevância textual de imagens e em outros fluxos de classificação; não valida a cena 3D, dimensões ou montagem. Ver [Referências de imagem](image-references.md).

O renderer usa uma superfície WebGL transparente compartilhada, viewport/scissor por artefato e desenho sob demanda. Movimento e inspeção reutilizam recursos GPU quando a entrada geométrica não muda. Perda/restauração de contexto e liberação de recursos têm tratamento explícito. Os controles DOM continuam no React Flow; WebGL 2 indisponível apresenta fallback. Transparência do renderer não remove o fundo de fotografias.

## Evidências e verificações

| Evidência | O que permite inspecionar |
|---|---|
| [advancedGeneration.test.ts](../../src/visuals/advancedGeneration.test.ts) | Ramo/pré-requisitos, referências documentais separadas, contexto transitório, cancelamento, orçamento, falha sem conjunto parcial e preservação customizada |
| [domain.test.ts](../../src/visuals/domain.test.ts), [normalize.test.ts](../../src/visuals/normalize.test.ts) | Escopo, critérios ocultos, propostas, aplicação, recuperação e contratos inválidos |
| [modelRevision.test.ts](../../src/visuals/modelRevision.test.ts) | Revisão do mesmo objeto, alteração concorrente, layout preservado e reversão |
| [refinement.test.ts](../../src/visuals/refinement.test.ts), [VisualExplorer.test.tsx](../../src/visuals/ui/VisualExplorer.test.tsx) | Reescrita no mesmo campo, envio separado, rascunho obrigatório, minimização, cancelamento, contexto alterado e falha sem perda do texto |
| [decompositionResearch.test.ts](../../src/visuals/decompositionResearch.test.ts) | Leitura documental, trechos, variantes, códigos, quantidades e lacunas |
| [decomposition.test.ts](../../src/visuals/decomposition.test.ts), [decompositionGeometry.test.ts](../../src/visuals/decompositionGeometry.test.ts) | Artefato filho, conservação do original, reaproveitamento exato, contexto não classificado, dossiê e geometria aplicados juntos |
| [customGeometry.test.ts](../../src/visuals/rendering/customGeometry.test.ts), [modelItem.test.ts](../../src/visuals/rendering/modelItem.test.ts), [lifecycle](../../src/visuals/rendering/VisualCanvasLayer.lifecycle.test.tsx) | Geometria/recursos Three.js, inspeção e ciclo de desenho |
| [DecompositionPanel.test.tsx](../../src/visuals/ui/DecompositionPanel.test.tsx), [TabbedVisualExplorer.test.tsx](../../src/visuals/ui/TabbedVisualExplorer.test.tsx) | Controles, pesquisa pendente, aprovação, cancelamento e abas concorrentes |
| [portable.test.ts](../../src/visuals/portable.test.ts), [artifactClipboard.test.ts](../../src/visuals/artifactClipboard.test.ts), [visualTools.test.ts](../../src/ai/visualTools.test.ts) | Portabilidade, cópia independente e ação do chat sem falsa aplicação |

Os testes de inferência usam mocks. Teste DOM não comprova todos os gestos em navegador, desempenho em hardware real ou fidelidade geométrica. A [entrega visual](../visual-canvas-validation.md) preserva checkpoints e QA anteriores; suas contagens não são o resultado desta auditoria.

O [guia adaptado](../visual-modeling-skills.md) registra origem e limites das instruções. A [matriz de comparação](../design/three-skills-comparison/matrix/README.md) preserva protocolo, primeiras respostas, falhas prévias e resultados salvos. É piloto com duas repetições por condição; número de objetos/custo/tempo não é nota de qualidade. Trechos históricos que descrevem ausência de análise de pixels documentam aquela versão: o fluxo atual tem opção de visão em [vision](../../src/visuals/vision.ts).

## Uso possível em artigo e evidência ainda necessária

| Questão candidata | Evidência necessária além do software |
|---|---|
| A vista 3D ajuda a pessoa a explicitar uma premissa errada do plano? | Premissa e previsão registradas antes do ensaio; comparação com chat sob mesmo LLM/tarefas equivalentes; avaliação independente da premissa identificada |
| Separar documentação, interpretação e geometria reduz confiança indevida? | Julgamentos humanos antes/depois, avaliação cega de afirmações apoiadas e extrapoladas, análise dos casos `unknown` e variantes |
| O contrato modular melhora consistência entre partes? | Pedidos/contratos estáveis, várias tarefas/repetições, critérios geométricos definidos previamente, taxas de falha e custo de correção; não apenas screenshots |
| Preservar o original favorece revisão justificada? | Trilhas de decisões e comparação entre original, vista derivada e observação física; medida de perdas de detalhe e erros de classificação |
| Há transferência de aprendizagem? | Tarefa equivalente posterior sem assistência, além do desempenho durante o uso |

Para o caso do robô, modelos e dossiês podem registrar o que se supôs sobre peça, função, dimensão e encaixe. Medidas reais, teste de peça, montagem e resultado observado precisam existir fora da ilustração e entrar no ciclo descrito no objetivo científico. Exportar um TXT ou observar uma animação não demonstra montagem física.

## Fronteiras que merecem modularização futura

Diagnóstico, sem alteração de runtime nesta auditoria:

1. `domain.ts` mistura escopo do workspace, serialização de fontes, contratos de propostas e mutações de artefato. Separar leitores de contexto de comandos permitiria testar suas permissões sem importar todos os stores.
2. `advancedGeneration.ts` concentra seleção, pesquisa, planejamento, inferências e validação espacial. Suas etapas e [advancedErrors](../../src/visuals/advancedErrors.ts) já permitem uma extração posterior por contrato; a composição deve continuar atômica.
3. `decompositionResearch.ts` serve tanto decomposição quanto revisão documental de produtos e geração avançada. Um leitor documental compartilhado evitaria acoplar consumidores a um serviço nomeado pela decomposição, preservando trechos/fontes/lacunas.
4. O renderer é reutilizado pelo Board, mas [modelArtifactItem](../../src/visuals/rendering/VisualCanvasLayer.tsx) consulta validade de decomposição por meio do estado do plano. Uma entrada de renderização inteiramente resolvida antes do compositor reduziria essa dependência e deixaria explícito o que cada domínio fornece.
5. Contrato modular, dossiê documental e cena são conceitos distintos. Manter essa distinção em nomes/API evita apresentar um grupo geométrico como peça comprovada ou dar ao Board uma proveniência que sua cópia não preserva.

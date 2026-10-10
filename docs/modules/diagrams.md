# Diagramas declarativos e laboratório de React gerado

Descrição baseada na leitura do código em 10/10/2026. **A geração de diagramas declarativos está integrada ao aplicativo.** O experimento de React/JavaScript gerado continua separado, em `docs/design/interactive-artifacts`. Esta auditoria escreveu documentação; não realizou novas inferências nem verificações de navegador.

O [objetivo científico](../OBJETIVO_DO_ARTIGO.md) é desconstruir planos com evidências físicas. Diagramas ajudam a tornar relações e premissas examináveis. Uma fórmula que recalcula corretamente ou um desenho convincente não demonstra que o mundo físico obedece ao modelo adotado.

## Finalidade, diferencial técnico e estado

O módulo produz documentos visuais delimitados: mapas de relações, ilustrações e relações numéricas com controles exploratórios quando úteis. O diferencial técnico observável é compartilhar uma gramática validada entre plano, notas e Board, com limites de contexto específicos de cada superfície. Não há resultado que comprove benefício de aprendizagem ou superioridade científica dessa arquitetura.

| Recorte | Estado | O que realmente ocorre |
|---|---|---|
| Diagrama no plano | Implementado | Proposta declarativa, aprovação/automático, layout independente, vínculos opcionais, revisão e portabilidade |
| Diagrama em nota | Implementado | Uma nota opcionalmente fornece contexto; prévia e inserção explícita no canvas da nota |
| Diagrama no Board | Implementado | Documento independente, geração e inserção próprias, mesma gramática/renderizador |
| Diagrama estático | Implementado | `parameters: []` é válido; sliders não são obrigatórios |
| React gerado livremente | Experimental | Código salvo compilado para laboratório e executado em iframe restrito |
| Grupos, transformações, séries, layout de grafos ou widgets arbitrários | Fora da gramática atual | Exigem expansão deliberada de contrato; não presumir suporte por serem possíveis em SVG/React |
| Validação de um modelo físico | Não implementada por este módulo | A pessoa precisa ensaiar, medir e confrontar premissas com evidências |

O termo “React/SVG” em produção significa que **React do aplicativo renderiza dados validados**. O LLM não entrega componente React executável nesse fluxo. TypeSafe também não decide se os cálculos, desenhos ou hipóteses físicas do diagrama são verdadeiros.

### Legibilidade nos temas

O renderizador compartilhado adapta rótulos existentes e novos ao tema claro, escuro ou OLED, sem regravar as cores do documento. Texto sem `fill` usa a cor temática; cores explícitas com contraste insuficiente são ajustadas, preservando as que já são legíveis. A avaliação considera a superfície CSS, retângulos/círculos preenchidos anteriormente ao texto e composição de transparência. `none` e alpha zero permanecem invisíveis. A troca de tema recalcula a apresentação. O guia de geração compartilhado recomenda `currentColor` para texto sobre o canvas transparente.

Essa proteção busca contraste mínimo de 4,5:1 no ponto de referência do rótulo. Não interpreta interiores de paths arbitrários nem garante contraste de um texto que atravessa fundos diferentes; também não garante tamanho/legibilidade após reduzir o zoom. A gramática e o documento persistido permanecem os mesmos. A regressão está em [DiagramView.test.tsx](../../src/visuals/diagram/DiagramView.test.tsx); a apresentação em [contrast.ts](../../src/visuals/diagram/contrast.ts) e [useDiagramPalette.ts](../../src/visuals/diagram/useDiagramPalette.ts).

## Uso e integrações

### Plano e chat

Abra o estúdio pelo botão de cubo e escolha **Diagrama**. O mesmo compositor aceita texto, referências `@` e anexos; ao trocar para diagrama, o nó selecionado pode ser incluído como referência. A geração usa modo padrão, preservando as referências disponíveis. A opção de análise de imagens, quando enviada, segue a mesma fronteira explícita de [vision](../../src/visuals/vision.ts).

O resultado válido vira proposta. Em aprovação, a pessoa aplica; no automático, só um resultado atual é aplicado. No canvas, posição/redimensionamento pertencem ao artefato. `linkedNodeId` é associação opcional do artefato inteiro; `elements[].nodeId` permite abrir nós específicos por clique ou teclado. Esses IDs têm finalidades diferentes. Nenhum deles cria dependência conceitual ou conexão física.

Controles deslizantes atualizam apenas `diagramValues`. Abrir um nó não o confirma; alterar um parâmetro não escreve critério próprio, observação, falha ou conclusão. O editor **Ajustar este diagrama** pede uma substituição completa e registra revisão; mantém IDs/parâmetros coerentes quando possível e preserva o layout atual. Reverter recupera documento e valores anteriores.

O [chat](../../src/ai/visualTools.ts) expõe `visual_action.generate_diagram`, encaminhando ao mesmo serviço e à política humana de aplicação. `ready` é apresentado como aguardando aplicação, sem declarar que já mudou o canvas. O chat não pode escolher outra política. O estúdio usa as mesmas [abas temporárias](../visual-studio-tabs.md) que o 3D.

### Notas

[NoteDiagramComposer](../../src/workspace/NoteDiagramComposer.tsx) gera prévia sem alterar a nota; **Inserir na nota** efetiva a gravação. A opção **Usar conteúdo da nota** delimita o contexto. [noteDiagram](../../src/workspace/noteDiagram.ts) lê título, blocos, textos/legendas do canvas e semântica dos diagramas existentes, com orçamento e aviso de truncamento. Não inclui pixels, traços de caneta, layout, notas vizinhas ou projeto implícito.

A assinatura acompanha conteúdo semântico: mover/redimensionar o canvas ou desenhar não invalida uma interpretação textual; editar/excluir a nota invalida o pedido pertinente. A inserção conserva os valores explorados como defaults do documento. `parseDiagram(..., [])` recusa IDs de nós de projeto. Um diagrama de nota não ganha vínculo ao plano por compartilhar o renderer.

### Board

[generation](../../src/boards/generation.ts) e [BoardComposer](../../src/boards/BoardComposer.tsx) têm entrada e assinatura próprias: conteúdo opcional do quadro e IDs de itens selecionados. A resposta precisa ser válida e atual antes da inserção. Imagens explicitamente referenciadas seguem o fluxo multimodal do Board; esse consentimento por seleção não deve ser confundido com o campo `analyzeImages` do plano.

[BoardItemNode](../../src/boards/BoardItemNode.tsx) reutiliza `DiagramView` e grava parâmetros no item. Colar um diagrama do plano no [BoardCanvas](../../src/boards/BoardCanvas.tsx) copia documento/valores e limpa `nodeId` de todos os elementos. Não sincroniza o original nem cria ligação de projeto. Notas, Board e plano têm persistência e comandos diferentes.

## Pipeline e responsabilidades

```text
Pedido + contexto autorizado
  → snapshot e assinatura/fingerprint
  → uma inferência textual JSON, sem código
  → parse JSON + schema/validações locais
  → proposta ou prévia da superfície
  → aplicação/inserção conforme o fluxo
  → React cria somente elementos/atributos SVG permitidos
```

| Responsabilidade | Implementação |
|---|---|
| Tipos, schema, avaliação aritmética e bindings | [diagram/model.ts](../../src/visuals/diagram/model.ts) |
| Geração/revisão no plano | [diagram/generation.ts](../../src/visuals/diagram/generation.ts) |
| Contexto e proposta do plano | [domain.ts](../../src/visuals/domain.ts), [controller.ts](../../src/visuals/controller.ts) |
| Renderização e controles | [DiagramView.tsx](../../src/visuals/diagram/DiagramView.tsx) |
| Inserção como artefato do plano | [normalize.ts](../../src/visuals/normalize.ts), [VisualArtifactNode.tsx](../../src/visuals/rendering/VisualArtifactNode.tsx), [GraphCanvas.tsx](../../src/components/GraphCanvas.tsx) |
| Contexto da nota | [noteDiagram.ts](../../src/workspace/noteDiagram.ts), [NoteDiagramComposer.tsx](../../src/workspace/NoteDiagramComposer.tsx) |
| Contexto do Board | [boards/generation.ts](../../src/boards/generation.ts), [BoardComposer.tsx](../../src/boards/BoardComposer.tsx) |
| Laboratório isolado | [viewer.tsx](../design/interactive-artifacts/viewer.tsx), [isolation.ts](../design/interactive-artifacts/isolation.ts) |

No plano, a geração inclui referências escolhidas e um resumo de até 80 nós em `planNodes`, com indicação de parcialidade. Fontes de nós usam serialização que omite critérios de IA ainda ocultos; `nodeId` só pode ser nulo/ausente ou ID real do plano. Trocar de projeto, remover fonte ou alterar o contexto invalida a aplicação. Alterações transitórias são acompanhadas, não apenas comparadas no início/fim.

O transporte usa `generateText` com JSON textual, schema descrito no prompt e `maxRetries: 0`. O schema simplificado de geração usa array homogêneo para `viewBox`; `parseDiagram` aplica o contrato completo localmente. Isso responde às recusas de schema de tupla registradas no laboratório. Resposta inválida/truncada não recebe reparo pago oculto.

## Contrato declarativo

`DiagramV1` é documento versionado com título, explicação, premissas, `viewBox`, parâmetros, constantes, cálculos, elementos e bindings. A gramática deliberadamente pequena é a fronteira de execução; o sistema não avalia expressões JavaScript.

| Parte | Regras observadas |
|---|---|
| Área | `viewBox: [0, 0, width, height]`, largura 100–1200 e altura 100–800 |
| Parâmetros | Até seis; número finito, faixa válida, default dentro da faixa e passo positivo compatível |
| Constantes/cálculos | Até 16 constantes e 16 cálculos; IDs únicos e cálculo em ordem topológica |
| Operações | Produto, soma, diferença e quociente; diferença/quociente recebem dois operandos |
| Aritmética | Rejeita referência desconhecida, divisão cujo denominador pode cruzar zero e resultados não finitos/excessivos |
| Elementos | De um a 100: `rect`, `circle`, `line`, `path`, `polyline`, `text` |
| Bindings | Até 60, por elemento/atributo admitido; sem duplicação; transformam um valor por multiplicador/offset |
| Texto/cores | Strings limitadas; texto renderizado como texto; cores delimitadas a sintaxe admitida |
| IDs | IDs aritméticos/elementos restritos e sem nomes de protótipo; IDs de nós do plano permanecem opacos |
| Payload | Objetos estritos; não aceita URLs, handlers, imports, CSS, JSX ou HTML executável |

A validação calcula intervalos possíveis ao longo das faixas de parâmetro, limita geometria numérica e verifica caixas/círculos. Paths e polylines têm sintaxe, comandos, números e tamanho delimitados. **Não há comprovação geral de confinamento visual:** a validação não calcula a caixa exata de todo path, curva, stroke ou texto, nem assegura legibilidade/ausência de sobreposição. O SVG usa `overflow: hidden`; recortar desenho não é demonstrar qualidade do layout.

`DiagramView` revalida o documento, resolve bindings e cria os seis tipos SVG com lista de atributos permitidos. Sliders e botões de nó param a propagação de eventos para evitar gestos acidentais do canvas. Nós clicáveis recebem foco e Enter/Espaço. Essas medidas fornecem interações verificáveis, sem constituir auditoria completa de acessibilidade.

## Dados e persistência

No plano, `VisualArtifact.kind === 'diagram'` exige `diagram`, cena/mídia nulas e revisão do mesmo tipo. `diagramValues` só admite parâmetros existentes dentro das faixas. Origem, layout, vínculo opcional, propostas e revisões seguem `Project.visuals`; a revisão guarda entrada, fingerprint e IDs de mídia selecionados quando existentes.

Documento e valores viajam no [pacote portátil](../../src/visuals/portable.ts) e em [cópias independentes](../../src/visuals/artifactClipboard.ts). Recuperação remove vínculos com nós que não existem, inclusive em revisões, preservando o desenho e seu layout. Importar uma revisão de tipo misturado ou estado de parâmetro fora do contrato falha.

Nas notas e no Board, o documento integra o item do respectivo canvas e segue o snapshot de workspace. Não existe sincronia automática entre cópias em superfícies diferentes. Estado temporário de prévia, aba, progresso e erro não equivale ao documento persistido. Diagramas declarativos dispensam WebGL; o compositor GPU é responsabilidade de imagens/modelos.

## React gerado: o que foi experimentado

O [laboratório](../design/interactive-artifacts/README.md) contém uma resposta React livre e respostas declarativas salvas, além de tentativas inválidas e diagnósticos de transporte. [EVALUATION](../design/interactive-artifacts/EVALUATION.md) registra uma tarefa por condição, prompts/transportes diferentes e três tentativas declarativas anteriores à saída válida. Não é comparação controlada suficiente para escolher uma arquitetura vencedora.

No React experimental, o código foi compilado como bundle de amostra e roda em iframe com origem opaca, `sandbox="allow-scripts"`, sem `allow-same-origin`. A CSP restringe conexões/subrecursos e o recebimento de mensagens verifica janela, origem e IDs de nós permitidos. [isolation.ts](../design/interactive-artifacts/isolation.ts) e [ARCH_REVIEW](../design/interactive-artifacts/ARCH_REVIEW.md) explicam que isso não demonstra prevenção de toda navegação da própria janela, loops, exaustão de CPU/memória ou execução segura de qualquer código futuro.

O laboratório não grava no plano de produção. Abrir o viewer lê arquivos salvos; scripts de inferência/reparo são opt-in e podem usar APIs, portanto não são necessários para inspecionar as amostras. A implementação declarativa posterior está documentada em [PRODUCTION](../design/interactive-artifacts/PRODUCTION.md). Frases sobre integração futura no README inicial são registro histórico, não descrição do estado atual de `src/visuals/diagram`.

## Evidências e limites de verificação

| Arquivo | Cobertura relevante |
|---|---|
| [model.test.ts](../../src/visuals/diagram/model.test.ts) | IDs reais opacos, relação de torque/alcance/carga e diagrama estático sem sliders |
| [generation.test.ts](../../src/visuals/diagram/generation.test.ts) | Uma inferência, política de aplicação, contexto obsoleto, revisão/reversão e alteração concorrente |
| [integration.test.ts](../../src/visuals/diagram/integration.test.ts) | Contrato, artefato livre, layout, vínculos, clipboard, importação, parâmetros e pacote portátil |
| [DiagramView.test.tsx](../../src/visuals/diagram/DiagramView.test.tsx) | Recalcular bindings, seleção por teclado e isolamento dos gestos do canvas |
| [visualTools.test.ts](../../src/ai/visualTools.test.ts) | Roteamento de diagrama versus 3D, aprovação e parâmetros de ação restritos |
| [noteDiagram.test.ts](../../src/workspace/noteDiagram.test.ts), [composer](../../src/workspace/NoteDiagramComposer.test.tsx) | Contexto da nota, nenhuma leitura implícita de pixels/projeto, prévia/inserção e contexto alterado |
| [boards/generation.test.ts](../../src/boards/generation.test.ts), [BoardItemNode.test.tsx](../../src/boards/BoardItemNode.test.tsx) | Contexto independente, IDs de projeto recusados, diagramas inválidos e atualização de parâmetro |
| [isolation.test.ts](../design/interactive-artifacts/isolation.test.ts), [diagram.test.ts](../design/interactive-artifacts/diagram.test.ts) | Fronteira de mensagens e amostras locais do laboratório |

As inferências nos testes de produção são simuladas. Esses arquivos não comprovam qualidade de novas respostas do provedor, funcionamento de todos os gestos reais, isolamento completo de código arbitrário, fidelidade física ou aprendizagem. Checkpoints anteriores e capturas estão em [PRODUCTION](../design/interactive-artifacts/PRODUCTION.md) e [screenshots](../design/interactive-artifacts/screenshots/); não foram reexecutados nesta auditoria.

## Possíveis questões de pesquisa

| Questão | Evidência ainda necessária |
|---|---|
| Explorar uma relação ajuda a formular um critério próprio antes do ensaio? | Registro anterior à revelação do critério da IA, julgamento independente e comparação com chat comum sob condições equivalentes |
| Um diagrama favorece revisão localizada sem duplicar o plano? | Histórico de interação e revisões, identificação do nó/premissa alterado e justificativa apoiada no resultado real |
| A gramática declarativa reduz falhas de aplicação em relação a React gerado? | Contratos estabilizados, conjunto de tarefas/repetições, mesmos pedidos, sucesso visual/funcional, custo de reparo e limites de segurança medidos |
| Sliders produzem compreensão ou apenas aparência de certeza? | Separar estimativas, medidas e hipóteses no protocolo; tarefas de transferência sem IA e avaliação de extrapolações indevidas |

A amostra de torque emprega simplificações. Uma pessoa pode verificar a aritmética da relação e ainda ter um modelo físico incompleto. Para o artigo, o desenho deve explicitar hipóteses e lacunas e levar a um ensaio pertinente; não pode substituir observação física.

## Diagnóstico de modularização

O núcleo `diagram/model.ts` e `DiagramView` já funcionam como contratos reutilizáveis. Geração do plano, nota e Board repete instruções de JSON, chamada textual, parse, detecção de truncamento e proibição de código. Uma extração futura de transporte/validação compartilhada pode reduzir divergências, mantendo **adaptadores de contexto e comandos de aplicação próprios**. Unificar o contexto dessas superfícies indiscriminadamente retiraria uma proteção existente.

A validação de paths é diferente da contenção geométrica numérica. Uma futura expansão de gramática precisa declarar quais limites são sintáticos, aritméticos, geométricos e de apresentação, acompanhada de fixtures e testes apropriados. React livre deve permanecer em fronteira explicitamente experimental até existir avaliação de recursos e isolamento compatível com o uso pretendido.

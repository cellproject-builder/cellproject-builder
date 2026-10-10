# Entrega e validação dos pop-ups visuais

Registro da entrega de 9 de outubro de 2026, limitada aos dois pop-ups do canvas e suas integrações. O roteiro amplo de oito tarefas continua separado; esta entrega não representa sua conclusão nem uma validação física do estudo de caso do artigo.

Este documento preserva a evidência da entrega inicial e acrescenta, abaixo, a integração da mesma data entre o painel inicial, as referências do canvas, o estúdio 3D e o chat, além da rodada posterior com guia de modelagem e duas amostras LLM reais.

## Entrega implementada

- **Buscar imagens:** pop-up independente e arrastável, compositor com `@`, anexos, grade 3×3, paginação, navegação de cartões e ações de adicionar, copiar e usar como base 3D. A busca usa referências reais registradas no gateway local e permite o fallback Wikimedia Commons.
- **Gerar 3D:** pop-up independente com rascunho persistido, fontes selecionadas e anexos. O provedor BYOK produz uma cena declarativa validada localmente; aprovação guarda a proposta, enquanto automático aplica apenas uma resposta ainda compatível com o projeto e as fontes.
- **Canvas e chat:** imagens locais podem ser coladas ou arrastadas para o plano; a integração visual usa o mesmo domínio e respeita o escopo do projeto. As cenas são renderizadas com Three.js usando primitivas permitidas.
- **Persistência e portabilidade:** visuais, propostas e rascunhos pertencem ao projeto; os bytes originais ficam no IndexedDB. O JSON portátil inclui originais de artefatos, revisões, propostas e anexos. Importação e recuperação protegem o plano conceitual contra cenas inválidas. A avaliação textual completa, quando recebida, preserva modelo, rubrica, distribuição, legenda e instante de avaliação.

Os testes cobrem, entre outros casos, fontes de outro projeto, critérios ainda ocultos, edição ou exclusão de fonte, navegação durante requisições, validação de cenas e imagens, deduplicação, portabilidade, recarga e importação tardia. O arquivo [mídia e portabilidade](design/visual-media-portability.md) documenta formatos, limites e coleta de originais órfãos.

## Verificação automática da entrega inicial

Resultados registrados na execução integrada da entrega inicial, anteriores à rodada de integração descrita abaixo:

| Verificação | Resultado |
|---|---|
| `npm test` | 471 testes passaram; 8 testes live foram ignorados |
| `npm run test:gateway` | 14 testes passaram |
| `tsc -b` (incluído no build) | Sem erros; código de saída 0 |
| `npm run check:gateway` | Verificação de sintaxe concluída; código de saída 0 |
| `npm run build` | Build concluído; código de saída 0 |

Os testes usam dependências controladas quando necessário. Eles não demonstram uma chamada paga bem-sucedida ao provedor LLM ou ao TypeSafe. O aviso sobre a idade da base Browserslist não impediu as verificações.

## QA no navegador da entrega inicial

Conferência na aplicação local em `http://127.0.0.1:5190/`. O plano de demonstração foi exportado antes do ensaio 3D e restaurado pela importação do JSON portátil depois dele.

| Fluxo | Evidência atual | Estado |
|---|---|---|
| Busca real por ESP32 | Retornou 10 referências do Wikimedia Commons | Conferido |
| Grade e paginação | Grade com 9 itens e controles de paginação visíveis | Conferido |
| Dois pop-ups independentes e móveis | Ambos abertos; estúdio deslocado pelo cabeçalho e fechamento independente | Conferido |
| Composição com `@` | Nota, nó e foto do canvas selecionados; Enter escolhe a fonte sem enviar a geração | Conferido |
| Anexar arquivo | TXT local preparado e exibido como anexo; sem chamada ao provedor | Conferido |
| Copiar e colar foto | Referência JPEG copiada como bytes PNG; Ctrl+V criou foto no canvas com o título da fonte | Conferido |
| Mover foto no canvas | Posição da alça mudou após o arraste; orientação conceitual permaneceu automática | Conferido |
| Adicionar referência e usar como base | Ação criou uma foto e abriu sua referência no estúdio | Conferido |
| Deck | Clique na lateral foi de 1/10 para 2/10; roda do mouse foi para 3/10 | Conferido |
| Arraste da galeria | Miniatura de ESP32 on Lolin32 Lite clone board arrastada até uma área livre do canvas criou um terceiro artefato | Conferido |
| Falha de miniatura | Fonte indisponível mostrou mensagem de prévia indisponível e bloqueou ações que dependem dos bytes; link da fonte permaneceu acessível | Conferido |
| Recarregar e recuperar | Duas fotos, posições, texto e referências selecionadas recuperados após reload | Conferido |
| Exportar/importar JSON portátil | Exportação pela interface; restauração recuperou plano e as duas fotos sem depender das URLs remotas | Conferido |
| Renderização Three.js | Fixture identificada como QA: nove primitivas de braço robótico, WebGL ativo, fundo transparente, comando de rotação | Conferido |
| Viewport estreito | Em 390×844, estúdio entre x=8 e x=382,4, sem estouro horizontal (scrollWidth=390); viewport restaurado | Geometria conferida; interação móvel completa não exercitada |
| Tema e acessibilidade | Tema escuro conferido visualmente; seleção com teclado exercitada; traduções, IME e outras interações cobertas nos testes | Auditoria completa não realizada |
| Arraste de arquivos do sistema | Implementado; anexo pelo seletor e colagem de imagem foram conferidos separadamente | Não exercitado manualmente nesta execução |

A renderização de QA foi feita com uma cena local declarativa, **não com uma resposta gerada pelo LLM**. A foto original conserva o fundo que já existia no arquivo; transparência do renderer não equivale a remover fundo de fotografias.

Evidências: [dois pop-ups](design/screenshots/2026-10-09-popups-visuais.jpg) e [modelo ilustrativo transparente](design/screenshots/2026-10-09-three-transparente.jpg).

A chave TypeSafe configurada no servidor não foi encontrada nos 14 arquivos textuais examinados do build. Não foram observados erros ou avisos no console capturado durante a conferência.

## Integração do painel inicial, canvas e chat

A faixa ASCII foi integrada ao próprio painel **Construtor de planos**, abaixo da apresentação e das opções iniciais. Os cinco temas — engenharia, planos, blueprints, ideias e matemática — recebem destaque conforme a opção inicial apontada pelo mouse ou focada pelo teclado. As animações usam frames de texto e CSS; o controle de pausa interrompe os dez frames e a preferência de movimento reduzido mantém desenhos estáticos. Em telas estreitas, a rolagem horizontal fica dentro da faixa.

O compositor do chat aceita `@` tanto no espaço de trabalho quanto dentro do plano. A seleção explícita inclui notas pessoais/do projeto, partes do plano e fotos do canvas, identificadas por ID. Enter escolhe uma sugestão aberta sem enviar uma mensagem. A ação **Conversar sobre** de uma foto e **Levar referências ao chat** do estúdio alimentam esse mesmo compositor, preservando o texto já digitado no chat e seu contexto. Fontes repetidas são unidas sem duplicação; um conflito entre projetos é rejeitado, preservando a seleção anterior.

O handoff fecha os dois pop-ups visuais para dar lugar ao chat, sem navegar para outro projeto, enviar uma mensagem ou iniciar geração. No estúdio, somente as menções selecionadas são transferidas: seu texto e seus anexos continuam no rascunho local. Modelos 3D não são apresentados como referências de fotografia.

### Verificação automática da rodada de integração

| Verificação | Resultado |
|---|---|
| `npm test` | 487 testes passaram; 8 testes live foram ignorados |
| `npm run test:gateway` | 14 testes passaram |
| `npm run check:gateway` | Verificação de sintaxe concluída; código de saída 0 |
| `npm run build` | TypeScript e Vite concluídos; 529 módulos processados; código de saída 0 |

As novas coberturas incluem seleção com `@`, handoff por identidade, preservação do rascunho, deduplicação, contexto de projeto e ausência de envio/geração automáticos. Os testes não exercitaram inferência paga do LLM nem do TypeSafe.

### QA no navegador da rodada de integração

| Fluxo | Evidência | Estado |
|---|---|---|
| Faixa integrada no desktop | Cinco temas dentro do painel inicial, com destaque ligado às opções existentes | Conferido |
| Pausa da faixa | Os dez frames tiveram sua animação pausada | Conferido |
| Movimento reduzido | Animações desativadas e primeiro frame estático | Conferido |
| Faixa em viewport de 390 px | Sem overflow horizontal do documento; rolagem interna da faixa com 293 px visíveis para 725 px de conteúdo | Conferido |
| `@` no chat do espaço de trabalho | Notas pessoais listadas; Enter selecionou uma referência sem envio | Conferido |
| Escape no seletor de referências | Fechou as sugestões de `@` e manteve o chat aberto | Conferido |
| Foto do canvas → chat | Referência entrou no compositor e preservou o texto já digitado no plano Demo | Conferido |
| Estúdio 3D → mesmo chat | Uma nota, uma parte e duas fotos foram unidas por ID, totalizando quatro fontes sem duplicação; os dois pop-ups fecharam | Conferido |
| Proteção entre projetos | Handoff conflitante rejeitado; rascunho e fontes anteriores preservados | Coberto por teste automatizado |

Capturas desta rodada: [faixa ASCII integrada](design/screenshots/2026-10-09-ascii-integrado.jpg) e [referências no mesmo chat](design/screenshots/2026-10-09-chat-referencias.jpg). As evidências anteriores dos pop-ups e da renderização Three.js permanecem registradas acima.

O console capturado nesta rodada não apresentou avisos ou erros.

## Guia de modelagem e comparação com respostas LLM reais

A geração recebeu o guia `scene-v1-modeling-guide/1`, uma adaptação revisada das skills `threejs-fundamentals`, `threejs-geometry` e `threejs-materials` da CloudAI-X, fixadas no commit `b1c623076c661fc9b03dac19292e825a5d106823`. Os originais permanecem em `.agents/skills/`; a aplicação usa um guia próprio ajustado ao contrato do renderer, sem executar os exemplos JavaScript upstream. [Origem e limites](visual-modeling-skills.md).

### Verificação automática da rodada de modelagem

| Verificação | Resultado |
|---|---|
| `npm test` | 490 testes passaram; 8 testes live foram ignorados |
| `npm run test:gateway` | 14 testes passaram |
| `npm run build` | TypeScript e Vite concluídos; 530 módulos processados; código de saída 0 |
| TypeScript do gerador de amostras e do visualizador | Zero diagnósticos |

Os testes novos verificam que a geração usa o guia, seleciona receitas pertinentes e mantém comandos embutidos nas referências fora das instruções de sistema.

### Duas inferências reais e inspeção visual

Foram executadas duas chamadas OpenRouter ao modelo `openai/gpt-6.1-sol`: uma com o prompt anterior preservado e outra com o guia adaptado. Ambas receberam o mesmo pedido de ESP32 ilustrativo, contexto vazio, schema, raciocínio `medium` e limite de 10.000 tokens de saída, sem temperatura definida. As primeiras respostas válidas foram preservadas, sem edição dos objetos.

| Condição | Resultado observado |
|---|---|
| Sem guia de skills | 98 primitivas; 59,610 s; `finishReason=stop`; cena válida |
| Com guia de skills | 49 primitivas; 32,814 s; `finishReason=stop`; cena válida |
| Renderização | Dois modelos renderizados pelo mesmo `modelItem` da aplicação, com fundo transparente; grade pertence ao visualizador |
| Rotação sincronizada | **Girar 90°** alterou os dois modelos; **Restaurar vista** recuperou a orientação inicial |
| Interação móvel do visualizador | Não exercitada manualmente nesta rodada |

Abra o [visualizador local](http://127.0.0.1:5190/docs/design/three-skills-comparison/) para comparar as cenas salvas, sem iniciar novas inferências. O [registro JSON completo](design/three-skills-comparison/comparison.json) guarda condições, prompts de sistema, consumo retornado e respostas; a [captura comparativa](design/three-skills-comparison/comparison.jpg) registra sua apresentação.

A busca pelo valor exato da chave OpenRouter em 30 arquivos textuais do build e da comparação não encontrou correspondências.

Ambos são reconhecíveis na inspeção visual. A resposta anterior possui mais detalhes, incluindo face do conector USB e bases dos pinos; a resposta guiada é mais compacta. Um único par, sem seed fixada, repetição, rubrica ou avaliação cega, não permite declarar superioridade do guia. A intervenção reúne princípios das skills e receitas próprias do projeto. Os tempos e contagens descrevem somente estas chamadas; não comprovam precisão física nem uma metodologia de ensino.

## Arraste de imagens

O objeto inteiro passou a ser o alvo de movimento no canvas. A seleção exibe contorno, alvos de redimensionamento e uma barra de ações que mantém seu tamanho na tela ao mudar o zoom. Mover uma imagem preserva o layout das partes e sua seleção; a posição é gravada ao soltar. Os alvos de resize ficam acima da superfície de movimento.

Na busca, somente a miniatura inicia o arraste. A prévia nativa contém apenas os pixels já carregados da imagem, com até 160 px, e os botões continuam independentes. O ponto do `pointerdown` é preservado no payload e convertido para a posição do objeto, considerando o zoom, a proporção e as margens de `object-fit: contain`. Inserir uma imagem não provoca novo enquadramento do mapa. O indicador “Solte para adicionar ao plano” é limpo ao sair, cancelar, soltar ou trocar de projeto.

| Verificação | Resultado |
|---|---|
| `npm test` | 507 testes passaram; 8 testes live ignorados |
| `npm run test:gateway` | 14 testes passaram |
| `npm run build` | TypeScript e Vite concluídos; 533 módulos; código de saída 0 |
| Arraste pelo corpo no navegador | Moveu somente a imagem; seleção e barra de ações continuaram disponíveis ao soltar |
| Prioridade dos alvos de resize | Os oito centros de handles/linhas retornaram o próprio controle no hit test DOM |
| Galeria → canvas | Duas transferências nativas de imagens públicas concluídas no plano de demonstração |
| Precisão na versão final | ESP32.jpg segurada em (370, 814), solta em (1000, 460): o ponto correspondente da imagem inserida coincidiu com a soltura, dentro da precisão de arredondamento do DOM |
| Câmera na soltura final | Mesma transformação antes/depois: translate(276.166 px, 500.268 px), zoom 0.452333 |
| Limpeza após a soltura | Zero indicadores, previews temporárias ou cartões com estado de arraste restantes |
| Console capturado | Nenhum aviso ou erro |

As regressões cobrem âncora inicial diferente do `dragstart`, zoom, margens, projeto conflitante, editor/pop-up, arquivos incompatíveis, cancelamento, drops repetidos e atualizações durante movimento/resize. A checagem manual foi feita em desktop com mouse, na grade; arraste por toque e pelo deck não foram exercitados manualmente nesta rodada. Nenhuma inferência paga foi executada para esse ajuste.

Captura: [galeria e objeto selecionado](design/screenshots/2026-10-09-image-drag.png).

## Matriz de referências e guia de modelagem

O [laboratório ampliado](http://127.0.0.1:5190/docs/design/three-skills-comparison/matrix/) concluiu 32 chamadas reais: dois objetos × quatro contextos de referência × duas condições de guia × duas repetições. São 32 cenas válidas, sem reparo ou repetição de inferência; custo reportado de US$1,3180004 e nenhum custo desconhecido. O [protocolo, resultados e observações](design/three-skills-comparison/matrix/README.md) preservam as limitações e o registro de uma pré-execução bloqueada localmente, que não chegou ao provedor.

O teste de imagem envia pixels reais auditados por SHA-256. O fluxo da aplicação continua usando metadados textuais: a capacidade multimodal pertence ao CLI deste laboratório. A intervenção é o guia adaptado com receitas próprias; ESP32 recebe receita específica e MG90S recebe guia geral pelo seletor atual.

Na conferência, os 16 pares renderizaram e os 32 downloads corresponderam às execuções. Rotação sincronizada, troca de contexto e repetição, referências exibidas e viewport móvel de 390 px foram verificados; console sem erros. Os 32 arquivos individuais correspondem ao manifesto. `npm test` passou com 517 testes e oito live ignorados; gateway com 14; build com 533 módulos; checagem TypeScript dedicada com zero diagnósticos. A busca por valores secretos em 91 arquivos textuais retornou zero correspondências.

As especificações mantiveram a contagem de 19 contatos por fileira nos oito ESP32 que as receberam. A condição de imagem apresentou diferenças de contagem e representação entre as duas repetições. Todos os quatro MG90S sem referências têm braço acessório; os 12 que receberam imagem ou especificações não o têm. Esses achados são descritivos desta amostra; não demonstram superioridade geral do guia, aprendizagem ou validação física.

## Limites confirmados da entrega

A entrega inicial e a integração de chat foram verificadas sem inferência paga. A primeira rodada de modelagem executou **duas chamadas LLM reais**; a matriz posterior executou **mais 32**, com registros separados. A execução real do TypeSafe foi acrescentada na rodada de busca contextual descrita ao final deste documento.

O modelo 3D consiste em caixas, esferas, cilindros, cones e toros declarativos. Não é CAD de precisão, medição de componentes nem prova de funcionamento físico. No aplicativo, fotos são referências textuais; somente o laboratório descrito acima enviou seus pixels. A avaliação TypeSafe considera metadados e relevância textual, sem certificar dimensões, montagem ou correspondência visual.

O gateway de busca, mídia e avaliação funciona no **Vite em desenvolvimento local**, iniciado com `npm run dev`. Os templates atuais de deploy estático e `npm run preview` não oferecem esses endpoints. Não foi feito commit, push ou deploy desta entrega.

A portabilidade entregue é **JSON com os originais em base64**, até 40 MiB de originais por pacote; não há pacote ZIP nesta entrega. Inspector avançado, animador e demais extensões do roteiro maior permanecem fora deste recorte. Os demais limites operacionais estão descritos em [mídia e portabilidade](design/visual-media-portability.md).

## Vínculos opcionais e movimento independente — 2026-10-09

Imagens e modelos têm `linkedNodeId` opcional, independente de suas coordenadas absolutas. Novas imagens capturam o node selecionado antes de buscar/decodificar mídia; modelos usam a seleção ao aplicar. Sem seleção válida, o objeto fica livre. Objetos antigos continuam livres até o usuário escolher um vínculo. O seletor na barra do objeto conecta, troca ou remove essa associação, sem movimentá-lo.

A linha tracejada é uma referência visual derivada, sem criar dependência no plano. Seus extremos acompanham os limites reais dos dois objetos; ela fica oculta quando a lente esconde o conceito. Apagar uma parte ou subárvore libera as imagens vinculadas, preservando mídia e posição. Importação e hidratação também liberam vínculos com conceitos ausentes.

O arraste conjunto tinha origem na seleção controlada: salvar uma imagem restaurava a seleção do conceito enquanto mantinha a imagem selecionada. Agora a seleção no canvas é exclusiva, mantendo separado o contexto do plano. Arrastar outro conceito atualiza esse contexto e cancela centralizações de câmera durante o movimento, inclusive no teste de estado móvel.

| Verificação final | Resultado |
|---|---|
| `npm test` | 531 testes passaram; 8 live ignorados |
| `npm run test:gateway` | 14 testes passaram |
| `npm run build` | TypeScript e Vite concluídos; 534 módulos |
| Mouse: mover conceito vinculado | A imagem manteve `translate(814.716px, -1006.22px)`; somente o conceito e o extremo da linha mudaram |
| Mouse: mover imagem vinculada | O conceito manteve `translate(941.396px, -551.738px)`; somente a imagem e o extremo da linha mudaram |
| Desvincular | Zero linhas de referência; posição da imagem preservada |
| Reconectar e recarregar | Uma linha restaurada; imagem em `translate(983.67px, -947.741px)` |
| Import/export e conceito removido | Testes de roundtrip, hidratação e exclusão preservaram imagens/coordenadas |

Captura: [imagem selecionada e vínculo opcional](design/screenshots/2026-10-09-optional-visual-links.png). A checagem manual usou mouse no desktop; o comportamento de câmera móvel foi coberto por teste automatizado, sem ensaio manual por toque.

O aviso local de chave ausente foi diagnosticado separadamente: o processo na porta 5190 estava em `--mode test`, que desativa o auto-seed do OpenRouter. Reiniciado em development, a interface reconheceu OpenRouter e o Estúdio 3D abriu sem o aviso. TypeSafe já era reconhecida pelo gateway (`textualReview: true`). A presença das duas chaves foi verificada sem imprimir seus valores; a busca nos 24 arquivos do build não encontrou nenhum deles. Não houve inferência nem avaliação paga nesta rodada. README e `.env.example` documentam os modos corretamente.

## Busca contextual e seleção TypeSafe — 2026-10-09

A busca resolve o objeto antes da recuperação na web. O pedido explícito tem prioridade, seguido dos corpos das referências selecionadas com `@`; o contexto geral do projeto vem depois. O contexto mantém JSON válido e reserva espaço para as fontes selecionadas antes de truncar o projeto. Modelos conhecidos entram em filtros obrigatórios por objeto: os aliases de um objeto são alternativas, seus identificadores são cumulativos e diferentes objetos são alternativas entre si. O fluxo rejeita uma intenção não resolvida e não inventa tamanho NEMA, marca ou dimensões.

O gateway examina até seis páginas em paralelo, classifica a evidência própria das imagens antes de limitar a galeria e usa Commons quando não há resultado relevante. Legenda, nome de produto e arquivo fornecem a evidência; o título geral da página não transforma um logotipo em foto do componente. Elementos de navegação, banners, thumbnails de vídeo e menções secundárias ao componente são excluídos quando não solicitados.

Com chave configurada, o TypeSafe avalia até 12 candidatos em uma única chamada, usando perguntas nomeadas e metadados textuais limitados. A galeria ordena por pontuação e remove somente irrelevância com confiança suficiente; candidatos incertos permanecem. Avaliações ficam no registro local da sessão e não são cobradas novamente pelo botão de avaliação. Falha ou limite do serviço mantém a seleção por metadados e mostra a indisponibilidade. A chave permanece no servidor local. Contrato consultado: [documentação oficial](https://docs.typesafe.ai/introduction) e [OpenAPI](https://api.typesafe.ai/openapi.json).

Na execução real, o pedido **“traga-me os motores apontados daqui”**, com `@Motores, transmissões e estrutura`, foi interpretado como **motores de passo** e gerou a consulta **`stepper motors`**, mesmo com outro conceito selecionado no canvas. O aviso informou que modelos/variantes não foram especificados. Foram feitas duas rodadas com avaliação real do TypeSafe, uma chamada em lote por rodada. Em ambas, o serviço respondeu para oito referências e a interface mostrou **“Ordenado com TypeSafe · relevância textual”**, com pontuações e confiança em cada card. Um falso positivo de placa HAT na primeira rodada motivou a regressão adicional de acessórios; na repetição final, a galeria trouxe fotos e ilustrações técnicas de motores, sem essa controladora. Uma prévia externa indisponível permaneceu com ações de aplicação desativadas.

Captura final: [consulta contextual e resultados ordenados](design/screenshots/2026-10-09-contextual-image-search-typesafe.png).

Verificações automatizadas: **131 testes** em `src/visuals` e `src/ai/visualTools.test.ts`; **52 testes** do gateway; build TypeScript/Vite concluído com **538 módulos**. Testes controlados cobrem contexto, identificadores, cancelamento, limite de tamanho, filtragem, uma avaliação em lote por busca, reutilização e falha do TypeSafe. A execução real comprova integração e relevância nesta amostra; não mede acurácia geral. A avaliação é textual, sem análise de pixels ou comprovação de compatibilidade física.

## Canvas maximizado — 2026-10-09

O botão junto aos controles do grafo dedica a área da aplicação ao canvas, ocultando navegação, cabeçalho, status, inspector e chat. A restauração usa o mesmo botão ou Escape; modais têm prioridade e um pop-up visual aberto fecha antes da restauração, inclusive quando o foco está fora dele. O estado é temporário e sai ao mudar projeto, superfície ou modo de visualização. Levar referências ao chat também restaura a interface. O canvas permanece no mesmo lugar na árvore React, sem criar um contexto de empilhamento sobre os modais. O layout automático pode reenquadrar pelo tamanho disponível; no Manual, posições são preservadas.

No navegador desktop, o canvas passou de **1130,4 × 574,4 px** para **1280 × 720 px**, com origem **(0, 0)** e seleção preservada. Um rascunho de chat com uma referência selecionada retornou intacto depois de maximizar, fechar o pop-up de imagens com Escape e restaurar com um segundo Escape. A sidebar retornou recolhida, como antes. O rascunho temporário foi limpo sem envio de mensagem ou chamada de IA.

Três regressões cobrem identidade do canvas, posições manuais e seleção, prioridade de diálogos/eventos já tratados e fechamento de pop-up a partir do canvas. A suíte final passou com **560 testes**, oito live ignorados; build TypeScript/Vite concluído com **538 módulos**. Conferência manual feita em desktop; o modo mobile não foi exercitado nesta rodada.

Captura: [canvas ocupando toda a área](design/screenshots/2026-10-09-canvas-maximized.png).

## Conexões visuais curvas — 2026-10-09

As referências entre objetos visuais e conceitos usam uma curva quadrática discreta, com curvatura proporcional à distância e limitada a 72 px do canvas. Os extremos acompanham as bordas dos objetos, sem depender do lado fixo dos handles. O tracejado tem pontas arredondadas, espessura de 1,25 px e opacidade de 55%. Sobreposições ocultam a linha; quando falta espaço para curvar sem entrar nos cards, a conexão fica reta. As arestas do plano mantêm seu estilo.

No navegador, mover o modelo vinculado atualizou a curva sem mover seu conceito. O modelo foi devolvido à posição original, e o vínculo foi preservado. **141 testes** do canvas e módulo visual passaram; build TypeScript/Vite concluído com **538 módulos**. Revisão independente da geometria não identificou bloqueios.

Captura: [curva suave entre objeto e conceito](design/screenshots/2026-10-09-curved-visual-links.png).

## Refinamento do pedido 3D e rotação no canvas — 2026-10-09

O popup **Gerar 3D** oferece o fluxo opcional **Refinar pedido com IA**. A pessoa escolhe **Objeto existente** ou **Conceito próprio**, mantém o pedido, as referências selecionadas com `@` e os anexos, e solicita uma interpretação antes de gerar. A interface apresenta o objeto entendido, a base de referência, as dúvidas essenciais, as premissas e um pedido refinado editável. Imagens já selecionadas aparecem em uma prévia local para conferência humana; a busca de outra referência continua sendo uma ação explícita e aproveita o mesmo contexto.

Respostas e ajustes podem alimentar novas rodadas. Edições humanas no pedido refinado seguem para a rodada seguinte, e uma interpretação desatualizada não substitui o contexto atual em uma busca. A confirmação do objeto e das referências habilita **Usar pedido refinado**, que atualiza somente o texto do rascunho, preservando referências e anexos. Esse aceite não gera nem aplica um modelo: a geração continua separada, pelo botão **Gerar**, e a inserção respeita o modo de aprovação ou automático já escolhido.

O refinamento usa o modelo principal selecionado pelo usuário, com saída estruturada e limites próprios. Perguntas podem ficar vazias quando a intenção está clara; não devem pedir detalhes decorativos, propor componentes sem origem ou insistir em medidas quando a pessoa escolheu uma ilustração aproximada. Fontes selecionadas e anexos são dados de referência, sem permitir que comandos embutidos substituam a tarefa. Assinatura do pedido, fingerprint do contexto, escopo do projeto e cancelamento impedem aceitar respostas obsoletas, inclusive após alterações transitórias de fontes ou troca de projeto. Referências removidas e mídia ausente são rejeitadas antes da chamada.

Foram realizadas **duas chamadas reais preliminares de refinamento**, incluindo uma rodada com feedback incorporado. Nenhuma delas gerou ou aplicou geometria. A inspeção dessas respostas motivou o uso do modelo principal e instruções mais restritas contra perguntas de preenchimento.

A chamada real final ao modelo principal `openai/gpt-6.1-sol` foi concluída com sucesso. O pedido explícito de um **NEMA 17 ilustrativo**, acompanhado de `@Motores, transmissões e estrutura`, produziu sujeito, interpretação e fonte corretos. O pedido refinado alinhou corpo, flange, eixo, tampa, parafusos e acoplamento coaxial, sem inventar variante ou medidas. A lista de perguntas retornou vazia, pois a intenção já estava clara. Essa terceira chamada também não gerou cena nem modelo; ela comprova o funcionamento do refinamento nesta amostra, sem medir fidelidade geométrica geral.

Nos modelos do canvas, **Girar 3D** alterna o arraste entre mover o objeto e girar sua vista. A verificação no navegador confirmou mudança de yaw e pitch sem alterar a posição do artefato nem a câmera do plano. **Restaurar vista** recuperou a orientação inicial, e Escape retornou ao modo de movimento. Essa rotação é de inspeção visual: não representa articulação funcional, simulação cinemática ou uma montagem fisicamente validada.

| Verificação final | Resultado |
|---|---|
| `npm test` | 591 testes passaram; 8 live ignorados |
| `npm run build` | TypeScript e Vite concluídos; 541 módulos |
| Refinamento e aceite | Pedido original preservado até o aceite; referências e anexos mantidos; geração separada |
| Iteração e obsolescência | Feedback e edição humana preservados; cancelamento, fonte alterada e troca de projeto cobertos |
| Refinamento real final | Modelo principal interpretou NEMA 17 e a fonte selecionada; nenhuma pergunta desnecessária e nenhuma geração de cena |
| Rotação no navegador | Yaw/pitch alterados; posição do objeto e câmera preservadas; restauração e Escape funcionaram |

O aplicativo continua enviando **metadados textuais e texto extraído**, sem analisar pixels das fotos. A prévia permite à pessoa confirmar a referência, mas não comprova correspondência visual pela IA, dimensões, compatibilidade de montagem ou fidelidade CAD. A conferência manual de rotação desta rodada usou navegador desktop; interação por toque não foi exercitada manualmente.

Capturas: [refinamento do pedido 3D](design/screenshots/2026-10-09-model-prompt-refinement.png) e [rotação do modelo no canvas](design/screenshots/2026-10-09-canvas-model-rotation.png).

## Busca de vários componentes no mesmo nó — 2026-10-09

O caso **`@Arduino Uno e cabo USB`**, sem texto adicional, foi reproduzido: a consulta combinada `Arduino Uno USB cable` favorecia cabos, e o nome da placa na compatibilidade do acessório podia contar como evidência da própria placa. Agora a intenção mantém um alvo por componente e uma consulta de recuperação independente por alvo. Um pedido explícito por apenas um componente continua tendo prioridade sobre os demais componentes do nó.

As consultas são exibidas separadamente em **Ver consulta de busca**. A recuperação aceita até oito alvos, executa no máximo três consultas simultâneas e intercala suas fontes dentro do orçamento compartilhado de seis páginas. Uma falha parcial não elimina fontes dos outros objetos; cancelamento e mudança de contexto continuam impedindo publicar resultados obsoletos.

A seleção identifica o objeto representado pelo texto próprio da imagem: um cabo compatível com Arduino não conta como placa Arduino. Referências dos diferentes alvos recebem espaço antes do limite de 12 candidatos e depois da ordenação TypeSafe. Commons complementa especificamente os alvos ausentes, mesmo quando os outros já têm resultados. Uma avaliação TypeSafe continua sendo feita em um único lote; referências rejeitadas pelo serviço não são restauradas para preencher um grupo.

Consultas de recuperação e nomes usados na correspondência têm funções distintas. Uma legenda `USB cable` pode corresponder ao alvo `USB data cable` sem confirmar sua capacidade de dados. A ausência desse qualificador funcional não elimina a referência; contradições explícitas como `charging only` ou `sem dados` são excluídas quando dados foram pedidos. Essa flexibilização é restrita a essa expressão de cabos USB: conectores, medidas e identificadores solicitados continuam exigidos. A consulta opcional de cada alvo é validada e preservada pelo gateway para manter o requisito funcional mesmo com aliases nominais.

Foram realizadas **cinco rodadas reais de busca nesta correção**, incluindo a reprodução inicial e as verificações intermediárias. Elas evidenciaram também a exclusão indevida de cabos por aliases qualificados. Na repetição final, com o mesmo nó e campo vazio, as consultas foram **`Arduino Uno board`** e **`USB data cable`**. A interface exibiu **nove referências**, com placa, cabo e outra vista da placa na primeira linha; TypeSafe ordenou os resultados e descartou uma referência. Nenhuma imagem foi adicionada ao canvas durante esses testes. O cabo já presente no plano foi preservado.

Verificações finais: **598 testes da aplicação passaram, oito live foram ignorados; 70 testes do gateway passaram; build TypeScript/Vite concluído com 541 módulos**. As regressões cobrem consultas independentes, fontes intercaladas, falha parcial, concorrência, contexto alterado, associação correta de acessórios, cobertura antes/depois do TypeSafe, complemento Commons e requisitos de cabos. Revisão independente do frontend não encontrou bloqueios.

Captura: [busca de placa e cabo na mesma galeria](design/screenshots/2026-10-09-multi-object-image-search.png). A verificação manual foi feita no navegador desktop. O resultado comprova a correção neste caso e a integração textual com TypeSafe; não comprova compatibilidade elétrica, conector adequado para uma revisão específica da placa ou análise dos pixels.

## Controles compactos e limites da imagem — 2026-10-09

A barra selecionada ocupa uma única faixa curta. Abaixo de zoom 0,7, mostra apenas ícones; o nome continua acessível pelo grupo e pelas ações. O vínculo é indicado pela corrente e seu título, e o seletor só aparece ao clicar. Escape, seleção e remoção de vínculo fecham esse painel e devolvem foco à corrente. As ações continuam disponíveis para imagens e modelos; mover e redimensionar ocultam a barra durante o gesto.

Novas imagens usam as dimensões realmente decodificadas e conservam sua proporção dentro do limite inicial de 280 × 220 unidades. Dimensões informadas pela pesquisa não substituem as do arquivo ao posicionar a âncora do arraste. Imagens já inseridas ajustam seu retângulo ao bitmap carregado, preservando a posição e o tamanho visíveis. O ajuste consulta a geometria atual, espera movimento e redimensionamento terminarem e confere projeto, artefato e mídia para ignorar carregamentos obsoletos. A imagem mantém redimensionamento proporcional, com alças em suas bordas e sem uma segunda linha afastada. Isso elimina espaço criado pelo layout, sem recortar margens ou remover fundos gravados nos pixels do arquivo.

No navegador, a imagem quadrada de 416 × 416 pixels estava dentro de uma caixa de **47,94 × 37,67 px**. Após o ajuste, caixa e imagem coincidiram em **37,67 × 37,67 px**, mantendo a posição do bitmap. No mesmo zoom, a barra passou de **315,33 × 66 px** para **109,33 × 29,33 px**. Ampliar pela alça produziu caixa e imagem coincidentes em **77,48 × 77,48 px**, com o canto superior esquerdo preservado. O retorno por mouse ficou a menos de 1 px do tamanho inicial, por arredondamento do gesto. Abrir o vínculo e fechá-lo com Escape preservou a associação e restaurou o foco. Nenhum erro foi capturado no console, e nenhuma chamada de IA foi necessária.

Verificação final: **610 testes passaram, oito live foram ignorados; build TypeScript/Vite concluído com 541 módulos**. Os testes incluem proporções diferentes, dimensões incorretas na referência, âncora de soltura, contexto/cancelamento, carregamento tardio, normalização após movimento/redimensionamento e controles de vínculo. Revisão independente não encontrou bloqueios. A conferência manual foi em desktop com mouse; toque permanece coberto por controles existentes, sem ensaio manual nesta rodada.

Captura: [imagem selecionada com barra compacta](design/screenshots/2026-10-09-compact-image-controls.png).

## Geração 3D com referência de imagem e texto vazio — 2026-10-09

O pedido do usuário tinha dois chips (cabo USB e Arduino Uno R3), mas somente a placa permanecia no canvas. A menção antiga do cabo era rejeitada como `visualSourceMissing`, traduzida incorretamente para “O contexto selecionado mudou”, antes de chamar a IA. Texto vazio com referência válida já era permitido.

Remover um objeto agora remove suas menções de imagem dos rascunhos de busca e modelo, preservando texto, anexos, outras referências e o histórico de propostas. Ao carregar um rascunho antigo, o estúdio recupera as imagens disponíveis e informa quais saíram do pedido. Essa recuperação usa todos os objetos, sem o limite da lista de sugestões com `@`. Notas e nós ausentes continuam exigindo revisão explícita, com mensagem específica. Um pedido que fica completamente vazio não dispara geração. As proteções contra troca de projeto e alterações de fontes durante a inferência continuam ativas.

Uma chamada real a `openai/gpt-6.1-sol`, no modo **Revisar antes de aplicar**, gerou a proposta **Modelo ilustrativo de uma placa Arduino Uno R3 com microcontrolador ATmega328P DIP-28**, com **101 objetos**, usando apenas a referência disponível e nenhum texto digitado. A proposta ficou pronta para **Aplicar ao canvas**; não foi aplicada automaticamente. A chamada comprova a geração a partir dos metadados selecionados; os pixels da imagem continuam sem análise pelo modelo. Nenhum erro foi capturado no console.

Verificação: regressões reproduziram o bloqueio antes da correção; **616 testes passaram, oito live foram ignorados; build TypeScript/Vite concluído com 542 módulos**. Revisão independente da recuperação e dos limites de contexto não encontrou bloqueios.

Captura: [proposta gerada com referência de imagem e campo vazio](design/screenshots/2026-10-09-image-only-3d-generation.png).

## Chat, carrossel de referências e análise de pixels — 2026-10-09

O chat pode alterar partes existentes do plano e buscar imagens na mesma solicitação. O agente lê o plano e usa suas identidades reais, prioriza referências explícitas com `@` e preserva os demais nós e conexões. Substituir o plano continua exigindo um pedido explícito. Um teste de integração usa o SDK instalado, transporte controlado e stores reais para executar leitura, alteração de nó e busca no mesmo turno, inclusive com outro projeto inicialmente visível.

Cada busca concluída apresenta seu próprio carrossel na conversa, com miniaturas reais, fonte, navegação por setas, teclado, scroll e deslize. **Escolher** adiciona somente a imagem escolhida e inclui uma referência real no rascunho do chat. **Base 3D** também prepara o estúdio e recolhe o chat, preservando os rascunhos. A busca não insere objetos. A imagem nova é centralizada em uma única inserção; duplicatas, inclusive durante downloads concorrentes, mantêm posição e vínculo. A conexão usa o nó referenciado na busca; sem nó explícito, a imagem fica livre. Histórico de outro projeto ou plano substituído permanece consultável, com inserção bloqueada. Prévias da sessão de busca expiram; imagens já escolhidas persistem localmente.

**Analisar pixels das imagens com IA** é uma opção humana persistida no estúdio, desativada por padrão. Quando ativada, refinamento e geração carregam somente as imagens selecionadas no armazenamento local e enviam seus bytes ao provedor em mensagens multimodais. Os limites são oito imagens, 5 MiB por imagem e 20 MiB totais, deduplicadas por mídia. Assinaturas, MIME e dimensões são validados; cancelamento e alterações de contexto continuam protegidos. Modelo incompatível recebe erro explícito, sem repetir a solicitação como texto. A ferramenta do agente respeita a preferência humana; uma geração textual não a desliga. Resultados completos alimentam a interface, enquanto imagens e seus URLs ficam fora do histórico do modelo, inclusive em falha de persistência.

No navegador desktop, uma solicitação real por imagens da **Arduino Uno R3** retornou duas referências da placa no carrossel, provenientes da SparkFun. A navegação para a segunda imagem, a escolha, a inclusão no canvas e o chip no chat funcionaram. Escolher a mesma imagem novamente preservou o objeto existente. **Base 3D** abriu o estúdio com as referências preservadas. A conferência identificou e motivou a correção do vínculo indevido ao último nó selecionado quando a busca não indicava nó; a imagem do teste foi desvinculada pela interface.

Uma chamada real de refinamento a `openai/gpt-6.1-sol`, com a opção de pixels ativada e duas imagens, distinguiu a vista superior da oblíqua e orientou os detalhes visíveis da placa. Após aceitar o pedido refinado, outra chamada real gerou **Arduino Uno R3 com ATmega328P DIP-28 — representação estática ilustrativa, de proporções aproximadas**, com **118 objetos**. A proposta ficou pronta para **Aplicar ao canvas**, sem aplicação automática. Não houve erros capturados no console. Essas chamadas demonstram o fluxo multimodal nesta amostra, sem avaliar fidelidade geométrica geral ou validar medidas e montagem física.

| Verificação final | Resultado |
|---|---|
| `npm test` | 674 testes passaram; oito live ignorados |
| `npm run test:gateway` | 70 testes passaram |
| `npm run build` | TypeScript/Vite concluídos; 544 módulos |
| SDK/OpenRouter com transporte simulado | Mensagens contêm os bytes de imagem codificados e schema estruturado |
| Navegador desktop | Busca real, carrossel, escolha, referência no chat, Base 3D, refinamento e geração com pixels concluídos |

Capturas: [carrossel integrado ao plano](design/screenshots/2026-10-09-chat-image-carousel.png), [refinamento com pixels](design/screenshots/2026-10-09-image-pixels-refinement.png) e [proposta 3D com análise visual ativada](design/screenshots/2026-10-09-pixels-3d-generation.png). Navegação por toque e rejeição por um provedor sem visão foram cobertas por testes controlados, sem ensaio manual nesta rodada.

## Decomposição documentada no Estúdio 3D — 2026-10-09

A ação contextual **Decompor** em imagens e modelos abre **Componentes** no Estúdio 3D existente. A ficha pertence ao mesmo artefato e conserva sua origem; o TXT é uma exportação derivada, sem duplicar notas ou anexos no canvas. A pesquisa exige identidade de produto real confirmada pelo usuário, consulta a web e lê HTML/texto/PDF recuperado por gateway HTTPS público com limites de tamanho e de fontes. Trechos precisam existir no texto baixado; números de peça, especificações e quantidades sem evidência correspondente são rejeitados ou registrados como lacunas.

No navegador desktop, a pesquisa real de **Arduino UNO R3 DIP A000066, revisão UNO-TH Rev3e** retornou nove componentes documentados. A pesquisa individual de microcontrolador e conector USB ampliou o conjunto para oito fontes; uma fonte não pôde ser lida. A lista foi marcada como incompleta, e os documentos recuperados não comprovaram os detalhes dessa revisão específica. A confirmação do usuário identifica o objeto pretendido; não transforma uma revisão sem evidência em fato.

A geração real dessas duas peças produziu **38 primitivas em dois grupos semânticos**. O aceite mostrou **2 de 9 peças documentadas · vista parcial**. Montado/Explodido foi exercitado nos dois sentidos; a inspeção do microcontrolador atenuou o outro grupo. O TXT baixado com 51.792 bytes incluiu os **103 objetos originais**, os 38 objetos dos componentes, oito URLs, trechos e lacunas, com cada objeto de componente pertencendo a exatamente um dos dois grupos. A cena original permaneceu preservada. A revisão também exigiu que novas propostas não substituam uma vista aprovada antes do aceite, inclusive após falha ou cancelamento.

Duas falhas reais anteriores — formato excessivamente restritivo para o provedor e resposta truncada — motivaram schema de geração simples, saída compacta e orçamento adequado, mantendo validação rigorosa na aplicação. Esses resultados inválidos não substituíram o modelo original.

A decomposição é uma representação didática parcial. Não foram validadas dimensões, posição física precisa, encaixes, redes elétricas, fidelidade CAD, desmontagem de peças soldadas ou cobertura completa da BOM. Interação por toque não foi ensaiada manualmente nesta rodada. O contrato e os limites estão em [Decomposição documentada de objetos reais](design/object-decomposition.md).

Uma nova geração mantém pesquisa e geometria em uma proposta temporária e aplica ambas atomicamente apenas no aceite. Regressões verificam preservação integral após sucesso pendente, cancelamento e falha, além de obsolescência após outra aprovação ou restauração. A reinicialização de visuais válidos foi ajustada para não provocar gravações sem mudanças; o teste com ficha e montagem comprova zero atualizações de estado e zero gravações em inicializações repetidas. A edição simultânea entre abas continua sem mecanismo geral de sincronização.

| Verificação final | Resultado |
|---|---|
| `npm test` | 755 testes passaram; oito live ignorados |
| `npm run test:gateway` | 78 testes passaram |
| `npm run build` | TypeScript/Vite concluídos; 549 módulos |
| Navegador desktop | Pesquisa e geração reais do Arduino, aplicação parcial, montar/explodir, destaque e download TXT |
| TXT exportado | 103 objetos originais, 38 objetos de componentes, dois grupos, oito URLs |

Registro exportado: [TXT da amostra real](design/samples/arduino-decomposition-2026-10-09.txt).

A repetição final com **Arduino UNO R3 DIP A000066** retornou 13 candidatos documentais. Conectores de alimentação e USB foram selecionados e gerados em dois grupos com 12 primitivas; o aceite incorporou sete fontes. Depois de recarregar e reabrir o projeto, a montagem e a ação de restauração continuaram disponíveis.

Foi observado que a classificação textual de peças pela IA pode estar errada mesmo quando o código existe na citação. A UI passa a priorizar o código documentado e apresenta nomes/funções como interpretações; TXT e instruções de geometria mantêm a mesma distinção. Enriquecimento pode revisar essas interpretações apenas no aceite, preservando identidade e evidência de presença. Essa qualificação não é uma verificação automática de classificação ou compatibilidade física.

Evidências finais: [TXT dos conectores](design/samples/arduino-connectors-decomposition-2026-10-09.txt) e [componentes no Estúdio 3D](design/screenshots/2026-10-09-object-decomposition.png). O TXT atualizado conserva 103 objetos originais, 12 objetos de componentes, dois grupos e sete fontes; nomes e funções estão marcados como sugestões da IA.

## Correção: original preservado e decomposição vinculada

Decompor agora cria outro artefato, ligado ao original por uma curva tracejada. A origem mantém cena, posição e revisões. A interface abre o derivado para montar/explodir/inspecionar e permite voltar à origem no mesmo Estúdio. A recuperação converte resultados antigos sem apagar o original; um marcador impede recriar filhos removidos.

No teste real de Arduino UNO R3 DIP A000066, os TXT anterior e posterior conservaram os mesmos **122 objetos originais**, sem qualquer diferença. Os conectores de alimentação e USB Tipo B formaram **dois grupos com 11 objetos**, todos exatamente copiados da origem, incluindo tipo, posição, rotação, escala e cor. A montagem/explosão foi exercitada nos dois sentidos e a navegação origem/derivado permaneceu disponível. A identificação dos grupos ainda é uma interpretação da IA; conservação do modelo não comprova medidas reais.

A pesquisa individual agora inclui os documentos previamente lidos do conjunto. Se não confirmar evidências adicionais, mantém somente as peças com trechos já verificados e declara a lacuna. Novas especificações continuam exigindo citações presentes nos textos recuperados.

Ctrl + arrastar gira temporariamente um modelo sem seleção, toolbar ou handles e sem mover sua posição. Testes de interação verificam ângulo, término/cancelamento do gesto, teclas, foco, clique/double-click residual e restauração do modo anterior. No navegador, Ctrl + clique foi conferido sem seleção; a ferramenta não oferece arraste contínuo com a tecla mantida, portanto essa parte do gesto foi validada pelos testes, sem alegação de ensaio manual completo.

Verificação atual: **793 testes passaram**, oito live ignorados; **TypeScript/Vite concluídos, 550 módulos**. Evidências: [TXT da vista vinculada](design/samples/arduino-linked-decomposition-2026-10-09.txt) e [placa completa e derivado no canvas](design/screenshots/2026-10-09-linked-object-decomposition.png).

## 10/10/2026 — contexto preservado e separação espacial

Na amostra ESP32 exportada pela interface, o original contém 119 formas e a segmentação aplicada contém 90 formas em seis grupos. As outras 29 formas, incluindo PCB e módulo, desapareciam da vista derivada. A pesquisa havia listado seis componentes de um guia funcional; isso não constitui uma lista completa de materiais.

A vista derivada agora inclui as formas não mapeadas como contexto estacionário, sem classificá-las como componentes documentados e sem alterar os artefatos salvos. Isso também atende montagens antigas que ainda têm sua origem disponível. Os afastamentos passam a usar dimensões, rotações e posições relativas, com uma verificação conservadora de sobreposição nos extremos, em vez do índice da peça em um círculo. As guias tracejadas indicam a posição de origem; não representam ligações elétricas ou instruções de desmontagem.

O Estúdio mantém os comandos Montado/Explodido e acrescenta um controle contínuo de distância. A indicação de contexto e a ressalva sobre cobertura incompleta aparecem no mesmo inspetor. O TXT conserva as duas geometrias e passa a explicitar os IDs de contexto e os afastamentos calculados para a inspeção atual. A extração documental recebe uma orientação adicional para priorizar submontagens principais antes de indicadores e acessórios, sempre exigindo trechos da variante correta. Essa alteração de prompt não foi avaliada em uma nova chamada paga nesta rodada.

[Comparação interativa da mesma cena](http://127.0.0.1:5190/docs/design/decomposition-context/): à esquerda, as 90 formas e o afastamento circular salvos; à direita, as 119 formas e o novo layout. A página usa o renderer real da aplicação e não executa novas gerações. A conservação da geometria melhora a leitura e evita perdas, mas não acrescenta fidelidade física às formas simplificadas da origem.

Validação: **859 testes passaram, oito live ignorados**; **build TypeScript/Vite concluído, 565 módulos**. Os testes novos exercitam retenção de contexto, reversibilidade, guias, independência da ordem de seleção e da origem de coordenadas, rotações, controle contínuo sem edição persistente e exportação. A vista existente foi conferida montada, explodida e com destaque de USB no navegador; o comparador permite repetir a inspeção sem modificar o plano.

## 10/10/2026 — construção avançada e geometria nativa

O mesmo Estúdio oferece Padrão/Avançado. Avançado analisa o ramo selecionado com `@`, escolhe referências, tenta ler documentação e planeja de dois a oito módulos com pedidos próprios e um contrato comum. As chamadas individuais compartilham unidades, envelopes e pontos de contato. A proposta só é gravada depois de validar todos os módulos; alterações de contexto, falhas e cancelamento não deixam uma montagem parcial.

O renderer aceita contornos extrudados com furos e chanfro, perfis de revolução, tubos curvos e malhas indexadas. A geometria permanece declarativa e validada, sem execução de JavaScript recebido do modelo. Primitivas antigas continuam válidas. O inspetor existente reúne montagem/explosão, distância, destaque de peça, pedidos individuais, fontes, incertezas e TXT. A pesquisa de componentes reais continua acessível no mesmo painel.

O ensaio real por OpenRouter/GPT-6.1 Sol produziu uma articulação com **69 objetos em três módulos**: microservo MG90S com acessórios (59), suporte em U (7) e elo curto (3). Há **20 extrusões, nove perfis de revolução e três tubos curvos**; as demais 37 formas são caixas/cilindros. A nova amostra foi aplicada sem substituir os quatro artefatos anteriores do projeto. A geração continuou com o estúdio minimizado, e seu indicador avançou de módulo 1/3 para 2/3 e depois Pronto. Montado/Explodido e destaque do suporte foram exercitados na interface.

O TXT exportado foi conferido com o renderer real: cobertura exata dos 69 objetos, caixas delimitadoras dos três módulos separadas no extremo explodido, retorno às mesmas posições e nenhuma alteração da cena de origem. Um teste adicional exercita exportação/importação portátil de geometria customizada e contrato modular. A página da amostra mantém os objetos e pedidos exportados sem retoques e oferece rotação sincronizada, reunião, separação contínua e destaque; não dispara inferência.

**Limites observados:** a leitura das fontes do MG90S falhou; o registro contém zero documentos legíveis e explicita dimensões, variante, furações e encaixes aproximados. A primeira geração completa válida demonstra capacidade geométrica e funcionamento do fluxo, não fidelidade de produto, montagem física ou vantagem sobre a condição sem skill. Duas rejeições anteriores do provedor (`oneOf` e campo nullable fora de `required`) levaram a uma gramática compatível, coberta por regressões. Houve também reinicializações do ambiente de desenvolvimento durante edições; essas execuções não produziram uma amostra concluída.

| Verificação | Resultado |
|---|---|
| Suíte frontend completa | 892 passaram; oito externos ignorados |
| Build TypeScript/Vite | Concluído; 571 módulos |
| Geometria | 16 testes: furos, normais, topologia, limites, custo combinado e buffers |
| Geração avançada | 12 testes: seleção, referências, contrato, aplicação, persistência, portable, TXT, cópias, cancelamento e frescor |
| Matriz anterior | 32 prompts/schema `/1` preservados; preparação sem inferência |
| Amostra real exportada | 69 objetos, três módulos, explosão sem sobreposição nos extremos e reversível |

Evidências: [amostra real interativa](http://127.0.0.1:5190/docs/design/mg90s-advanced/), [TXT completo](design/samples/mg90s-advanced-2026-10-10.txt), [montado/explodido](design/screenshots/2026-10-10-mg90s-advanced.png), [progresso minimizado](design/screenshots/2026-10-10-advanced-background.png) e [ensaios técnicos](http://127.0.0.1:5190/docs/design/geometry-tests/). [Contrato e limites](design/advanced-model-generation.md).

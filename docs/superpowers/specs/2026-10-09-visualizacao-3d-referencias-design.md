# Proposta de visualização 3D e referências no plano

## Propósito e estado

Especificação alinhada com o usuário; planejamento autorizado em 09/10/2026. A entrega dos dois pop-ups foi autorizada pelo pedido “vamos adicionar 2 pop ups no canva”; o contrato de execução e os resultados estão em visual-execution-contract.md e visual-canvas-validation.md. O roteiro mais amplo permanece como referência para extensões posteriores. A extensão permite explorar visualmente uma parte do plano, pesquisar referências na web, inserir imagens diretamente no canvas e construir uma demonstração Three.js vinculada àquela parte. Por definição do usuário, os objetos 3D aparecem diretamente no canvas do plano, com fundo transparente e sem cartão ou painel atrás. As imagens de referência também são objetos do canvas: podem ser copiadas, coladas, movidas e redimensionadas. Apoia o [objetivo do artigo](../../OBJETIVO_DO_ARTIGO.md): explicitar premissas, registrar previsões, confrontar observações físicas e justificar revisões. O aplicativo permanece geral; uma articulação do robô de dois braços será o primeiro exemplo.

O usuário solicitou os modos automático e aprovação e forneceu uma chave TypeSafe na variável local `TYPESAFE`. Uma consulta autenticada a `GET https://api.typesafe.ai/v1/models` retornou `jev-latest` e `jev-preview`. Isso confirma acesso à listagem de modelos; não constitui teste de inferência ou integração concluída no aplicativo. Nenhuma chave é parte desta especificação.

## Capacidades confirmadas do TypeSafe

Jev avalia texto e devolve escolhas, notas e probabilidades. A documentação informa explicitamente que não aceita imagens, áudio ou vídeo. Portanto:

- Busca de imagens pertence a um adaptador de busca separado.
- Compreensão dos pixels pertence a um modelo com visão, quando disponível.
- TypeSafe avalia os títulos, descrições, dados de origem e a relação textual das referências com a parte do plano.
- A interface chama esse resultado de **avaliação textual**, preservando modelo, rubrica e confiança retornados. Não o apresenta como validação visual ou física.

Fontes: [entradas aceitas](https://docs.typesafe.ai/concepts/state), [modelos](https://docs.typesafe.ai/models), [tipos de decisão](https://docs.typesafe.ai/introduction).

## Abordagem recomendada

Começar com cenas declarativas: a IA gera dados estruturados de peças, grupos, rótulos, parâmetros e movimentos; um renderizador da aplicação constrói a cena Three.js. Essa abordagem permite validar e versionar os modelos e limita a complexidade da primeira entrega.

Código Three.js livre gerado pela IA exigiria um ambiente isolado e mecanismos adicionais de diagnóstico. Importação de CAD ou glTF pode aumentar a fidelidade geométrica em uma etapa posterior, com controle de unidades e origem. Essas duas alternativas ficam fora da primeira entrega.

## Experiência no canvas

1. Dois atalhos no canvas abrem pop-ups independentes: **Buscar imagens** e **Gerar 3D**, com motor Three.js. Cada um tem sua barrinha de digitação, referências por `@` e botão de anexo; o chat também pode executar essas ações. Por exemplo, “busque imagens de um ESP32” abre a busca e seus resultados. Não há formulário adicional nem exigência de selecionar uma parte, escolher variante ou gerar 3D para pesquisar. **Explorar visualmente** preenche a entrada apropriada com o contexto da parte. Imagens e modelos inseridos aparecem sobre o próprio canvas, com vínculo opcional ao plano.
2. A IA pesquisa na web usando o pedido e o contexto do plano. O adaptador de imagens complementa a pesquisa web existente com candidatos de imagem realmente encontrados, cada um com página de origem e URL da imagem. Prioriza documentação e páginas do fabricante quando pertinentes. Wikimedia Commons pode complementar a pesquisa, mas não limita o acervo. A galeria mostra candidatos concretos, origem, descrição, dimensões da imagem e créditos disponíveis. URLs de imagem não são inventadas pelo modelo; ausência de resultado útil é apresentada como tal.
3. A pessoa pode **arrastar uma miniatura e soltar no canvas**, **Adicionar ao canvas**, **Copiar imagem** ou escolher uma **imagem-base para o modelo 3D**. São ações independentes: inserir uma imagem não exige gerar um modelo, e escolher uma imagem-base não insere a imagem no mapa sem uma ação explícita ou aplicação automática autorizada. Arrastar e soltar é uma aplicação humana explícita, inclusive no modo aprovação. O uso fica explícito: referência de forma, montagem ou desenho técnico. No modo automático, a IA pode escolher e inserir candidatos elegíveis dentro do pedido.
4. A IA propõe uma cena com fundo transparente: apenas as peças e os elementos explicativos solicitados ficam visíveis sobre o canvas. Não há retângulo de fundo, cartão, piso ou cenário padrão. Controles de rotação, aproximação e destaque aparecem ao selecionar o objeto. Cada dimensão indica sua origem: **medida**, **documentada**, **ilustrativa** ou **desconhecida**.
5. Aplicar a proposta cria uma revisão recuperável vinculada à parte. Trocar a referência ou ajustar parâmetros gera outra revisão. Alterações posteriores no plano identificam modelos que precisam de revisão.

Uma camada 3D transparente compartilhada é carregada sob demanda e acompanha a posição, o pan e o zoom do mapa. As áreas vazias deixam o canvas receber os gestos; manipular um objeto selecionado não arrasta o plano ao mesmo tempo. Mover o objeto no mapa e girá-lo em 3D são ações distintas. Ao ocultar os modelos, a animação pausa; ao desmontar a camada, os recursos gráficos são liberados. Uma descrição textual permanece disponível quando a renderização 3D não funcionar.

### Dois pop-ups com entrada simples

A entrada de cada pop-up é uma única barra compacta, com Enter, ação acessível de enviar e botão de anexo. **Buscar imagens** pesquisa e mostra a galeria; **Gerar 3D** recebe uma descrição, prepara a proposta de modelo e permite aplicá-la ou revisar seus parâmetros conforme a política vigente. Ambos são não modais, podem permanecer abertos juntos e guardam rascunhos/referências próprios. O modelo pronto aparece transparente no canvas; o pop-up de geração não se torna um quadro opaco atrás dele. Fechar um pop-up não apaga seu rascunho nem fecha o outro.

O chat usa os mesmos serviços de pesquisa e geração e oferece abrir o pop-up correspondente com seus resultados. Pedidos de busca no chat abrem a galeria quando o canvas está disponível; em outra superfície, os resultados permanecem associados ao projeto e o atalho abre o plano correspondente. Não pedir que a pessoa repita a consulta em outra tela nem adicionar um assistente de configuração. Pesquisa/geração começa após Enter, clique ou pedido no chat, sem chamadas externas a cada tecla. Refinar a consulta usa a mesma barra; uma nova busca cancela/supera a anterior, sem substituir os resultados da consulta atual por uma resposta atrasada. Selecionar **Usar como base 3D** numa imagem abre o pop-up Gerar 3D já com essa referência, sem repetir a busca e sem gerar automaticamente só por abrir.

### Referenciar com @ e anexar arquivos

Digitar `@` na barrinha abre um seletor pesquisável de **notas**, **partes do plano** e **imagens já colocadas no canvas**, inclusive por copiar/colar. Selecionar um item cria uma referência removível, identificada por ID e tipo; nomes iguais não são confundidos. Notas pessoais e do projeto são priorizadas; conteúdo de notas não escolhidas não entra no pedido. A pessoa pode combinar referências e texto livre, por exemplo “exemplifique a montagem usando @nota-do-robô e @foto-do-suporte”. As duas barrinhas compartilham o mesmo seletor; notas/nós referenciados são contexto, sem serem alterados pela geração.

O botão de anexo aceita imagens PNG/JPEG/WebP e, no primeiro suporte, documentos PDF com texto, TXT e Markdown. Anexar não obriga colocar o arquivo no canvas: ele pode ser apenas referência do pedido. A interface mostra arquivo, processamento, conteúdo efetivamente disponível e opção de remover. PDFs reutilizam extração local de texto; PDF sem texto extraível informa essa condição, sem fingir leitura visual/OCR. Não executar arquivos anexados ou incorporar HTML ativo. CAD, glTF e outros formatos fora do suporte são recusados com explicação curta.

Ao enviar, resolver novamente os IDs e congelar um snapshot do conteúdo efetivamente usado: versão da nota/parte, revisão e arquivo da imagem, arquivos anexados e parâmetros. A proposta preserva esse contexto para revisão/exportação. Se uma fonte for editada, excluída ou substituída durante o processamento, a aplicação identifica o resultado como desatualizado; não troca a referência por outra de mesmo nome. Referências ausentes depois de importar podem continuar consultáveis pelo snapshot histórico, mas nova geração exige resolver a fonte atual ou escolher outra.

Imagens referenciadas mantêm os pixels locais e os metadados; isso não significa que TypeSafe examinou seu conteúdo. Sem adaptador de visão confirmado, o modelo usa texto, descrições e parâmetros e informa que os pixels não foram analisados. O envio inclui somente fontes escolhidas e os trechos necessários, com indicação de cortes. Anexos ficam locais até a ação de enviar, que usa o conteúdo suportado pelo provider configurado.

### Galeria de imagens

Os resultados aparecem em um **pop-up não modal sobre o canvas**, com cabeçalho compacto, busca, alternância **Grade / Deck**, contador e fechar. A janela pode ser reposicionada pelo cabeçalho e fica limitada à área visível. Mantém o canvas acessível para receber objetos; não usa bloqueio do fundo nem armadilha de foco. Detalhes de fonte, variante e ações aparecem ao selecionar uma referência, mantendo a imagem como conteúdo principal. Abrir a galeria mostra carregamento; miniaturas carregam de forma independente, com erro e tentativa novamente por imagem. Resultado vazio não é preenchido com exemplos fictícios.

- **Grade, apresentação inicial:** três colunas e três linhas, até nove miniaturas por página. Se houver mais resultados, controles mostram as próximas nove; a última página apresenta somente as imagens existentes. Cada miniatura permite arrastar para o canvas, selecionar para ver detalhes ou inserir pelo botão. A grade mantém três colunas em telas estreitas, com miniaturas menores e controles acessíveis, sem ultrapassar a largura disponível.
- **Deck:** uma imagem central maior e à frente das laterais, que aparecem parcialmente atrás, como cartas sobrepostas. Clicar numa carta lateral ou nas setas muda o foco; deslizar horizontalmente ou usar a roda do mouse sobre o deck também percorre os resultados. O deck tem transição suave, respeitando redução de movimento. A carta central oferece uma alça explícita para arrastar ao canvas e o botão adicionar; deslizar para navegar não insere uma imagem.

Alternar grade/deck preserva a referência ativa por ID, consulta e resultados. O modo de apresentação é independente de automático/aprovação. Navegar, focar uma miniatura ou trocar a apresentação não aplica uma imagem nem seleciona base 3D implicitamente. Teclas de seta/Home/End funcionam quando a galeria está focada, sem capturar editores; Escape cancela primeiro um arraste ativo e, fora dele, fecha a galeria e devolve o foco ao acionador. A roda do mouse atua somente sobre o deck, com limiar e intervalo para evitar várias trocas por inércia; fora da galeria, os gestos continuam pertencendo ao mapa. Ctrl/Meta + roda preserva o zoom do navegador.

Uma solicitação apenas de busca retorna a galeria, mesmo no modo automático. Aplicação automática ocorre quando o pedido inclui inserir/criar o artefato, como enviar uma geração 3D nesse modo; não é um efeito de digitar, mencionar uma fonte, anexar ou percorrer os resultados. Quando o menu @ estiver aberto, suas teclas e Escape têm prioridade sobre navegação/fechamento do pop-up.

O arraste transporta o ID exato da referência e seu escopo, com miniatura acompanhando o ponteiro. A soltura calcula a posição no mapa pelo pan/zoom vigentes naquele instante, sem aplicar DPR às coordenadas. O centro da nova imagem fica no ponto de soltura. Soltar sobre a própria galeria, fora do canvas, em outro projeto ou cancelar não insere. A ordem dos resultados fica estável durante o gesto; busca concluída depois é incorporada somente após seu término. Obter e salvar a imagem precede a confirmação de inserção. No celular, a alça usa gesto de ponteiro e o botão adicionar permanece uma alternativa equivalente.

### Exemplo: visualizar um ESP32

Ao receber “quero visualizar um ESP32”, a IA pesquisa referências na web antes de apresentar o objeto. Usa a variante já informada no plano; se ela não estiver definida, identifica cada resultado como chip, módulo ou placa e registra a variante ou a incerteza, permitindo escolher a referência sem tratar componentes distintos como equivalentes. Pode apresentar fotografias, pinagens e desenhos dimensionais com suas fontes. A pessoa coloca uma ou mais dessas imagens ao lado da parte correspondente, copia e cola outras no canvas ou solicita uma representação 3D baseada na referência escolhida. Medidas do modelo só são apresentadas como reais quando acompanhadas de fonte compatível com a variante; uma fotografia isolada não fornece medidas precisas. A avaliação textual não confirma variante, pinagem ou dimensões.

### Imagens e área de transferência

Uma imagem inserida é um objeto independente com posição, proporção, tamanho, ordem de sobreposição, descrição acessível e vínculo opcional com uma parte do plano. Pode ser selecionada, movida, redimensionada mantendo a proporção, copiada, colada, excluída e recuperada por desfazer. Não recebe cartão ou fundo adicional; contorno e controles aparecem durante a seleção. A transparência do arquivo é preservada; imagens com fundo próprio mantêm o conteúdo original. Remoção de fundo é uma transformação separada, fora desta primeira entrega, e nunca é apresentada como consequência automática de colar. Inserir uma imagem não cria uma parte do plano nem confirma evidência.

Copiar uma referência pela aplicação e colá-la no canvas preserva a fonte, os créditos e o vínculo com a referência. A colagem de uma imagem copiada fora da aplicação também é suportada; se a área de transferência fornecer apenas os pixels, a origem fica como **não informada**, com opção de preenchimento pela pessoa. A aplicação não atribui uma fonte por semelhança visual. A colagem cria um novo objeto na área visível do mapa, com ID próprio, mantendo o conteúdo da imagem. Quando o foco estiver em um editor de texto, a colagem continua pertencendo a esse editor. Falha de cópia por formato, acesso à imagem ou permissão é apresentada sem declarar sucesso. Um botão **Adicionar ao canvas** permite inserir resultados sem depender das permissões de escrita da área de transferência; em dispositivos sem colagem de imagens, há seleção de arquivo equivalente.

## Modos de aplicação

| Modo | Regra |
| --- | --- |
| Aprovação, padrão inicial | A IA pesquisa e prepara propostas. Somente uma ação humana pode selecionar/aplicar a proposta como versão ativa. |
| Automático | A IA pode escolher uma referência elegível e aplicar uma nova revisão dentro da solicitação. A interface mostra origem, alterações e a ação de reverter. Falta de dados ou avaliação insuficiente encaminha a proposta para revisão humana. |

A política é conferida pelo executor da aplicação, não apenas pelo prompt. Mudar o modo não aceita propostas anteriores automaticamente. Limites de busca, geração e recursos gráficos são definidos pelo código.

No automático, inserir uma imagem da web exige candidato retornado pela busca, imagem carregável, origem e descrição presentes; aplicar um modelo exige também cena válida e nenhuma dimensão apresentada como real sem sua fonte. Referências da web usadas automaticamente passam por avaliação textual, com rubrica de relevância de 0 a 3; o ponto inicial proposto é nota pelo menos 2 e confiança retornada pelo menos 0,85. Esse limiar é uma regra operacional provisória a avaliar, não uma taxa de acerto comprovada. Avaliação web ausente, indisponível ou abaixo do limiar mantém a proposta pendente. Modelos baseados somente na descrição e em fontes locais explicitamente escolhidas por @/anexo não exigem pesquisar a web: exigem contexto resolvido, mídia válida quando houver, cena válida e origem das dimensões explícita. A escolha humana de uma fonte local não a promove a dado físico confirmado. A política vigente é conferida novamente imediatamente antes de aplicar, inclusive se a pessoa trocar para aprovação durante a geração. Colar, arrastar ou adicionar explicitamente uma imagem é ação humana e não exige avaliação TypeSafe; isso não confirma a procedência nem a validade física do conteúdo.

Nenhum modo altera previsões escritas pela pessoa, observações, confirmações ou o estado de evidência física. A pessoa pode registrar sua previsão pelo fluxo existente; a IA não a preenche em seu lugar. Comparações calculadas devem preservar a revisão do modelo e os dados apresentados no momento da previsão.

## Contratos e persistência

Os artefatos ficam em um campo opcional do projeto do plano, acompanhando os snapshots e a persistência existentes. O contrato distingue imagem e modelo 3D. Cada artefato registra ID próprio, parte de origem opcional, posição e escala no mapa, ordem de sobreposição, revisões, versão ativa, referências utilizadas e contexto do nó na geração, quando houver.

`SceneV1` contém versão do contrato, unidade explícita, câmera, primitivas e grupos permitidos, transformações, rótulos e animações limitadas. Validação determinística exige IDs únicos, vínculos válidos, números finitos e limites de quantidade e amplitude. Código executável, expressões avaliadas e shaders arbitrários não fazem parte do contrato.

A referência mantém a página original separada da URL da imagem, título, descrição, resolução, data de busca e créditos/licença quando fornecidos. A IA seleciona IDs de candidatos realmente retornados. Imagens coladas, adicionadas ao canvas ou usadas como base de uma revisão 3D são armazenadas localmente como arquivos binários em IndexedDB, em um repositório de mídia separado dos envelopes JSON atuais; os artefatos apontam para IDs de mídia. Cada arquivo registra tipo MIME, dimensões e tamanho em bytes. Copiar um objeto ou usar a mesma referência como base 3D pode reutilizar o mesmo arquivo sem duplicar seus bytes. Arquivos usados por revisões recuperáveis ou por desfazer não são excluídos prematuramente. URLs temporárias `blob:` são recriadas em execução, liberadas quando não utilizadas e nunca persistidas.

A primeira entrega aceita PNG, JPEG e WebP decodificáveis, até 5 MiB e 16 megapixels por arquivo, com limite inicial de 50 MiB de mídia por projeto. Documentos de referência têm até 10 MiB por arquivo; PDFs têm até 100 páginas. Mídia e documentos compartilham o teto de 50 MiB por projeto, contando bytes únicos usados por rascunhos, propostas e revisões. Erro de armazenamento ou limite excedido mantém a proposta sem declarar inserção salva. A exportação completa inclui os arquivos locais, snapshots de contexto e um manifesto em uma evolução versionada do backup, mantendo a importação de backups antigos. A importação valida conteúdo, tamanho e vínculos antes de aplicar. Candidatos não inseridos podem permanecer apenas como metadados e URLs remotas; essa dependência é informada nas exportações. Conteúdo remoto indisponível não impede abrir o restante do plano.

Os schemas são validados na geração, aplicação, importação e recuperação. Projetos antigos continuam abrindo sem artefatos. Resultados atrasados conferem projeto, parte e revisão antes de gravar.

## Acesso à API

O projeto atual é uma SPA estática. A variável `TYPESAFE` não será exposta por `VITE_*`, injeção em JavaScript, IndexedDB ou respostas de configuração.

A proposta acrescenta um pequeno gateway Node que serve a aplicação compilada e oferece um endpoint específico de avaliação textual. Substituir o servidor estático nos comandos de execução e Railway faz parte da entrega. Ele lê `TYPESAFE_API_KEY` ou a variável já fornecida `TYPESAFE`, valida o payload, limita seu tamanho e chama um endpoint TypeSafe fixo. Não faz fetch de URLs arbitrárias. Erros e logs não incluem credenciais. Desenvolvimento e produção usam o mesmo contrato. Em produção pública, o endpoint de avaliação permanece indisponível até haver controle de acesso e limites de uso configurados; a aplicação estática continua acessível. Requisições não autorizadas ou acima dos limites são recusadas antes de chamar TypeSafe. A publicação do serviço e a configuração de acesso de uma instalação pública não fazem parte desta implementação local.

O primeiro adaptador de referências reaproveita a pesquisa web configurada e resolve imagens dos metadados das páginas realmente retornadas; Wikimedia Commons é um complemento. Uma página sem imagem obtível continua sendo fonte de documentação, sem virar um candidato fictício. Quando a imagem não puder ser obtida diretamente pelo navegador, um resolvedor de mídia separado aceita somente IDs de candidatos registrados para o projeto e confere a URL da fonte. Esse resolvedor permite apenas HTTPS público, bloqueia credenciais em URLs e destinos locais ou privados, confere novamente os destinos após resolução DNS e a cada redirecionamento e limita tempo, bytes e tipo de conteúdo. Não executa HTML, scripts ou SVG. Usa os mesmos controles de acesso e limites antes de consumir serviços pagos. Falhas de obtenção permanecem visíveis e não produzem imagem fictícia nem inserção incompleta. O contrato do resolvedor deve constar do plano de implementação; TypeSafe continua restrito à avaliação textual e seu endpoint não é um proxy de imagens.

O LLM generativo continua responsável pelas descrições de cenas. Um adaptador de visão separado poderá produzir descrições a partir de imagens se o modelo configurado aceitar esse tipo de entrada; sem essa capacidade, o modelo usa texto e parâmetros fornecidos e informa que a imagem não foi analisada visualmente.

## Primeiro exemplo e critérios de aceitação

Uma articulação de bancada com servo, suporte, braço e eixo demonstra mudança de ângulo, comprimento e vista explodida. Sem dimensões reais, a escala é ilustrativa. Torque, esforço e comportamento sob carga exigem cálculos e ensaios próprios; a animação não comprova essas propriedades.

- O fluxo completo busca referências, escolhe base, gera proposta, aplica conforme o modo, recarrega e recupera a mesma revisão.
- O modelo 3D aparece diretamente no canvas com transparência real, em todos os temas. Não há fundo opaco, borda permanente ou cartão por trás. Pan e zoom preservam o alinhamento de modelos e imagens com o mapa; posição, escala e ordem de sobreposição sobrevivem ao recarregamento. Gestos nas áreas vazias continuam operando o grafo.
- O pedido de visualizar um ESP32 executa uma pesquisa real na web e apresenta imagens com fontes e variantes identificadas. Inserir uma referência no canvas não depende de gerar 3D.
- A mesma pesquisa pode ser iniciada por uma única barra de digitação ou pelo chat, sem seleção obrigatória de parte ou formulário intermediário. Ambos abrem a mesma galeria com a consulta e os resultados correspondentes; resposta atrasada de busca anterior não os substitui.
- Buscar imagens e Gerar 3D têm pop-ups independentes no canvas, sem perder rascunhos ao alternar. Usar uma imagem como base abre Gerar 3D com a referência já selecionada. `@` nas duas barrinhas encontra notas, partes e fotos coladas por ID; anexo aceita os formatos suportados sem formulário adicional.
- A proposta guarda exatamente as fontes escolhidas e o contexto usado. Nota/parte/imagem alterada durante o processamento torna o resultado desatualizado. Arquivo inválido, PDF sem texto ou modelo sem visão não aparece como conteúdo compreendido. Pacote completo preserva anexos e snapshots históricos.
- A galeria alterna grade 3×3 e deck com carta central em destaque, mantendo referência ativa por ID. O deck responde a clique lateral, setas, swipe e roda do mouse, respeita redução de movimento e não transforma navegação em inserção.
- Arrastar da grade ou da alça do deck para o canvas insere a referência no ponto correto sob pan/zoom. Cancelar ou soltar fora não aplica; o pop-up não bloqueia o destino. O arraste e o botão adicionar funcionam também em aprovação, como ações humanas explícitas.
- Copiar uma referência pela aplicação e colá-la preserva sua origem. Colar pixels externos sem metadados deixa a origem não informada. As duas formas criam objetos móveis e redimensionáveis, preservam a transparência original e respeitam o foco dos editores de texto.
- Imagens inseridas sobrevivem ao recarregamento e ao ciclo de exportação/importação completa, mesmo sem acesso à URL original. Falha de armazenamento ou arquivo inválido não é tratada como inserção concluída. O resolvedor recusa destinos privados e redirecionamentos proibidos.
- O modo aprovação resiste a tentativas da própria IA de aceitar propostas. O automático preserva a revisão anterior e respeita cancelamento. Trocar para aprovação durante uma geração impede aplicação automática tardia.
- TypeSafe recebe apenas texto/metadados, e sua avaliação não altera as provas físicas existentes.
- Cenas inválidas ou excessivas são rejeitadas. Troca de projeto ou edição durante a geração não salva o resultado na parte errada.
- A chave não aparece no bundle, respostas, exportações ou logs. Requisições sem autorização ou acima dos limites não chegam à API paga. Testes de inferência são separados dos testes com respostas simuladas.
- Desktop e celular mantêm contexto, controles acessíveis e recuperação de falha de carregamento de imagem ou renderização.

## Próxima etapa

Revisar o [plano de implementação](../plans/2026-10-09-canvas-visual-ai.md), que cobre busca web de imagens, colagem e persistência de mídia, gateway Node e modelos transparentes no canvas. Após revisão e escolha da execução, implementar a primeira entrega vertical. Esta especificação não altera o objetivo científico aprovado nem registra o módulo como implementado.

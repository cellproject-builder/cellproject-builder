# Referências de imagem, busca multiobjeto e confronto documental

Este documento descreve a implementação inspecionada em 10/10/2026. Busca e inserção de referências, pesquisa multiobjeto, avaliação textual TypeSafe e comparação documental com o projeto possuem código e testes. Isso não confirma disponibilidade atual dos provedores, identidade física de toda foto ou compatibilidade dos produtos. A auditoria não executou buscas, APIs pagas ou novas verificações de navegador.

O [objetivo do artigo](../OBJETIVO_DO_ARTIGO.md) exige premissa, previsão própria, ensaio, observação e revisão justificada. Uma fotografia ajuda a identificar o que precisa ser examinado. Metadados, classificação de relevância e trechos de fabricante são evidências de naturezas diferentes; nenhum deles registra automaticamente o resultado de um ensaio físico.

## Finalidade e estado

O módulo encontra referências reais do objeto solicitado, preserva sua página de origem e permite ao usuário decidir quais inserir ou usar no 3D. O diferencial técnico observável é resolver o referente antes da busca, separar itens de uma lista, registrar candidatos pelo gateway e distinguir relevância textual de comparação documental. Não é demonstração de precisão geral da busca ou recomendação validada de componentes.

| Capacidade | Estado | Limite |
|---|---|---|
| Busca contextual por texto/`@`/anexo | Implementada | Texto selecionado e contexto delimitado podem ser parciais; imagem anexada não é automaticamente analisada |
| Vários objetos por pedido | Implementada, até oito alvos | Cada alvo precisa de consulta própria; lista maior deve ser dividida, sem omissão silenciosa |
| Busca sem configuração LLM | Implementada com fallback literal e Commons | Não resolve semanticamente “daqui/disso”; pede contexto mais claro |
| Extração/registro de referências reais | Implementada no gateway | Páginas/imagens podem estar inacessíveis, mudar ou faltar para algum item |
| TypeSafe | Implementado e opcional por configuração do servidor | Avalia metadados textuais, não pixels ou funcionamento físico |
| Comparação produto–projeto no chat | Implementada | Apoio/conflito/desconhecido por requisito e trecho; não valida compatibilidade física global |
| Inserção, arraste, colagem e cópia | Implementados | Inserir depende de bytes válidos e escolha humana; busca não insere |
| Envio de pixels ao 3D | Implementado com autorização explícita no fluxo do plano | Provedor precisa suportar visão; aparência não oferece medidas exatas |
| Certificação de peça, compra ou controle físico | Fora deste módulo | Resultado de busca não autoriza aquisição nem realiza ensaio |

## Fluxo de uso

1. Abra **Buscar imagens**, escreva o objeto ou selecione uma referência `@` cujo corpo contenha os componentes. Anexe texto/PDF quando necessário. Enter em uma sugestão de `@` seleciona a fonte, sem disparar a busca.
2. Envie o pedido. A ferramenta mostra objeto interpretado, incerteza e consultas efetivamente usadas. Uma lista como placa e cabo deve gerar duas consultas, evitando transformar o pedido inteiro em “cabo para placa”.
3. Examine os resultados na galeria. Pode navegar sem inserir, abrir a fonte, copiar a imagem, adicionar ao plano ou usar como base 3D. Falha de miniatura mantém a página de origem visível, mas bloqueia ações que necessitam dos bytes.
4. No chat, os candidatos aparecem agrupados pelos itens solicitados, incluindo grupos sem imagens. A comparação documental apresenta requisitos, trechos, conflitos e informações ausentes. O clique humano é a etapa de inserção.
5. **Usar como base 3D** insere/reutiliza a referência e inclui seu ID no rascunho do estúdio. O opt-in para pixels no fluxo do plano é separado da seleção de imagem. **Conversar sobre** encaminha a referência ao compositor do chat sem enviar automaticamente.
6. Imagens PNG/JPEG/WebP locais também podem ser coladas ou arrastadas para o canvas. O artefato aceita posição, tamanho e vínculo contextual opcional, com proporção conservada. Cópias e arquivo portátil preservam o que foi salvo localmente.

Busca e estúdio usam [abas independentes](../visual-studio-tabs.md). Respostas fora de ordem permanecem com seu pedido; minimizar não deve cancelar. Troca de projeto/contexto impede que um resultado atrasado insira uma referência em outro escopo.

## Pipeline técnico e responsabilidades

```text
Pedido humano + fontes escolhidas + contexto permitido
  → resolver intenção e lista de alvos
  → consultas independentes para páginas de origem
  → gateway lê metadados e registra candidatos
  → filtros por objeto/identificador e balanceamento
  → TypeSafe textual opcional, sem pixels
  → resultados no estúdio ou chat
  → comparação documental no chat, quando acionada por esse fluxo
  → escolha humana
  → gateway fornece bytes registrados → validação → mídia persistida → artefato
```

| Responsabilidade | Arquivos |
|---|---|
| Referentes, variantes e consultas multiobjeto | [searchIntent.ts](../../src/visuals/searchIntent.ts) |
| Contexto visual escolhido | [domain.ts](../../src/visuals/domain.ts), [searchContext.ts](../../src/visuals/searchContext.ts) |
| Contexto documental do projeto/chat | [projectSearchContext.ts](../../src/visuals/projectSearchContext.ts), [visualTools.ts](../../src/ai/visualTools.ts) |
| Pesquisa de páginas e protocolo do gateway | [search.ts](../../src/visuals/search.ts), [research.ts](../../src/ai/research.ts) |
| Autorização/rotas/limites do gateway | [handler.mjs](../../server/handler.mjs), [access.mjs](../../server/access.mjs), [limits.mjs](../../server/limits.mjs) |
| Registro, metadados e filtros | [referenceRegistry.mjs](../../server/referenceRegistry.mjs), [referenceMetadata.mjs](../../server/referenceMetadata.mjs) |
| Download público delimitado | [publicHttps.mjs](../../server/publicHttps.mjs), [media.mjs](../../server/media.mjs) |
| Relevância textual | [typesafe.mjs](../../server/typesafe.mjs) |
| Confronto documental | [componentFit.ts](../../src/visuals/componentFit.ts), [decompositionResearch.ts](../../src/visuals/decompositionResearch.ts), [specDocuments.mjs](../../server/specDocuments.mjs) |
| Escolha e inserção | [ImageGallery.tsx](../../src/visuals/ui/ImageGallery.tsx), [controller.ts](../../src/visuals/controller.ts), [media.ts](../../src/visuals/media.ts) |
| Canvas, clipboard e visão | [VisualWorkspaceBridge.tsx](../../src/visuals/VisualWorkspaceBridge.tsx), [clipboard.ts](../../src/visuals/clipboard.ts), [artifactClipboard.ts](../../src/visuals/artifactClipboard.ts), [vision.ts](../../src/visuals/vision.ts) |

### Resolver a lista antes de pesquisar

`resolveImageSearchIntent` prioriza objeto/modelo explícito, depois corpos de referências selecionadas, depois contexto geral. O texto digitado é opcional quando há uma referência `@` ou anexo: seus conteúdos textuais orientam os alvos da busca. Com LLM configurado, retorna consulta, rótulo, incerteza e até oito alvos. Cada alvo tem consulta própria, até oito aliases, com 600 caracteres agregados entre os alvos, e identificadores conhecidos limitados a 300 caracteres agregados. O campo legado `targetTerms` recebe até oito nomes, distribuindo um por alvo antes de incluir sinônimos; os grupos conservam os aliases bilíngues, sem descartar componentes por exceder o limite do campo legado. Código/variante não presente no contexto é recusado localmente; não deve surgir como precisão inventada. Grandezas como `5V`, `5A` e `1000uF` continuam descritores da consulta, sem se tornarem códigos obrigatórios de modelo.

`imageSearchQueries` mantém objetos independentes separados. As pesquisas de páginas usam concorrência limitada a três por lote. A seleção de até seis páginas intercala grupos: tenta oferecer uma fonte a cada objeto antes de uma segunda ao mesmo objeto. Falha parcial de pesquisa não apaga as fontes dos outros objetos; o gateway pode complementar itens não cobertos com Commons.

Sem configuração LLM, o fallback remove fórmulas conversacionais do pedido e pesquisa literalmente. Não inventa sinônimos/modelos e recusa referências anafóricas que exigiriam interpretação. Esse fallback não oferece a mesma resolução semântica da lista.

O provedor de pesquisa entrega **páginas de origem**. Não se aceita uma URL de imagem inventada pelo modelo. O gateway lê metadados, filtra/ordena candidatos e associa imagens a índices dos alvos. Identificadores exatos são filtros obrigatórios; um alias genérico não deve aceitar outra variante numérica solicitada.

### Registro e fronteira de download

O frontend estabelece capacidades/autorização em `/api/visuals/capabilities`; criação de sessão usa `/api/visuals/reference-sessions`. Em desenvolvimento, há controle de acesso local; [production.mjs](../../server/production.mjs) injeta autorização de usuário. A presença dessas rotas não demonstra deploy/auth atual funcionando.

`ImageReference` contém ID, título, descrição, página de origem, crédito/licença quando conhecidos, dimensões quando conhecidas, sessão e avaliação opcional. `imageUrl` é uma URL same-origin `/api/visuals/media?sessionId=…&candidateId=…`. O registro liga o candidato à sessão de acesso, projeto e fingerprint; os bytes remotos só são obtidos para candidato registrado, por download público delimitado.

O cliente valida associação entre ID, sessão e URL do gateway, além de origem HTTPS da página sem credenciais. `addReferenceImage` recusa URL arbitrária, usa bytes do gateway, valida tipo/tamanho/decodificação e deduplica referência/URL antes de inserir. Sessões do registro são temporárias; uma imagem adicionada passa a ter bytes locais/cloud e não depende de manter a miniatura remota acessível para a cópia portátil.

### TypeSafe: relevância textual

Quando configurado no servidor, uma busca faz um lote delimitado com uma questão por candidato. O estado inclui pedido, contexto compacto e metadados; `pixelsAnalyzed` é falso. A rubrica 0–3 distingue irrelevante, mesma família, assunto útil sem detalhes e correspondência textual direta da variante solicitada.

O retorno completo preserva `kind: textual`, modelo, versão de rubrica, score, confiança, probabilidades, legenda e instante. O gateway valida formato/distribuição. Só remove candidato quando a confiança é pelo menos 0,6 e a probabilidade somada das classes 0/1 é pelo menos 0,8; mantém os incertos. Ordena os retidos e balanceia os grupos sem restaurar item rejeitado apenas para preencher uma lista.

Falha do TypeSafe conserva os resultados já filtrados e informa `unavailable`, sem repetição oculta. Sem configuração, o estado é `not-configured`. A revisão explícita de uma referência reutiliza avaliação já armazenada, evitando uma chamada duplicada. A chave permanece na configuração do servidor e não integra o payload de referência; esta auditoria não leu credenciais nem confirmou configuração ativa.

Score/confiança não são taxa de acerto medida, exame dos pixels, prova de identidade física, dimensional, elétrica ou mecânica. Essa avaliação não aprova cena 3D ou diagrama. A classificação orientativa de intenção de plano, também presente em `typesafe.mjs`, é outro contrato e não deve ser confundida com relevância de imagens.

### Comparação documental com requisitos do projeto

O fluxo de `visual_action.search_images` no chat reúne contexto próprio em `collectProjectSearchContext`: objetivo/regras, arquivos do projeto, nós com relações, notas do projeto e tarefas. Exclui critérios independentes ocultos e fontes pessoais não relacionadas. Lê no máximo 120 registros com orçamento agregado; `partial` informa limites. O pedido humano atual e referências explicitamente selecionadas podem complementar esse contexto. Texto de busca escrito pelo agente **não vira requisito novo**.

`assessImageProjectFit` tenta ler até seis páginas, priorizando a primeira imagem de cada grupo. A extração documental usa texto realmente obtido, não memória do modelo, aparência da imagem, resumo de busca ou score TypeSafe. O retorno pode conter `supported`, `conflict` ou `unknown` para aspectos como tensão, corrente, protocolo, conectores, dimensões e carga, conforme requisitos disponíveis.

`validateComponentFits` só sustenta uma conclusão quando há identidade/variante da própria referência em trecho da sua página, requisito em trecho de fonte do projeto e especificações nas páginas correspondentes. Comparar duas peças requer identidade de ambas e trechos de ambas, além do requisito. Referências fabricadas, variantes genéricas, requisito ausente ou citação sem correspondência reduzem o resultado a `unknown`. Leitura parcial e falhas de documentos ficam explícitas; não é avaliação de todo o projeto.

Essas conferências locais provam a presença dos trechos citados e consistência dos IDs, não a qualidade da inferência técnica, autenticidade de todo fornecedor ou suficiência do requisito. Um aspecto documentalmente apoiado não estabelece compatibilidade global nem segurança. O estúdio de busca geral não executa automaticamente esse mesmo confronto documental do chat.

## Contexto selecionado e integração com outras superfícies

- **Plano:** menções do compositor têm ID, tipo e fingerprint. As fontes acessíveis são nós atuais, notas pessoais/do projeto proprietário e imagens do plano. Um nó inclui apenas campos deliberadamente serializados, com critério de IA somente quando permitido. O corpo de nota selecionada contém título/blocos; não inclui automaticamente todo seu canvas.
- **Chat:** usa os mesmos serviços, porém retorna candidatos/agrupamentos para o carrossel sem abrir popup ou inserir. [controller.ts](../../src/visuals/controller.ts) valida projeto, plano e revisão de contexto antes da escolha tardia. `toModelOutput` remove URLs/candidatos e entrada volumosa da história enviada ao modelo, mantendo resumo, grupos e verificações relevantes; a UI conserva o payload.
- **3D:** uma imagem escolhida pode virar menção de base. No fluxo do plano, pixels só são lidos com `analyzeImages: true`, de bytes salvos selecionados, com até oito imagens e 20 MiB agregados. Opção desligada usa metadados/texto; indisponibilidade ou rejeição de visão não é mascarada como análise bem-sucedida. Ver [Estúdio 3D](three-studio.md).
- **Diagramas:** reutilizam contexto/mídia do plano quando explicitamente escolhidos, mas produzem dados SVG delimitados. Ver [Diagramas](diagrams.md).
- **Board:** [boards/generation.ts](../../src/boards/generation.ts) reutiliza intenção multiobjeto/gateway, mas resolve contexto do Board e namespace `board:<id>`. Imagem escolhida é importada/reencodificada para o documento do quadro. Não leva implicitamente requisitos do plano; sua geração multimodal usa imagens referenciadas explicitamente no próprio quadro.
- **Notas:** imagens de nota são inline, validadas e reencodificadas por [noteImages.ts](../../src/workspace/noteImages.ts), com limites próprios. Geração de diagrama de nota usa legendas/texto, sem enviar pixels ou pesquisar outros projetos. Esse armazenamento não é o registro de referência do plano.

Referência de imagem é material de contexto, não ação de criar tarefa, confirmar nó ou registrar ensaio. Vínculo opcional ao nó permanece semântico e independente das coordenadas da imagem.

## Persistência, direitos e portabilidade

`Project.visuals` guarda artefato, origem da referência, layout, revisão e rascunhos. [media.ts](../../src/visuals/media.ts) guarda bytes imutáveis em IndexedDB `cellproject-visual-media` ou no runtime cloud ativo. Os limites incluem 10 MiB por arquivo, 5 MiB por imagem e 16 milhões de pixels; documentos PDF/TXT/Markdown são anexos textuais, não fotos arbitrárias. A cota de mídia é 50 MiB por projeto e 500 MiB global, com exportação de até 40 MiB.

[references.ts](../../src/visuals/references.ts) coleta mídias alcançáveis, incluindo revisões/propostas/anexos. [portable.ts](../../src/visuals/portable.ts) exporta um snapshot com bytes e valida conceitos/cenas/mídias antes de substituir o editor. A coleta local de órfãos tem janela de proteção; o cliente não apaga mídia remota a partir de snapshot parcial. O contrato detalhado está em [Mídia e portabilidade](../design/visual-media-portability.md).

Copiar a referência como pixels e depois colar só recupera proveniência quando o protocolo reconhece os bytes e o projeto; não se atribui a qualquer foto colada a fonte da última imagem copiada. [artifactClipboard](../../src/visuals/artifactClipboard.ts) cria cópias independentes de artefatos. Colagem no Board converte a imagem para armazenamento inline, sem sincronizar a referência do plano.

Crédito/licença podem ser desconhecidos. Armazenar esses campos não concede autorização de republicação. Para figuras de artigo, a pessoa precisa verificar direitos da fonte e registrar qual imagem foi usada; esta documentação não atesta licenças de todas as referências retornadas.

## Testes e evidências disponíveis

| Arquivo | O que verifica |
|---|---|
| [searchIntent.test.ts](../../src/visuals/searchIntent.test.ts) | Resolver referências/listas, separar queries, conservar variantes, limites e fallback sem LLM |
| [search.test.ts](../../src/visuals/search.test.ts), [searchContext.test.ts](../../src/visuals/searchContext.test.ts) | Sessão/URL/contexto, cancelamento e compactação |
| [referenceMetadata.test.mjs](../../server/referenceMetadata.test.mjs), [referenceRegistry.test.mjs](../../server/referenceRegistry.test.mjs) | Filtros, identificadores, cobertura de alvos, sessão e candidatos registrados |
| [handler.test.mjs](../../server/handler.test.mjs), [typesafe.test.mjs](../../server/typesafe.test.mjs) | Lote TypeSafe, cache, falha sem retry, remoção de irrelevantes e preservação de grupos retidos |
| [componentFit.test.ts](../../src/visuals/componentFit.test.ts), [componentFitResearch.test.ts](../../src/visuals/componentFitResearch.test.ts) | Trecho de requisito/especificação, identidade e variante, conflito e comparação entre duas peças |
| [projectSearchContext.test.ts](../../src/visuals/projectSearchContext.test.ts), [visualTools.test.ts](../../src/ai/visualTools.test.ts) | Projeto atual, registros parciais, pedido humano versus texto do agente e resultado para carrossel |
| [controller.test.ts](../../src/visuals/controller.test.ts), [VisualWorkspaceBridge.test.tsx](../../src/visuals/VisualWorkspaceBridge.test.tsx) | Escolha tardia, contexto alterado, deduplicação, arraste e inserção |
| [ImageGallery.test.tsx](../../src/visuals/ui/ImageGallery.test.tsx), [VisualExplorer.test.tsx](../../src/visuals/ui/VisualExplorer.test.tsx) | Galeria, fonte indisponível, intenção visível, ações explícitas e uso como base |
| [vision.test.ts](../../src/visuals/vision.test.ts), [clipboard.test.ts](../../src/visuals/clipboard.test.ts), [portable.test.ts](../../src/visuals/portable.test.ts) | Opt-in, limites de bytes, proveniência e pacote offline |

Inferências e downloads são simulados quando necessário. Os testes não medem recall/precisão de buscas atuais, acurácia ou calibração do TypeSafe, compatibilidade real de uma compra ou disponibilidade de fontes na internet. A [validação visual anterior](../visual-canvas-validation.md) e [capturas](../design/screenshots/) preservam buscas e fluxos exercitados em rodadas identificadas. Seus resultados históricos não são novos ensaios desta auditoria.

## Questões de pesquisa e evidências necessárias

| Questão candidata | Como tornar a avaliação examinável |
|---|---|
| Separar alvos reduz omissão/substituição de componentes? | Conjunto de pedidos com listas conhecidas, várias repetições, cobertura por item, precisão da variante, falhas e custo/tempo; incluir grupos vazios |
| TypeSafe melhora pertinência sem apagar referências úteis? | Rótulos humanos independentes, métricas antes/depois, casos incertos/rejeitados e calibração de confiança |
| Trechos documentais ajudam a identificar premissas erradas? | Requisitos definidos antes da busca, julgamentos independentes de suporte/conflito/desconhecido e vínculo da revisão com evidência real |
| Separar imagem, documento e ensaio reduz confiança indevida? | Avaliar afirmações sem suporte e justificativas humanas; comparar com chat comum sob mesmo LLM/tarefas equivalentes |

No caso físico, a busca pode revelar que a tensão, variante ou dimensão ainda não foi especificada. Essa lacuna pode virar premissa explícita e orientar medição/ensaio; a conclusão precisa vir da comparação entre previsão e resultado observado, conforme o objetivo científico. Uma imagem bem escolhida ou um score alto não registra esse resultado.

## Diagnóstico de modularização

1. `search.ts`, `decompositionResearch.ts` e `boards/generation.ts` têm clientes do gateway e tratamentos de erro semelhantes. Um cliente comum poderia centralizar protocolo e validar respostas, mantendo contexto/autorização próprios de cada domínio.
2. `visualTools.ts` combina ferramenta do agente, carrossel, construção do contexto de requisitos, grupos e confronto documental. Separar um serviço de busca contextual para o chat de sua adaptação ao SDK permitiria testar o fluxo sem acoplar payload de UI à chamada de ferramenta.
3. `componentFit.ts` importa leitura documental de `decompositionResearch.ts`; essa responsabilidade é compartilhada por 3D avançado e comparação de produtos. Um contrato documental autônomo faria essa dependência refletir o uso real.
4. O registro efêmero de busca, a mídia persistida do plano e imagens inline de notas/Board são modelos distintos. A documentação e futuras APIs de transferência devem informar quais campos de proveniência sobrevivem a cada conversão, sem prometer sincronização que não existe.

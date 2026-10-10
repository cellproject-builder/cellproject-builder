# Revisão técnica do laboratório de artefatos interativos

Data: 10/10/2026. Escopo: leitura de `model.ts`, `viewer.tsx`, `run.ts`, transportes auxiliares, amostras em `results/` e pontos de integração existentes. Nenhuma chamada paga ou alteração de implementação foi feita por esta revisão. Os dados do laboratório são sintéticos.

## Decisão proporcional ao experimento

Faz sentido continuar o ensaio. A hipótese mais compatível com o domínio atual é um artefato com documento visual validado e renderizador React/SVG; a posição e o vínculo ficam no mesmo domínio de artefatos já usado por imagens e modelos. React gerado continua útil como condição experimental para medir liberdade de desenho e interações que a gramática declarativa ainda não expressa.

Não há evidência suficiente para escolher um vencedor. O ensaio tem uma tarefa visual, uma resposta React válida e uma resposta declarativa válida após falhas de transporte e mudanças no contrato/prompt. A recusa do schema pelo provedor não mede capacidade visual da IA. As condições precisam ser repetidas em mais tarefas com o contrato estabilizado antes de comparar taxa de sucesso, qualidade, tempo ou custo de reparo.

## Achados acionáveis

### P2 — Validar geometria depois dos bindings, antes de generalizar

Referências: `model.ts:7-18`, `model.ts:44-49`, `viewer.tsx:23-26`.

Reprodução offline confirmada: `parseDiagram` aceita um binding `r = mass * -10000` para um círculo e aceita um retângulo sem largura/altura. O primeiro produz raio negativo; o segundo pode ficar invisível. Validar JSON e dependências não garante um desenho renderizável. Na integração, exigir os atributos necessários por tipo, permitir apenas bindings compatíveis com esse tipo e conferir resultados geométricos nos valores padrão e extremos dos controles. Não usar apenas o número calculado como verificação da figura. O SVG está com `overflow:visible`; decidir um limite visual para evitar que geometria inválida invada outros nós.

O exemplo atual de torque não apresentou essas duas entradas inválidas; este achado limita a generalização do contrato, não invalida a amostra preservada.

### P2 — Separar IDs internos de referências ao plano real

Referências: `model.ts:3`, `model.ts:17`, `src/ai/planStructure.ts:53`.

A regex de IDs de parâmetros/formas exige início em letra minúscula e é reutilizada em `nodeId`. O plano usa `nanoid`, que pode conter maiúsculas e começar por número, hífen ou sublinhado. A fixture `servo/test` funciona, mas referências válidas do projeto real seriam recusadas. Manter IDs internos simples; validar referências externas como strings opacas pertencentes exatamente a `project.nodes`, sem normalizar ou trocar sua identidade.

### P2 — O sandbox limita capacidades, sem provar isolamento completo

Referências da versão inicialmente revisada: `viewer.tsx:48-64`, `run.ts:55-65`. O helper `isolation.ts` estava em elaboração; a revisão final do helper deve confirmar as mesmas restrições.

O iframe tem origem opaca, `allow-scripts` sem `allow-same-origin`, política que restringe conexões/subrecursos e mensagens filtradas por origem, janela e IDs. Isso é adequado para um laboratório sem escrita no plano e com contexto sintético. Não permite afirmar que todo acesso à rede foi eliminado: navegação da própria janela não é a mesma operação que `fetch`, e loops/consumo de memória não têm um orçamento interrompível demonstrado. O aviso ao coordenador foi enviado; ajustar a legenda “rede bloqueada” e documentar esses limites. Compilar não executa o código no Node, mas também não comprova a segurança do código no navegador.

Antes de aceitar gerações arbitrárias em produção: limitar imports/resolução do bundler por contrato, avaliar navegação e recursos, validar todo evento contra capacidades explícitas e contexto atual, e ter estratégia de encerramento de uma execução que trava. Não autorizar mutações do plano a partir de um `postMessage` genérico.

### P3 — Nomear o controle conforme a operação real

Referências da versão inicialmente revisada: `viewer.tsx:109`, `viewer.tsx:115`.

O checkbox “Vínculo opcional” somente altera `edge.hidden`; não muda uma associação persistida. No laboratório, “Mostrar vínculo” descreve corretamente o comportamento. Na integração, reutilizar `setVisualArtifactLink` se a operação realmente desvincular, preservando posição e conteúdo do artefato.

### P3 — Fechar a verificação de interação, além da aritmética

Referência: `diagram.test.ts:8-23`.

O teste atual altera massa e verifica torque, mas a asserção geométrica usa o `x1` inicial estático do braço. Adicionar verificação de distância alterando `x2`, centro da carga e seta de força, além de clique/teclado referenciando o nó. Drag e resize do React Flow requerem verificação no navegador; jsdom e schema não comprovam essas interações. No iframe, o clique interno não seleciona o nó pai para redimensionar: selecionar pela alça é um comportamento válido, que deve continuar explícito.

## Como integrar sem criar outro gerenciador de plano

1. Evoluir o envelope persistido de `VisualArtifact` com um payload versionado para diagramas. `src/visuals/types.ts` e `src/visuals/normalize.ts:38-39` aceitam atualmente apenas imagem/modelo: não basta adicionar um renderizador, pois hidratação, exportação, clipboard, revisões e propostas devem preservar o novo payload.
2. Reutilizar `GraphCanvas.tsx:992-999` para posição/seleção/resize e `GraphCanvas.tsx:1163-1178` para associação curva opcional. Não inserir o diagrama como filho transformado do nó; vínculo semântico e movimento são independentes.
3. Reutilizar o ciclo `resolveVisualContext` → proposta → revisão/aplicação/rejeição → comparação de fingerprint. `isCurrentReview` da fixture é um ensaio, não substitui o guard de projeto/owner e o fingerprint dos nós, anexos e referências existentes.
4. Separar estado exploratório dos controles de alterações no plano e observações físicas. Mover a massa de um slider não vira evidência ou critério de aprovação. Uma ação no plano deve passar pelas ações validadas que UI e chat já compartilham.
5. Manter texto longo, instruções e ressalvas sob demanda, e desenhar apenas a relação necessária no canvas. A simulação de torque não deve virar uma segunda árvore integral do projeto.

## Liberdade visual e próximos ensaios

A gramática atual permite paths próprios e desenho livre dentro de seis tipos SVG, mas exige pelo menos um parâmetro e oferece apenas aritmética básica com bindings lineares. Isso é uma prova de conceito de diagrama paramétrico; ainda não cobre mapas conceituais estáticos, séries de dados, layouts de grafos, seleção múltipla, animações ou todo componente React. Expandir por capacidades observadas em tarefas reais: grupos, transformações, marcadores, texto alinhado/quebrado, séries e interações declaradas. Evitar uma lista crescente de templates que force toda ideia a um tipo pronto.

Matriz seguinte recomendada: mapa de relações sem slider; gráfico previsão/observação com dados sintéticos rotulados; diagrama dimensional com referência textual; relações entre módulos de um conjunto. Medir contrato válido, renderização, fidelidade semântica, interação, legibilidade em zoom, preservação de contexto, latência, tokens e reparos necessários. O orçamento de tokens disponível nas amostras é rastreável; três classificações TypeSafe não medem a acurácia do roteamento.

TypeSafe faz sentido para selecionar intenção/capacidade e sinalizar incerteza, apoiado por uma rubrica versionada. Não valida física, veracidade documental ou necessidade de reorganizar o projeto por si só. O DBox pode orientar revisão localizada e ajuda progressiva no motor; a geração de artefatos visuais é uma extensão separada a avaliar.

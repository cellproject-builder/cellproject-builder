# Construção modular avançada · Three.js

O Estúdio 3D mantém o fluxo existente de referências, refinamento, geração e aprovação. A escolha **Padrão / Avançado** define como o modelo é construído. Avançado planeja módulos separadamente e entrega um único artefato montado, com controle de explosão reversível e destaque por módulo no mesmo inspetor de componentes.

## Seleção de contexto e contrato

Ao selecionar um pai com `@`, o índice inclui descendentes, ancestrais, dependências de entrada e metadados de imagens vinculadas. A IA escolhe os elementos relevantes antes de receber seus corpos completos. Ramos independentes não são incorporados automaticamente. O índice é limitado, e referências omitidas são registradas como lacunas.

A seleção permite até duas buscas de documentação e a leitura de até seis fontes pelo gateway existente. Resumos de busca não são especificações. Falhas de pesquisa permanecem visíveis nas incertezas. Pixels de imagens continuam exigindo a opção explícita de análise visual.

O planejamento produz de dois a oito módulos. Cada um recebe nome, pedido próprio, referências, envelope espacial e orçamento de objetos. Todos compartilham unidades, coordenadas, restrições e pontos de contato. Cada módulo é gerado em uma chamada separada contra esse contrato congelado. IDs são prefixados pelo módulo para evitar colisões. A aplicação verifica envelopes, referências, pertencimento completo e contato aproximado por caixas delimitadoras antes de reunir a cena.

Falha, cancelamento ou alteração de contexto impede aplicar uma montagem parcial. Uma proposta antiga também é rejeitada se uma referência relacionada mudar antes do aceite, inclusive quando uma imagem muda de vínculo dentro do mesmo ramo. No modo de revisão, o usuário pode aplicar ou recusar a proposta; o modo automático permanece disponível.

## Geometria disponível

O guia de produção `scene-v1-modeling-guide/2` mantém as cinco primitivas e acrescenta quatro construções nativas, sem executar código arbitrário:

| Geometria | Uso | Limites por objeto |
|---|---|---|
| [ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html) | Contornos com furos reais, espessura e chanfro | 128 pontos por contorno, 16 furos, 512 pontos totais |
| [LatheGeometry](https://threejs.org/docs/pages/LatheGeometry.html) | Eixos, flanges e perfis de revolução | 128 pontos e 128 segmentos |
| [TubeGeometry](https://threejs.org/docs/pages/TubeGeometry.html) | Cabos e caminhos curvos no espaço | 128 pontos, 256 segmentos longitudinais e 32 radiais |
| [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) | Malhas personalizadas de vértices e triângulos | 4.096 vértices e 24.576 índices |

O modo padrão admite até 128 objetos. O avançado admite até 96 por módulo e 512 no conjunto. O custo agregado conservador é limitado a 600.000 triângulos, incluindo contexto retido de decomposições. A validação rejeita contornos cruzados, furos fora da peça, triângulos degenerados, índices inválidos e tesselação excessiva antes da alocação. Geometrias iguais compartilham buffers, com transformações individuais. Cenas antigas de primitivas continuam válidas.

## Inspeção e rastreabilidade

Montado/Explodido, distância contínua e seleção de peça reutilizam o renderer existente. A explosão é apenas estado de inspeção: não reescreve a posição montada salva. O painel também mostra o contrato, pedidos dos módulos, fontes realmente lidas e incertezas. O TXT inclui o contrato e a cena completa. Copiar/colar mantém a montagem com cópias independentes da geometria.

Esta organização é distinta da pesquisa documental de decomposição: agrupar formas geradas não comprova uma BOM, componentes reais ou redes elétricas. O mesmo painel permite iniciar a pesquisa documental quando necessário. Nenhuma dimensão de encaixe, tolerância, torque, colisão ou cinemática é automaticamente validada.

## Comparações anteriores preservadas

O experimento de 32 células em `three-skills-comparison/matrix/` continua fixado no guia `/1`, no schema anterior de cinco primitivas e nos prompts registrados. Um teste reproduz exatamente os 32 pares de mensagens. `--prepare` valida a matriz sem inferência. A nova gramática `/2` não foi inserida retroativamente na comparação de skills; qualquer avaliação dela precisa de outro protocolo.

## Verificação em 10/10/2026

- 892 testes passaram; oito testes externos foram ignorados. Build TypeScript/Vite concluído com 571 módulos.
- 16 testes de geometria verificam furos por raycasting, normais, limites, topologia, orçamento agregado, compartilhamento de buffers e schema compatível com o provedor.
- 12 testes do modo avançado verificam seleção de ramo, recuperação documental, contrato compartilhado, aplicação, recuperação, TXT, cópias, cancelamento e obsolescência.
- [Ensaios visuais do motor](http://127.0.0.1:5190/docs/design/geometry-tests/) usam amostras determinísticas no renderer real. Não são saídas de IA nem testes de fidelidade física.
- A primeira tentativa remota revelou rejeição de `oneOf`; a seguinte revelou a exigência de incluir todos os campos em `required`. A gramática passou a usar `anyOf` e `geometry:null` obrigatório para primitivas. Esses resultados não foram aplicados ao canvas.

## Resultado real inspecionado

A primeira geração completa válida produziu **69 objetos em três módulos**: 59 no servo e acessórios, sete no suporte em U e três no elo. A cena contém 20 extrusões, nove perfis de revolução, três tubos e 37 primitivas. A aplicação preservou os quatro artefatos anteriores e acrescentou a amostra; minimizar manteve o processo e o progresso. Montado/Explodido e destaque foram exercitados no Estúdio.

O [visualizador da amostra](http://127.0.0.1:5190/docs/design/mg90s-advanced/) usa o [TXT exportado](samples/mg90s-advanced-2026-10-10.txt), sem retocar a cena. `npx vite-node --mode test docs/design/mg90s-advanced/validate.ts` confirma integridade, cobertura exata, caixas dos módulos separadas no extremo explodido, reversibilidade e ausência de alteração da origem. A rotação sincronizada e a seleção de suporte foram conferidas no navegador sem erros no console.

A leitura documental falhou: **zero fontes legíveis**. A variante, as medidas e o encaixe permanecem desconhecidos ou aproximados, conforme o próprio registro. A amostra demonstra o fluxo e os recursos geométricos, sem comprovar fidelidade física ou superioridade em uma comparação de skills.

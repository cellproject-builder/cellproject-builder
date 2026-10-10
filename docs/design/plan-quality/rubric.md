# Rubrica de revisão das primeiras respostas

Revisar `*-outline.json`, `*-expand.json`, `*-decompose.json` junto com `attempt-NN.json`. A resposta bruta mostra o que o modelo produziu; a normalizada mostra o que o usuário receberia. Notar os dois resultados quando diferirem. Não preencher nota sem evidência; usar `null` quando a etapa falhou ou o material não basta. Não pontuar palavras isoladas como prova de cobertura ou verdade.

| Dimensão | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Cobertura | Omite função essencial ou termina antes de integração/ensaio | Nomeia tópicos, mas deixa trabalho relevante implícito | Liga recursos, decisões, conexão/configuração, inspeção e ensaio ao objetivo e aos desconhecidos |
| Interfaces | Afirma compatibilidade pela aparência/nome ou ignora interfaces | Menciona interfaces e lacunas genericamente | Especifica quais grandezas, conectores, fixações/protocolos precisam coincidir e qual dado falta |
| Fidelidade de fonte | Inventa referência, mistura variantes ou transfere rating comercial para o caseiro como fato | Cita documento, mas aplicação/limite é ambíguo | Liga afirmações aos documentos corretos, expõe o conflito quando presente, mantém limites e hipóteses |
| Coerência | Contradiz objetivo, regras, pai/irmãos, quantidades, cronologia ou custos | Mantém direção geral, com lacunas/duplicações localizadas | Preserva decisões e limites entre etapas; filhos cobrem o próprio item e não refazem irmãos |
| Perguntas | Nenhuma pergunta/ação para lacunas críticas ou somente “confirmar compatibilidade” | Nomeia um dado ausente, sem caminho claro para obtê-lo/decidir | Pede dado específico, indica fonte/medição/observação e a escolha ou integração que depende dele |
| Incerteza | Afirma teste/montagem/compatibilidade não observados ou preenche desconhecido com precisão inventada | Faz ressalva geral sem separar afirmações | Distingue documento, hipótese, requisito e desconhecido em cada ponto relevante, com próxima investigação concreta |
| Critério | Genérico, circular, múltiplas condições sem separação ou testa outro nó | Observável, mas arbitrário/surrogate ou sem ligação clara com o item | Uma checagem própria do nó, limiar justificado quando necessário e evidência observável; não anuncia ensaio realizado |

No patinete, conferir os 12 tópicos e as seis interfaces de `docs/design/plan-approach/benchmark.ts`. Marcar cada tópico/interface como ausente, citado, operacional ou desconhecido preservado, com campo de evidência. Esses tópicos são critérios de revisão, não uma BOM do fabricante. Não é necessário copiar uma peça comercial para cobrir sua função.

## Questões específicas por condição

1. **Criação nova, sem referência:** requisitos de uso, carga e desempenho continuam abertos? As alternativas são escolhas explícitas? Valores inventados aparecem como fatos ou hipóteses? Perguntas destravam arquitetura e componentes?
2. **Engenharia reversa, sem alvo:** o plano pede produto/variante/material/observação antes de chamar a lista de peças de engenharia reversa? Alguma marca/modelo foi introduzida sem fonte? A ausência do alvo se mantém na expansão e decomposição?
3. **Engenharia reversa, fonte delimitada:** afirmações documentadas citam `specs` ou `product`? A função comercial está separada das peças do caseiro? O plano identifica o que as páginas não dizem, incluindo controlador, chicote, firmware, dimensões de fixação e ensaios próprios?
4. **Conflito de variante:** o plano expõe “4 Pro” versus material do “Scooter 4” e pede evidência da variante? Algum rating do 4 é atribuído ao Pro ou ao caseiro? A expansão/decomposição mantém o conflito aberto?

Nos extras, o robô exige atenção à carga/alcance/torque, alimentação e ajuste mecânico medidos; MG90S por nome não prova capacidade. Arduino + cabo exige identificação da placa, conector e capacidade de dados do cabo; presença dos dois objetos não prova upload, alimentação ou driver adequado.

## Evidência mínima por nota

Registrar `case`, `stage`, `dimension`, `score`, `evidence` (arquivo, caminho do campo, trecho), `counterevidence` e `notes`. Para uma nota 2, buscar um caso contrário no próprio plano. Para qualidade das perguntas, classificar cada exemplo como específico, respondível e útil à decisão; uma frase interrogativa não ganha pontos automaticamente. Ações de pesquisa/medição podem cumprir o propósito de uma pergunta quando identificam o dado e a dependência.

Erros críticos devem ser relatados à parte: variante trocada, fonte inexistente, especificação comercial transferida para o projeto, afirmação de compatibilidade/ensaio sem evidência, contradição de unidade/quantidade e limite físico arbitrário. A validade do schema e a normalização não eliminam esses erros.

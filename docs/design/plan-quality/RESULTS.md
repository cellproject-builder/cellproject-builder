# Piloto real de qualidade — 10/10/2026

O piloto concluiu **12 chamadas do serviço de produção**, uma primeira tentativa de esboço, expansão e decomposição para cada uma das quatro condições. Todas as etapas retornaram pelo serviço; nenhuma foi repetida ou substituída. O custo informado nos corpos do provedor somou **US$ 0,3433099**, com 51.523 tokens de entrada e 26.037 de saída. A reserva conservadora foi US$ 2,407052, dentro do teto estimado de US$ 3. A execução ocorreu de 22:39:37 a 22:45:55 UTC (~6 min 18 s).

Evidências completas: [manifesto](results/2026-10-10-core-first-attempt/manifest.json), [extração técnica](results/2026-10-10-core-first-attempt/technical-summary.json), [resumo das etapas](results/2026-10-10-core-first-attempt/summary.json), [revisão qualitativa](results/2026-10-10-core-first-attempt/review.json). O manifesto contém o HEAD e hashes dos arquivos carregados no início; mudanças posteriores de validação/prompts feitas pela equipe **não foram reavaliadas ao vivo neste piloto**. O módulo do serviço foi carregado uma vez; não houve nova importação durante as chamadas.

## Condições e parâmetros efetivos

Modelo `openai/gpt-6.1-sol`, ID padrão de `src/config/store.ts`, confirmado antes do POST no catálogo público do OpenRouter. Configuração em store isolado, idioma `pt-BR`, regras vazias, pesquisa web automática desligada, `maxRetries: 0`, `response_format: json_schema`, temperatura omitida pelo `callOpts` para modelo de raciocínio.

| Etapa | max_tokens enviado | reasoning.effort | Transporte |
| --- | ---: | --- | --- |
| Esboço | 8.000 | low | SSE |
| Expansão | 10.000 | low | SSE |
| Decomposição | 7.000 | medium, default do modelo | JSON sem streaming |

Esses parâmetros se mantiveram iguais entre condições na mesma etapa. A política escolheu o esboço de menor rank e um recurso real desse plano, sem editar respostas. O recurso escolhido varia: bateria na criação nova, controle nas duas condições seguintes e bateria no conflito. Portanto, as decomposições informam coerência dentro do plano; **não são uma comparação controlada do mesmo nó entre abordagens**.

| Condição | Chamadas | Tempo somado de transporte | Custo informado |
| --- | ---: | ---: | ---: |
| Criação nova sem referência | 3 | 106,794 s | US$ 0,1066805 |
| Engenharia reversa sem alvo | 3 | 85,641 s | US$ 0,0730448 |
| Engenharia reversa com fonte delimitada | 3 | 94,315 s | US$ 0,0834848 |
| Engenharia reversa com conflito 4 Pro/4 | 3 | 91,087 s | US$ 0,0800998 |

## Avaliação pelas dimensões da rubrica

A leitura aplica a [rubrica definida antes da revisão](rubric.md) às saídas reais. As observações não são uma média de qualidade nem uma taxa de acerto geral. A revisão independente do agente coordenador, que leu as quatro expansões/decomposições sem implementar o harness, confirmou os dois problemas de critério descritos abaixo. Não houve revisão humana cega nem replicações estatísticas.

| Condição | Evidência observada | Limite ou contraprova |
| --- | --- | --- |
| Criação nova sem referência | Compara doador, conversão e chassi próprio. O plano escolhido pergunta orçamento, peso com carga, terreno, velocidade e autonomia. A decomposição pede química, corrente, conectores, polaridade e comunicação antes de aceitar bateria/carregador. | Vários critérios resumem inspeções em “zero falhas” ou “laudo apto”, sem definir o procedimento disponível. Preços e prazos são estimativas do modelo, não cotações verificadas. |
| Engenharia reversa sem alvo | Expansão mantém “Modelo e variante: DESCONHECIDOS”, solicita etiqueta, conectores e manual. Decomposição pede código/revisão do controlador e versão/aplicativo, sem inventar produto comercial específico. | Escolhe a restauração de um doador como caminho antes de existir alvo físico. Isso é uma alternativa proposta, não reconstrução validada. Critérios de correspondência dependem de documentação que ainda precisa ser obtida. |
| Engenharia reversa com fonte | Expansão cita `[specs]` para 300 W nominais e diz que isso não identifica a peça do doador. Decomposição cita `[product]` para painel digital, mantendo código e protocolo da peça real desconhecidos. | Quatro filhos de controle dependem de “diagnóstico original” com zero falhas de comunicação; disponibilidade da ferramenta, procedimento, protocolo e acesso não foi estabelecida. Preservar desconhecidos não resolve essa dependência. |
| Engenharia reversa com conflito | Esboço e expansão expõem fontes do Scooter 4 contra alvo 4 Pro. Decomposição diz que os ensaios aplicáveis ao 4 Pro são desconhecidos. Não transfere os 300 W, 42 V ou capacidade da bateria para o Pro ou para o caseiro nos trechos revisados. | O nó “Confirmar variante e desempenho” usa como critério somente preencher peso, inclinação, velocidade, autonomia e cidade. Esse critério pode passar sem confirmar a variante. O laudo final também depende de procedimentos ainda desconhecidos. |

**Cobertura e interfaces:** as quatro expansões tratam estrutura/direção/rodas, propulsão, energia/proteção/carga, controle/comandos, freios, chicote, conexão/configuração e ensaio, em recursos agrupados e passos. Isso cobre os temas de revisão do roteiro; não identifica uma BOM completa. As interfaces aparecem como objetos de identificação e comparação. Não se verificaram encaixes, limites elétricos, protocolo, firmware ou compatibilidade física de qualquer peça.

**Coerência:** objetivo, abordagem, alvo e contexto de irmãos seguiram para as três etapas. As instruções de aquisição/identificação dos filhos se mantiveram relacionadas ao recurso selecionado. Não foi observado conflito de variante oculto no caso contraditório. A coerência dos critérios continua parcial pelos dois exemplos concretos acima; custos, disponibilidade de oficinas/manuais e desempenho não foram verificados externamente.

**Perguntas:** há perguntas específicas e respondíveis sobre carga, percurso, orçamento, etiquetas, códigos, revisão, sinais, protocolo, versão e aplicativo. Esses dados são relevantes à escolha e à integração. Há também ações genéricas como “obter laudo” ou “diagnóstico original”, que não explicam como resolver a ausência do procedimento. A bateria distingue essa lacuna de uma simples contagem de interrogações.

**Fidelidade e incerteza:** os exemplos documentados conferidos usam os documentos e a variante corretos. As afirmações de preço/prazo e estado do doador não ganharam status de medição. As respostas mantêm hipóteses e desconhecidos e descrevem ensaios futuros, sem relatar uma montagem física concluída. A presença dos rótulos `DOCUMENTADO`/`UNKNOWN` por si só não garante a verdade das demais frases.

**Critérios:** o limite técnico de 140 caracteres foi respeitado nos nós brutos, mas não evitou critérios vagos, dependentes de infraestrutura desconhecida ou que cobrem apenas parte do próprio nó. Essas falhas são o principal resultado acionável deste piloto. Antes de usar um diagnóstico como critério, o plano precisa estabelecer qual ferramenta/procedimento/acesso existe; confirmar variante precisa ter evidência de identidade, além do preenchimento dos requisitos.

## Integridade e testes

Os 12 corpos de resposta contêm JSON de assistente extraível; todos os 24 hashes de requisição/resposta conferem. Não foram observados IDs temporários duplicados, critérios acima de 140 caracteres, avisos ou erros do serviço nessas tentativas. Essas verificações são técnicas e não validam a semântica.

Comentários `: OPENROUTER PROCESSING` no início do SSE fizeram o extrator inicial registrar uso `null` nos streams. Os corpos originais permaneceram intactos. O extrator foi corrigido com regressão, e `technical-summary.json` recalcula os dados terminais, identifica a correção e registra hashes do extrator. Nenhuma chamada paga foi repetida. O custo do manifesto original parcial não deve substituir a extração técnica completa.

- Testes dedicados do harness: 9 aprovados, incluindo contagem de tentativas/retry, bloqueio de orçamento/modelo, redaction, texto bruto malformado, erro de rede, stream interrompido, SSE com comentários, default sem rede e serviço real com HTTP roteirizado.
- TypeScript dedicado: `npx tsc --project docs/design/plan-quality/tsconfig.json --noEmit`, aprovado.
- Suíte do checkout executada às 22:43:52 UTC: `npm test`, 172 arquivos aprovados/2 ignorados; 1.538 testes aprovados/8 ignorados. Houve avisos de Browserslist, React `act` e compatibilidade de SDK; zero falhas. Mudanças posteriores da equipe têm verificação separada e não são cobertas retroativamente por essa execução.
- Checagem interna do literal da credencial em todos os arquivos da pasta de evidência: nenhuma ocorrência; a chave não foi impressa ou copiada.

Os extras de robô e Arduino+cabo estão definidos. Arduino+cabo também exercitou o serviço real em teste de transporte roteirizado, inclusive diferença entre texto bruto e normalização. **Não foram chamadas reais de modelo para esses extras**. TypeSafe não foi executado. Não houve ensaio físico, teste de aprendizagem, alegação de novidade ou confirmação de eficácia. A bateria deixa esses limites explícitos em vez de converter formato válido em aprovação do projeto.

## Rodada posterior às regras de critério

Uma execução separada repetiu **somente fonte delimitada e conflito de variante**, com uma primeira tentativa de cada etapa, mesmos defaults de modelo/parâmetros e novo snapshot do serviço. Foram **6/6 chamadas concluídas**, sem retries, custo informado de **US$ 0,1602416**, 27.482 tokens de entrada e 13.086 de saída. A reserva de US$ 1,2337 ficou abaixo do teto estimado de US$ 1,50. Os 12 hashes de requisição/resposta conferem; os seis JSONs brutos foram extraídos sem IDs repetidos ou critérios acima de 140 caracteres. A primeira rodada não foi alterada.

Evidências: [manifesto posterior](results/2026-10-10-post-criterion-rules/manifest.json), [extração técnica](results/2026-10-10-post-criterion-rules/technical-summary.json), [revisão parcial com campos e contraprovas](results/2026-10-10-post-criterion-rules/review.json).

Na expansão conflitante, o critério antes restrito a requisitos preenchidos passou a exigir que o código fotografado da etiqueta corresponda à fonte específica obtida. É um critério de identidade melhor para aquele passo. No caso com fonte delimitada, essa comparação também aparece no primeiro passo; porém a revisão independente observou que ela já existia em um recurso anterior. Seu deslocamento não demonstra nova capacidade geral. O conflito 4/4 Pro continua exposto e limites de testes elétricos são remetidos ao procedimento da variante, sem inventar números nos trechos revisados.

**As lacunas permanecem:** os primeiros passos ainda combinam identidade, fontes, requisitos e interfaces em um só nó, com critério que cobre apenas identidade. O controlador ainda depende de diagnóstico original sem erro de comunicação; pedir documentação/aplicativo antes não demonstra que esse método estará disponível. A decomposição escolheu bateria/carregador nas duas condições posteriores, enquanto a condição com fonte inicial decompôs controle: não é comparação controlada do mesmo filho. Um código legível não demonstra saúde da bateria; o laudo de uso conjunto continua genérico.

A revisão atribui **critério parcial (1)** nas duas expansões, com contraprovas registradas, sem nota global. Um segundo revisor leu apenas a condição com fonte posterior e confirmou a melhora local na instrução de obter procedimentos antes do ensaio, além dos objetivos compostos parcialmente verificados; não leu a condição conflitante. Uma amostra posterior por condição e mudanças de seleção não permitem atribuir a diferença às instruções ou declarar a qualidade resolvida. O total das duas execuções foi **18 chamadas e US$ 0,5035515 informados pelo provedor**. Robô/Arduino e replanejamento real continuam fora dessas chamadas.

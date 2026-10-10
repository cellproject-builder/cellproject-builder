# Leitura dos primeiros ensaios

10/10/2026. Auditoria dos arquivos gravados em `results/`, sem novas inferências. O [DBox](https://arxiv.org/abs/2502.19133) inspira a co-decomposição e a ajuda progressiva; geração livre de componentes React é uma extensão proposta pelo projeto, não um recurso demonstrado pelo artigo.

## Contagem que deve acompanhar a comparação

| Grupo | Tentativas registradas | Resultado |
|---|---:|---|
| Revisão de plano | 2 | Trecho atual e adaptação geraram respostas aceitas pelo schema comum. |
| Componente React | 1 | Resposta compilada, bundle de 150.477 bytes. Compilar não prova funcionamento de todas as interações ou isolamento suficiente para produção. |
| Diagrama declarativo | 4 | Inicial falhou; diagnóstico retornou HTTP 400 por schema de tupla; reparo com array também falhou; quarta tentativa, JSON como texto e validação local, produziu desenho aceito. |
| Classificação TypeSafe | 3 | `reference`, `extend` e `reorganize` nas três frases fornecidas. |

São **10 tentativas de serviço**, sete com saída aceita/classificada e três falhas declarativas. O manifesto inclui a tentativa diagnóstica, mesmo não tendo desenho. A primeira falha possui mensagem genérica: a recusa de schema foi observada explicitamente na repetição diagnóstica, não num registro detalhado da primeira chamada. O reparo por array também conserva somente erro genérico, sem permitir atribuir causa técnica específica.

## O que mudou no plano desta amostra

O contexto é fictício: quatro nós, um relato de tremor e nenhuma medição ou documento técnico. O usuário ainda não escreveu critério quantitativo. Modelo e esforço foram os mesmos; não houve seed fixa, repetição ou avaliação cega.

O trecho atual de `replanFromFailure` exige nomear uma premissa errada. Sua resposta marcou `servo` como `contradicted` e propôs três filhos, mas também declarou que isso não demonstra defeito nem insuficiência de torque nominal, preservou a etapa existente de alimentação e pediu critérios. Portanto, não é correto descrevê-la como uma troca cega de motor ou uma conclusão causal sem ressalvas. Há, contudo, tensão entre exigir premissa errada e admitir causa indeterminada.

A adaptação marcou os quatro nós como `uncertain`, distinguiu relato de causa, conservou o caminho e deixou `proposedChanges` vazio. Pediu que a pessoa formulasse previsão/critério e ofereceu apenas um subpasso opcional. Essa resposta é mais alinhada à preservação do raciocínio e ao adiamento de decisões que dependem de medidas **neste cenário**. Não demonstra superioridade geral ou aprendizagem.

As duas condições só produziram objetos de avaliação: nenhuma alterou a árvore. A preservação declarada pela resposta não comprova que o motor de produção aplicaria mudanças corretamente. O baseline é o trecho TASK extraído do serviço com schema comum, não uma execução integral do fluxo atual. A adaptação reúne DBox e regras próprias de evidência física; o ensaio não isola o efeito do artigo. Descrições de propostas da resposta atual terminam incompletas dentro do limite textual: aceitação estrutural também não assegura completude editorial.

## O que os diagramas permitem concluir

Há duas saídas reais inspecionáveis, com massa/distância, torque simplificado e referências aos nós `servo` e `test`. A quarta saída declarativa usa cálculos e bindings controlados; React tem liberdade maior de layout e código. Os prompts técnicos, contratos e transporte diferem, e houve três tentativas declarativas anteriores. Assim, comparar “React ganhou de JSON” pela taxa de sucesso ou pelo tempo seria indevido. A recusa de JSON Schema é um problema da integração de transporte, não evidência de incapacidade do desenho declarativo.

O cálculo `m × 9,81 × r` descreve uma idealização com carga pontual e braço horizontal. Não mede torque do servo, não inclui massa do braço/dinâmica/atrito e não valida capacidade do MG90S. A geometria e as explicações precisam ser avaliadas separadamente da aritmética. Controle de contexto, fundo transparente, arraste/resize e foco em nós são testes de integração; não bastam para validar o conteúdo didático.

## Papel útil do TypeSafe

As frases classificadas foram: explicar sem mudar → `reference` (confiança .95); adicionar etapa → `extend` (.99); reorganizar ordem → `reorganize` (.99). São três exemplos claros, não estimativa de acurácia ou calibração. `revise`, `clarify`, instruções ambíguas e tentativas de instrução dentro de anexos não foram exercitados nestas três chamadas.

`server/typesafe.mjs` e `src/ai/planIntake.ts` já tratam a classificação como aconselhamento. O serviço pode ajudar a escolher entre consultar, complementar, revisar, reorganizar e esclarecer; também ordena relevância **textual** de imagens. Não decide veracidade, compatibilidade física, arquitetura vencedora ou autorização. Categorizar um pedido como `extend` não deve duplicar a etapa de alimentação que já existe: isso exige leitura do plano e validação da proposta.

IDs, escopo, revisão atual, citações presentes, limites, ciclos, operações permitidas e cálculo numérico devem continuar em validações determinísticas. Confiança probabilística não substitui essas verificações. A seleção do tipo de artefato pode futuramente ser uma classificação consultiva com opção de esclarecimento, depois de termos categorias e exemplos rotulados; não há vantagem demonstrada em chamar o classificador para cada gesto do canvas.

## Próxima matriz pequena e justa

1. Revisão de plano: três casos — sem medidas, evidência suficiente e evidência conflitante/variante errada — nas duas condições, com duas repetições cada (12 saídas). Mesmos contexto, schema e modelo. Rubrica definida antes: causalidade prematura, critério escrito pela IA no lugar da pessoa, duplicação, referências existentes, mudanças locais justificadas e lacunas explícitas.
2. Artefatos: torque, circuito/fluxo com relações e gráfico previsão versus observação; duas arquiteturas, duas repetições (12 saídas). Congelar contratos/transporte antes de iniciar; prompts diferem só no necessário à representação. Guardar primeira resposta, falhas e reparos separados. Avaliar legibilidade em desktop/mobile, sobreposição, acessibilidade, interação real, fórmulas e vínculo ao nó; avaliadores sem rótulo da arquitetura quando viável.
3. Contexto: alterar um requisito/nó durante uma geração e tentar aplicar a saída antiga; excluir o nó referenciado e trocar de projeto. Resultados esperados são determinísticos: bloquear aplicação obsoleta e preservar os originais.
4. TypeSafe: conjunto rotulado de 10–15 pedidos que inclua `revise`, `clarify`, ambiguidade e anexos com instruções hostis. Comparar categoria e decisões indevidas; não transformar probabilidades em percentuais de acerto.

Continuar com um laboratório de representação livre e um caminho declarativo controlado faz sentido. A mudança mais imediata no motor de plano é revisar o tratamento da incerteza e a ajuda progressiva, com teste integral do fluxo antes de adoção. Nenhum destes ensaios mede resultado pedagógico ou desempenho do robô físico.

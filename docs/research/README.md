# Usar o Dynamic Diary em artigos

Este guia organiza fontes para redação técnica e pesquisa. A [direção aprovada SENAI](../OBJETIVO_DO_ARTIGO.md) é canônica: avaliar como explicitar e corrigir premissas de um plano por evidências físicas. A aplicação é instrumento do método, e o robô de dois braços é o caso escolhido. Não há aqui resultado presumido de aprendizagem, eficácia, novidade ou premiação.

## Separar quatro tipos de afirmação

| Tipo | Exemplo de afirmação admissível | Evidência necessária |
| --- | --- | --- |
| Proposta | “Propõe-se um ciclo de explicitação, ensaio e revisão.” | Objetivo, definição operacional e protocolo |
| Implementação | “O sistema armazena critério próprio antes de revelar o critério da IA.” | Contrato, código e teste correspondente; revisão/versão |
| Verificação técnica | “A versão X passou Y testes no ambiente Z.” | Comandos, saídas, data e limitações; simulação identificada |
| Resultado empírico | “Na tarefa T, participantes identificaram mais premissas equivocadas.” | Experimento executado, medidas, dados e análise; verificação independente |

Uma tela 3D detalhada não comprova fidelidade dimensional. RLS ou criptografia implementadas não demonstram uma auditoria externa. TypeSafe classifica texto segundo categorias/contexto; essa classificação não certifica compatibilidade física nem verdade científica. Um ensaio relatado pelo usuário precisa de conferência da evidência.

## Fontes para descrever o sistema

Usar [arquitetura](../architecture.md) e [mapa do repositório](../repository-map.md) para o panorama. As [dez fichas de módulos](../modules/README.md) fornecem finalidade, pipeline, contratos, dados, testes, limites e perguntas investigáveis. Elas descrevem o código inspecionado em 10/10/2026; revisões futuras exigem conferir o commit utilizado no artigo.

| Recorte do texto | Fontes principais | Cuidado |
| --- | --- | --- |
| Método de desconstrução | [Objetivo](../OBJETIVO_DO_ARTIGO.md), [planner](../modules/planner-projects.md) | Confirmar tarefa não equivale a verificar premissa |
| Representação de sistemas físicos | [3D](../modules/three-studio.md), [imagens](../modules/image-references.md) | Documentar produto/variante, origem e medidas; separar ilustração de evidência |
| Abstrações interativas | [Diagramas](../modules/diagrams.md), [Board](../modules/dynamic-board.md), [notas](../modules/notes.md) | Contrato SVG em produção difere do React gerado em laboratório |
| IA e ações sobre documentos | [Orquestração](../modules/ai-orchestration.md), [chat](../modules/chat-and-dairo.md) | Dairo permanece proposta; contexto autorizado difere de memória automática |
| Reprodutibilidade/privacidade | [Dados](../modules/data-and-privacy.md), [plataforma](../modules/platform-and-delivery.md) | Não confundir teste simulado com round trip remoto ou uso em dispositivo real |

Os [relatórios](../reports/README.md) registram execuções datadas. Para citar um resultado de teste, usar o relatório da mesma revisão e, se possível, preservar a saída e a revisão Git. Não somar testes antigos e novos como amostra científica.

## Experimentos e artefatos existentes

| Material | O que permite investigar | O que não permite concluir sozinho |
| --- | --- | --- |
| [Comparação com/sem guia](../design/three-skills-comparison/) e [proveniência](../visual-modeling-skills.md) | Amostras de modelagem com guia adaptado e baseline | Superioridade geral de skills |
| [Matriz de referências](../design/three-skills-comparison/matrix/README.md) | Fatores separados: guia, imagem, especificações, objeto e repetição | Que referência e skill sejam o mesmo fator; efeito geral a partir de inspeção visual isolada |
| [Geometria](../design/geometry-tests/) | Capacidade/limites do contrato geométrico e renderer | Medidas/encaixe de uma peça fabricada |
| [Artefatos interativos](../design/interactive-artifacts/) e [contrato de produção](../design/interactive-artifacts/PRODUCTION.md) | Comparar dados + renderer com código React gerado | Que sandbox experimental seja o mecanismo produtivo |
| [Abordagens de plano e engenharia reversa](../design/plan-approach/README.md) | Protocolo e material de cobertura/perguntas para planos | Resultados generalizáveis sem execução e análise registradas |
| [Decomposição documental](../design/object-decomposition.md) | Identidade, fontes, componentes e proveniência geométrica | Desmontagem física correta ou BOM completa |

Conferir o manifesto/README de cada experimento antes de dizer quais células foram executadas. Configuração planejada, tentativa concluída, saída válida e avaliação de qualidade são estados distintos. Páginas locais existentes permitem visualizar resultados salvos sem novas chamadas de IA. Os comandos manuais em [scripts](../../scripts/README.md) podem gerar custo quando explicitamente executados.

## Direção do estudo do método

O comparador pretendido é um chat comum versus o fluxo estruturado, com o mesmo LLM e tarefas equivalentes. O resultado principal deve considerar identificação de premissas erradas, qualidade do critério próprio, correspondência entre previsão e observação e revisão justificada. Uma verificação independente deve examinar as evidências e a correção das revisões. Aprendizagem é resultado secundário, com tarefa equivalente sem assistência. Essa direção ainda precisa de protocolo operacional e execução.

Um piloto N=1 pode mostrar viabilidade, dificuldades e ajustes do procedimento; não sustenta eficácia geral. Descrever o robô de dois braços conforme o que realmente foi construído e testado. Fontes da web, simulações e objetos gerados são referências/hipóteses; não substituir o ensaio físico por uma segunda resposta de IA.

## Registro mínimo de uma nova avaliação

1. Pergunta, hipótese e critério de comparação antes da execução; unidade analisada e condições controladas.
2. Revisão Git, protocolo/versão dos schemas/guias, ambiente, provedor/modelo e parâmetros; referências com origem e data.
3. Entrada original, contexto efetivamente compartilhado, prompt por etapa e identidade dos módulos/componentes.
4. Todas as primeiras tentativas, incluindo inválidas, timeouts e abortos; retries separados e justificados. Não substituir a primeira saída por uma melhor sem registrar.
5. Saídas e rubrica de avaliação; julgador humano/IA identificado, cegamento quando aplicável e divergências registradas.
6. No mundo físico, previsão anterior ao ensaio, procedimento, instrumentos, observação, incerteza, evidência e revisão resultante.
7. Tempo/custo, dados ausentes e exclusões; resultados negativos preservados. Separar métricas técnicas de resultados de aprendizagem.

Esse registro é uma orientação de método, não uma funcionalidade de coleta integral já implementada. Informações privadas precisam de minimização/anônimos antes de entrar em fixtures ou anexos públicos do artigo. Ancorar citações bibliográficas no texto original da pesquisa; estas fichas são documentação técnica do projeto.

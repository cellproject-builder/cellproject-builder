# Objetivo do artigo e papel do aplicativo

Este documento registra o objetivo aprovado para o artigo do SENAI e é a referência canônica para alinhar o aplicativo, a pesquisa e a redação. Descrições de funcionalidades em outros documentos devem ser lidas à luz deste recorte.

## Objetivo principal

Desenvolver e avaliar um método de desconstrução de planos gerados por IA, orientado por evidências físicas, que ajude uma pessoa a explicitar, testar e corrigir premissas durante a construção de um sistema físico.

O artigo e o método são a contribuição principal pretendida. O aplicativo oferece suporte ao processo e pode ser usado por qualquer pessoa para aprender, compreender e construir em diferentes projetos. O robô de dois braços é o estudo de caso escolhido; sua construção e seu funcionamento não são considerados concluídos.

## Pergunta de pesquisa

**Como ajudar uma pessoa a identificar e corrigir premissas erradas de um plano gerado por IA durante a construção de um sistema físico?**

## Contribuição candidata

Um método acompanhado por uma ferramenta que torna examinável a passagem entre aquilo que o plano pressupõe, aquilo que a pessoa prevê, o que acontece no mundo físico e a revisão decorrente dessa diferença. A contribuição candidata está nessa organização do processo e em sua avaliação, sem pressupor eficácia ou novidade científica.

## Ciclo operacional

**Premissa explícita → previsão/critério próprio antes do ensaio → ensaio → observação real → revisão justificada.**

1. **Explicitar a premissa.** Identificar, no nó do plano, o que está sendo assumido e por que isso sustentaria a ação proposta. Uma explicação da IA continua sendo uma hipótese a examinar.
2. **Registrar a previsão e o critério próprio.** Antes do ensaio, a pessoa descreve o resultado esperado e como distinguir atendimento de falha. O campo existente `comoConfirmarUsuario`, com `comoConfirmarUsuarioAt`, registra esse compromisso antes da revelação do critério da IA.
3. **Realizar o ensaio.** Confrontar a premissa com a construção, uma medição ou outra verificação física pertinente. O aplicativo organiza o processo; a execução e a coleta de evidências ocorrem no mundo real.
4. **Registrar a observação real.** Descrever o que foi observado e compará-lo com a previsão. Quando o critério foi atendido, `comoConfirmarAtendido.observacao` registra o relato; referências verificadas podem incluir `groundTruthRefs[].observacao`. Quando houve falha, `failureContext` registra o ocorrido, com `failureReportedAt`.
5. **Revisar com justificativa.** Explicar qual premissa a observação sustenta ou contraria e o que precisa mudar. `replanFromFailure` pode sugerir uma nova decomposição a partir da falha registrada; a pessoa examina e aceita ou rejeita a proposta. O contexto da falha e o histórico ajudam a manter a justificativa da revisão rastreável.

Os campos existentes sustentam o registro do ciclo; sua presença, sozinha, não comprova que o ensaio foi realizado nem que a conclusão está correta. A revisão precisa ser justificada pelas evidências, e não apenas por outra resposta da IA.

## Direção da avaliação

A avaliação principal deve comparar um chat comum com o fluxo estruturado do aplicativo, usando o mesmo LLM e tarefas equivalentes. A comparação deve examinar a identificação de premissas erradas, a relação entre critério e observação e a correção justificada do plano, com verificação independente das evidências e das revisões. Essa direção de avaliação não representa um experimento já executado.

A aprendizagem é um resultado secundário: deve ser examinada pela transferência para uma tarefa equivalente sem assistência da IA, além do desempenho durante o uso da ferramenta.

Um estudo com uma única pessoa (N=1), no caso do robô de dois braços, pode documentar viabilidade, dificuldades e limites do método. Não demonstra, isoladamente, eficácia geral ou resultados aplicáveis a outros usuários e sistemas.

## Limites e compromissos

- Um registro humano é um relato; não certifica segurança, qualidade da medição ou validade científica. A avaliação precisa conferir o que as evidências efetivamente permitem concluir.
- Confirmar um nó, concluir uma tarefa ou receber uma crítica de outra IA não substitui evidência física nem verificação independente.
- Não há resultados presumidos de eficácia, aprendizagem, novidade, funcionamento completo do robô ou premiação. O artigo deve distinguir proposta, implementação, ensaios realizados e resultados observados.
- O aplicativo permanece geral. Controle físico, comunicação com o robô e automação de ensaios pertencem a um módulo futuro, fora deste recorte atual.

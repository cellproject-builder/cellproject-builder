# DBox, motor de planos e artefatos interativos

Ensaio de viabilidade de 10/10/2026. Abrir com o Vite em `/docs/design/interactive-artifacts/`.

Direção visual aprovada pelo usuário em 10/10: dados validados + React/SVG como base da integração futura ao canvas, mantendo transparência, interações, vínculos e revisões. O laboratório ainda não grava artefatos no plano de produção.

O encaixe mais forte do DBox é a revisão localizada e colaborativa do plano. A geração livre de componentes React é uma extensão proposta pelo projeto, não uma arquitetura descrita no artigo. Fonte primária: [DBox, seções 4.3–4.6 e 8.4](https://arxiv.org/html/2502.19133v1).

## O que foi experimentado

- Mesmo cenário sintético de servo com tremor e sem medições, avaliado com trecho TASK atual do replanejamento e com adaptação que preserva estrutura e incerteza. O trecho atual marcou `servo` como `contradicted`; a adaptação manteve `uncertain` e não propôs novos nós. Isso é um indício localizado, não uma taxa de acerto ou demonstração pedagógica.
- Mesmo pedido de diagrama de torque, gerado como React livre e como JSON declarativo renderizado em React/SVG. O React compilou e foi exercitado no navegador. O JSON válido tem 25 elementos e 31 bindings; não houve edição manual das respostas.
- TypeSafe existente classificou três intenções explícitas como `reference`, `extend` e `reorganize`. Confiança do modelo não é acurácia medida nem validação física.

Foram sete requisições de LLM: quatro outputs válidos e três tentativas declarativas inválidas. As duas primeiras tentativas declarativas foram recusadas por schema de tupla (HTTP 400), uma correção do transporte também falhou, e a quarta usou JSON como texto com validação local, contrato e instruções técnicas adaptados. Os arquivos originais permanecem em `results/`. Houve três chamadas adicionais de TypeSafe. Abrir a página não faz chamadas pagas.

## Leitura para o produto

| Recorte | Recomendação |
|---|---|
| Revisão do motor | Preservar nós, identificar a premissa exata e hipóteses concorrentes; propor um diff localizado, sem concluir causa apenas porque houve falha. |
| Ajuda | Pergunta, pista e subpasso sob demanda. O usuário escolhe o nível; não impor um ritual escolar a todo projeto. |
| Código/documentos → plano | Inferir uma estrutura rastreável a trechos/fontes, como proposta. Anexos não autorizam mudanças por conta própria. |
| Artefato interativo | Visão de uma relação específica entre nós, com parâmetros temporários. Evitar outra árvore inteira ao lado da árvore existente. |
| React/SVG declarativo | Candidato para vínculos e interações consistentes. O contrato do laboratório é reduzido; ainda faltam grupos, transformações e validação completa de geometria dinâmica. |
| React livre | Flexibilidade real, mas exige isolamento, tratamento de falhas, limites de recursos e mais avaliação. O iframe restringe conexões/subrecursos por CSP; não demonstra bloqueio de toda navegação ou CPU. |
| TypeSafe | Roteamento orientativo e revisão de cobertura contra uma referência delimitada; retornar dúvida quando falta base. Conferência de IDs, ciclos e permissões continua determinística. |

No canvas de produção, a integração candidata reutiliza posição, redimensionamento, vínculos, origem, revisão e histórico dos artefatos existentes. A visualização recebe IDs de nós e uma revisão de contexto. Mudança em parâmetro é exploração; alteração do plano passa pelas ações validadas já existentes. Nada deste laboratório grava no projeto real.

## Limites e próximos ensaios

Uma amostra por condição; sem seed fixa, cegamento ou referência física medida. O baseline é um trecho do prompt com um schema comum, não a execução integral de produção. A adaptação mistura regras próprias e princípios do artigo. Os transportes e prompts técnicos variaram: não usar o resultado para declarar uma arquitetura superior.

O React gerado ficou com rolagem interna no tamanho inicial, enquanto a versão declarativa distribui o SVG na área. Isso deve ser medido em diferentes dimensões, não corrigido manualmente e apresentado como sucesso do modelo. Layouts do laboratório não persistem após recarregar. `Mostrar vínculo` só alterna sua visualização; não modifica relações do plano.

Testes: `npx vitest run --config docs/design/interactive-artifacts/vitest.config.ts`. Os testes locais não executam APIs. Os scripts `run.ts`, `retry-data.ts`, `repair-data.ts` e `data-text-transport.ts` são opt-in e preservam as primeiras tentativas; não os rode para apenas abrir/revisar as amostras.

[Montagem de cenas salvas](assembly.html): spike técnico com três cenas extraídas da amostra MG90S anterior. A composição copia e identifica os objetos, aplica poses rígidas, preserva originais e exibe relações explícitas. Usa a animação reversível do renderer existente. Não inclui seleção de artefatos reais do workspace, persistência do conjunto ou validação mecânica; esse fluxo de produto permanece uma etapa própria. Três testes verificam composição/proveniência, contratos inválidos e retorno real dos grupos Three.js. O conjunto do laboratório passou em 12 testes.

Análises complementares: [motor](PLAN_ENGINE_ANALYSIS.md), [arquitetura](ARCH_REVIEW.md), [avaliação](EVALUATION.md) e [fila desta conversa](BACKLOG_AUDIT.md).

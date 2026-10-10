# Motor de agentes do dynamic_diary

## Objetivo

Usar `ToolLoopAgent`, do Vercel AI SDK, como motor do assistente integrado,
preservando os fluxos de projetos, tarefas, notas e planejamento já existentes.
A migração trabalha na versão instalada `ai@6.0.168`; não exige atualizar os
provedores nem contratar hospedagem ou AI Gateway.

## Estrutura

- `src/ai/agents/workspaceAgent.ts`: cria uma instância do agente por execução,
  com instruções, contexto atual, modelo, ferramentas e política do loop.
- `src/ai/assistant.ts`: adapta o stream do agente ao contrato usado pelo chat,
  entregando texto acumulado e mensagens de resposta para o histórico.
- `src/ai/workspaceTools.ts` e `plannerTools.ts`: mantêm validação, fila de
  execução, persistência e ações sobre os stores reais.
- `src/ai/client.ts`: mantém os provedores OpenAI, Anthropic e OpenRouter e a
  configuração BYOK atual. As chaves não entram no contexto do agente.

Cada turno cria seu próprio agente, sinal de cancelamento, fila de ferramentas
e controle de limite. O próximo turno recebe o histórico `ModelMessage[]`
persistido pelo chat, incluindo chamadas e resultados das ferramentas. O SDK
decide as próximas chamadas a partir desses resultados; as ferramentas seguem
responsáveis por confirmar o que foi aplicado e salvo.

## Política de execução

- Até 16 passos do modelo por execução; o padrão do SDK não substitui esse limite.
- Intervalo mínimo de 1.500 ms entre chamadas, incluindo a IA do planejador.
- `maxRetries: 0` evita repetir automaticamente operações após falhas.
- O mesmo `AbortSignal` interrompe stream, espera entre chamadas e ferramentas.
- Uma resposta 429 do planejador interrompe a fila e o loop. Ações já aplicadas
  permanecem; cancelar não equivale a desfazer.
- Falhas no stream são propagadas pelo consumo de `fullStream`. Consumir apenas
  `textStream` poderia esconder um erro e aceitar uma resposta parcial.
- A API pública de `ToolLoopAgent` no SDK 6 não expõe o antigo callback `onError`.
  Os erros continuam chegando ao chat; o SDK usa sua saída padrão no console.

## Fluxos estruturados

O agente chama o planejador pelas ferramentas existentes. Geração de planos,
decomposição, crítica e seleção de documentos continuam usando os schemas e as
funções pontuais de geração do AI SDK. Seus formatos, progresso e regras de
validação pertencem a esses fluxos, e não precisam de um segundo loop autônomo.

O motor continua no navegador com os stores locais. Esta etapa não adiciona
servidor, sincronização em nuvem, execução de código ou novas permissões.

## Verificação

Os testes usam o SDK real com `MockLanguageModelV3`, sem chamadas pagas, para
verificar ferramentas, histórico, streaming, cancelamento e limites. A suite
completa e o build devem passar na worktree antes de integrar a migração.

Referências fixadas na versão instalada:

- [Agentes no AI SDK 6](https://github.com/vercel/ai/blob/ai%406.0.168/content/docs/03-agents/01-overview.mdx)
- [Implementação do ToolLoopAgent 6](https://github.com/vercel/ai/blob/ai%406.0.168/packages/ai/src/agent/tool-loop-agent.ts)

A documentação publicada como Latest pode apresentar APIs de outra versão.

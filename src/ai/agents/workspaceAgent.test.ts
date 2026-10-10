import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { expect, it } from 'vitest';
import { createWorkspaceAgent, WORKSPACE_AGENT_ID } from './workspaceAgent';

it('builds a real SDK agent with the existing application tools and an isolated run', () => {
  const signal = new AbortController().signal;
  const model = new MockLanguageModelV3();
  const first = createWorkspaceAgent({ model, signal, userText: 'Organize meu projeto', onAction: () => {} });
  const second = createWorkspaceAgent({ model, signal, userText: 'Leia minhas notas', onAction: () => {} });
  expect(first.agent).toBeInstanceOf(ToolLoopAgent);
  expect(first.agent.id).toBe(WORKSPACE_AGENT_ID);
  expect(first.agent.tools).toHaveProperty('workspace_read');
  expect(first.agent.tools).toHaveProperty('workspace_action');
  expect(first.agent.tools).toHaveProperty('planner_ai');
  expect(first.agent).not.toBe(second.agent);
  expect(first.agent.tools).not.toBe(second.agent.tools);
  expect(first.assertActive).not.toThrow();
  expect(model.doStreamCalls).toHaveLength(0);
});

it('stops a run before constructing or calling the model after cancellation', () => {
  const controller = new AbortController(); controller.abort();
  const model = new MockLanguageModelV3();
  expect(() => createWorkspaceAgent({ model, signal: controller.signal, userText: 'Pare', onAction: () => {} })).toThrow();
  expect(model.doStreamCalls).toHaveLength(0);
});

it('shares the abort guard between the SDK loop and its consumer', () => {
  const controller = new AbortController();
  const run = createWorkspaceAgent({ model: new MockLanguageModelV3(), signal: controller.signal, userText: 'Leia', onAction: () => {} });
  controller.abort();
  expect(run.assertActive).toThrow();
});

it('instructs the SDK to revise the existing scoped plan and offer image choices inside chat', async () => {
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream([
    { type: 'stream-start' as const, warnings: [] },
    { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: undefined }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } },
  ]) }) });
  const { agent } = createWorkspaceAgent({ model, signal: new AbortController().signal, contextProjectId: 'requested-project', userText: 'Altere esse nó e busque imagens.', onAction: () => {} });
  const response = await agent.stream({ messages: [{ role: 'user', content: 'Altere esse nó e busque imagens.' }] });
  await response.consumeStream();
  const instructions = model.doStreamCalls[0].prompt.filter(message => message.role === 'system').map(message => message.content).join('\n');
  expect(instructions).toContain('read_plan');
  expect(instructions).toContain('update_node');
  expect(instructions).toContain('selectedNodeId');
  expect(instructions).toContain('new_plan');
  expect(instructions).toContain('carousel');
  expect(instructions).toContain('imageAnalysis');
  expect(instructions).not.toContain('Search opens the canvas gallery');
  expect(instructions).toContain('"currentProjectId":"requested-project"');
});

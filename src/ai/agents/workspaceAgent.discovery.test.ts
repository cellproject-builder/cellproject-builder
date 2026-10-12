import { expect, it } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { createWorkspaceAgent, estimateWorkspacePromptTokens } from './workspaceAgent';
import { captureChatTurnContext } from '@/chat/turnContext';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
it('starts a new general conversation with a small prefix and only discovery/read schemas', async () => {
  const context = { ...captureChatTurnContext(), excerpt: '', projectId: null, surface: 'projects' as const };
  const prefixEstimate = await estimateWorkspacePromptTokens(context);
  console.info('Fresh chat active prefix estimate:', prefixEstimate);
  expect(prefixEstimate).toBeLessThan(5000);
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] }, { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ]) }) });
  const { agent } = createWorkspaceAgent({ model, turnContext: context, signal: new AbortController().signal, userText: 'Olá', onAction() {} });
  await (await agent.stream({ messages: [{ role: 'user', content: 'Olá' }] })).consumeStream();
  expect(model.doStreamCalls[0].tools?.map(tool => tool.name)).toEqual(['workspace_read', 'planner_read', 'enable_capabilities']);
});

it('discovers capabilities on demand in the real SDK and keeps the enable state local to the run', async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ === 0 ? [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'enable-plan', toolName: 'enable_capabilities', input: JSON.stringify({ capabilities: ['plan'] }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ] : [{ type: 'stream-start', warnings: [] }, { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]) }) });
  const { agent } = createWorkspaceAgent({ model, signal: new AbortController().signal, userText: 'Revise o plano', onAction() {} });
  await (await agent.stream({ messages: [{ role: 'user', content: 'Revise o plano' }] })).consumeStream();
  const names = model.doStreamCalls[1].tools?.map(tool => tool.name);
  expect(names).toContain('planner_action'); expect(names).toContain('planner_structure');
  expect(names).not.toContain('workspace_action'); expect(names).not.toContain('visual_action');
  const fresh = createWorkspaceAgent({ model, signal: new AbortController().signal, userText: 'Olá', onAction() {} });
  await (await fresh.agent.stream({ messages: [{ role: 'user', content: 'Olá' }] })).consumeStream();
  expect(model.doStreamCalls[2].tools?.map(tool => tool.name)).not.toContain('planner_action');
});

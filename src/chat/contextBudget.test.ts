import { expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { ChatContextBudgetError, estimateChatTokens, prepareChatContext, type ChatCompactionCheckpoint, type ChatSummarizer } from './contextBudget';

const signal = () => new AbortController().signal;
const turns = (count: number, size = 300): ModelMessage[] => Array.from({ length: count }, (_, n) => [
  { role: 'user' as const, content: `Pedido ${n}: ${'x'.repeat(size)}` },
  { role: 'assistant' as const, content: `Resultado ${n}: ${'y'.repeat(size)}` },
]).flat();
const budget = { contextWindowTokens: 4096, fixedTokens: 0, outputReserveTokens: 256, safetyTokens: 128 };
const summary: ChatSummarizer = async () => 'Objetivo: rever a montagem. Decisão: manter os servos MG90S. Próximo passo: medir os encaixes.';

it('keeps a small conversation unchanged and never calls the summarizer', async () => {
  const history = turns(2, 20), summarize = vi.fn(summary);
  const result = await prepareChatContext(history, { signal: signal(), modelKey: 'openai:fixture', summarize, ...budget });
  expect(result.history).toEqual(history);
  expect(result.checkpoint).toBeNull();
  expect(result.usage.compacted).toBe(false);
  expect(result.usage.thresholdTokens).toBe(Math.floor(4096 * .6));
  expect(summarize).not.toHaveBeenCalled();
});

it('compacts old complete turns at 60% while preserving recent messages and the original transcript', async () => {
  const history = turns(8), original = structuredClone(history), summarize = vi.fn(summary);
  const result = await prepareChatContext(history, { signal: signal(), modelKey: 'openai:fixture', summarize, ...budget });
  expect(summarize).toHaveBeenCalledOnce();
  expect(summarize.mock.calls[0][0].messages).toEqual(history.slice(0, -4));
  expect(result.history.slice(-4)).toEqual(history.slice(-4));
  expect(history).toEqual(original);
  expect(result.history.length).toBe(5);
  expect(result.checkpoint).toMatchObject({ version: 1, modelKey: 'openai:fixture', window: 1, summarizedMessages: 12 });
  expect(result.usage.compacted).toBe(true);
  expect(result.usage.estimatedInputTokens).toBeLessThan(estimateChatTokens(history));
});

it('incrementally summarizes only newly old turns and supplies the previous memory once', async () => {
  const first = await prepareChatContext(turns(8), { signal: signal(), summarize: summary, modelKey: 'openai:fixture', ...budget });
  const summarize = vi.fn(summary), history = [...first.history, ...turns(6)];
  const result = await prepareChatContext(history, { signal: signal(), summarize, checkpoint: first.checkpoint, modelKey: 'openai:fixture', ...budget });
  expect(summarize.mock.calls[0][0].previousSummary).toBe(first.checkpoint!.summary);
  expect(summarize.mock.calls[0][0].messages).toEqual(history.slice(1, -4));
  expect(result.checkpoint!.window).toBe(2);
  expect(JSON.stringify(result.history).match(/application-generated conversation memory/g)).toHaveLength(1);
});

it('keeps tool call/result groups complete on both sides of the checkpoint', async () => {
  const toolTurn: ModelMessage[] = [
    { role: 'user', content: 'Leia o plano.' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read-1', toolName: 'planner_action', input: { action: 'read_plan' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'read-1', toolName: 'planner_action', output: { type: 'json', value: { nodes: [] } } }] },
    { role: 'assistant', content: 'Lido.' },
  ];
  const summarize = vi.fn(summary), history = [...turns(6), ...toolTurn, ...turns(1, 10)];
  const result = await prepareChatContext(history, { signal: signal(), summarize, ...budget });
  expect(result.history.slice(1)).toEqual([...toolTurn, ...turns(1, 10)]);
  expect(JSON.stringify(summarize.mock.calls[0][0].messages)).not.toContain('read-1');
});

it('does not summarize or discard the current large request to force it into the window', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'x'.repeat(20_000) }], summarize = vi.fn(summary);
  await expect(prepareChatContext(history, { signal: signal(), summarize, ...budget })).rejects.toBeInstanceOf(ChatContextBudgetError);
  expect(summarize).not.toHaveBeenCalled();
  expect(history[0].content).toHaveLength(20_000);
});

it('counts embedded data URLs as full text inside tool JSON rather than a multimedia allowance', async () => {
  const dataUrl = `data:image/png;base64,${'a'.repeat(100_000)}`;
  const history: ModelMessage[] = [
    { role: 'user', content: 'Leia a nota.' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read-note', toolName: 'workspace_read', input: { collection: 'notes', id: 'one' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'read-note', toolName: 'workspace_read', output: { type: 'json', value: { blocks: [{ text: dataUrl }] } } }] },
  ];
  const summarize = vi.fn(summary);
  expect(estimateChatTokens(history)).toBeGreaterThan(50_000);
  expect(estimateChatTokens([{ role: 'user', content: dataUrl }])).toBeGreaterThan(50_000);
  await expect(prepareChatContext(history, { signal: signal(), summarize, ...budget })).rejects.toBeInstanceOf(ChatContextBudgetError);
  expect(summarize).not.toHaveBeenCalled();
});

it('allows a first request above the soft threshold when it still fits the hard budget', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'x'.repeat(5_000) }], summarize = vi.fn(summary);
  const result = await prepareChatContext(history, { signal: signal(), summarize, ...budget });
  expect(result.history).toEqual(history);
  expect(result.usage.percent).toBeGreaterThan(60);
  expect(summarize).not.toHaveBeenCalled();
});

it('includes instructions, tools, snapshot and output reserves without duplicating the fresh context', async () => {
  const history = turns(3, 100), context = { surface: 'notes', noteId: 'actual-note' }, summarize = vi.fn(summary);
  const result = await prepareChatContext(history, { signal: signal(), summarize, ...budget, fixedTokens: 400, systemContext: 'Rules', context });
  expect(result.usage.estimatedInputTokens).toBeGreaterThan(estimateChatTokens(history) + 400);
  expect(result.usage.remainingTokens).toBe(4096 - result.usage.estimatedInputTokens - 256 - 128);
  expect(JSON.stringify(result.history)).not.toContain('actual-note');
});

it('reports a conservative fallback as a budget estimate rather than a known model window', async () => {
  const result = await prepareChatContext(turns(1, 10), { signal: signal(), modelKey: 'openrouter:unknown/model', summarize: summary });
  expect(result.usage.contextWindowSource).toBe('fallback');
  expect(result.usage.contextWindowTokens).toBe(32_768);
  expect(result.usage.modelKey).toBe('openrouter:unknown/model');
});

it('recalculates budget when provider/model changes without clearing the previous memory', async () => {
  const first = await prepareChatContext(turns(8), { signal: signal(), summarize: summary, modelKey: 'openai:large', ...budget });
  const result = await prepareChatContext(first.history, { signal: signal(), checkpoint: first.checkpoint, modelKey: 'anthropic:other', summarize: summary, ...budget, contextWindowTokens: 8192 });
  expect(result.checkpoint).toEqual(first.checkpoint);
  expect(result.history).toEqual(first.history);
  expect(result.usage.modelKey).toBe('anthropic:other');
  expect(result.usage.contextWindowTokens).toBe(8192);
});

it.each(['', '   ', 'x'.repeat(9_000)])('rejects invalid summary candidate and leaves history/checkpoint untouched', async (text) => {
  const history = turns(8), original = structuredClone(history);
  const checkpoint: ChatCompactionCheckpoint = { version: 1, summary: 'Memória anterior', modelKey: 'openai:fixture', window: 1, summarizedMessages: 2, createdAt: 1 };
  const copy = structuredClone(checkpoint);
  await expect(prepareChatContext(history, { signal: signal(), checkpoint, summarize: async () => text, ...budget })).rejects.toBeInstanceOf(ChatContextBudgetError);
  expect(history).toEqual(original);
  expect(checkpoint).toEqual(copy);
});

it('propagates summary failures and never substitutes a truncated history', async () => {
  const history = turns(8), original = structuredClone(history), error = new Error('Capacity');
  await expect(prepareChatContext(history, { signal: signal(), summarize: async () => { throw error; }, ...budget })).rejects.toBe(error);
  expect(history).toEqual(original);
});

it('honors cancellation before and after the summary request without committing a checkpoint', async () => {
  const before = new AbortController(); before.abort(); const summarize = vi.fn(summary);
  await expect(prepareChatContext(turns(8), { signal: before.signal, summarize, ...budget })).rejects.toMatchObject({ name: 'AbortError' });
  expect(summarize).not.toHaveBeenCalled();
  const during = new AbortController();
  await expect(prepareChatContext(turns(8), { signal: during.signal, summarize: async () => { during.abort(); return 'Resumo'; }, ...budget })).rejects.toMatchObject({ name: 'AbortError' });
});

it('rejects oversized fresh context before any paid summary call', async () => {
  const summarize = vi.fn(summary);
  await expect(prepareChatContext(turns(8), { signal: signal(), summarize, context: { description: 'x'.repeat(20_000) }, ...budget })).rejects.toBeInstanceOf(ChatContextBudgetError);
  expect(summarize).not.toHaveBeenCalled();
});

it('uses a server-observed input baseline only for the matching model and estimates new items', async () => {
  const history = turns(2, 10), previousUsage = { modelKey: 'openai:fixture', inputTokens: 2000, historyMessageCount: 2 };
  const result = await prepareChatContext(history, { signal: signal(), summarize: summary, modelKey: 'openai:fixture', previousUsage, ...budget });
  expect(result.usage.estimatedInputTokens).toBeGreaterThanOrEqual(2000 + estimateChatTokens(history.slice(2)));
  const changed = await prepareChatContext(history, { signal: signal(), summarize: summary, modelKey: 'anthropic:fixture', previousUsage, ...budget });
  expect(changed.usage.estimatedInputTokens).toBeLessThan(2000);
});

it('counts multimodal references conservatively and treats their token count as an estimate', async () => {
  const text: ModelMessage[] = [{ role: 'user', content: 'Veja.' }];
  const image: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Veja.' }, { type: 'image', image: new URL('https://example.com/image.png') }] }];
  expect(estimateChatTokens(image)).toBeGreaterThan(estimateChatTokens(text) + 1500);
});

it('summarizes a legacy long transcript in bounded complete-turn batches before committing once', async () => {
  const history = turns(30), original = structuredClone(history), summarize = vi.fn(summary);
  const result = await prepareChatContext(history, { signal: signal(), summarize, ...budget });
  expect(summarize.mock.calls.length).toBeGreaterThan(1);
  expect(summarize.mock.calls.flatMap(([request]) => request.messages)).toEqual(history.slice(0, -4));
  for (const [request] of summarize.mock.calls) {
    expect(request.messages[0].role).toBe('user');
    expect(request.messages.at(-1)!.role).toBe('assistant');
    expect(estimateChatTokens(request.messages)).toBeLessThan(4096 - 256 - 128 - request.maxSummaryTokens - 1024);
  }
  expect(result.checkpoint!.window).toBe(1);
  expect(history).toEqual(original);
});

it('preserves the entire input if a later summary batch fails', async () => {
  const history = turns(30), original = structuredClone(history); let calls = 0;
  await expect(prepareChatContext(history, { signal: signal(), summarize: async () => { if (calls++) throw new Error('secondBatchFailed'); return 'Decisão preservada.'; }, ...budget })).rejects.toThrow('secondBatchFailed');
  expect(history).toEqual(original);
});

it('refuses a tool call split across human turns rather than silently orphaning either side', async () => {
  const history: ModelMessage[] = [...turns(6),
    { role: 'user', content: 'Leia.' },
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'read', toolCallId: 'split', input: {} }] },
    { role: 'user', content: 'Continuar.' },
    { role: 'tool', content: [{ type: 'tool-result', toolName: 'read', toolCallId: 'split', output: { type: 'text', value: 'Resultado' } }] },
    ...turns(1),
  ];
  const summarize = vi.fn(summary);
  await expect(prepareChatContext(history, { signal: signal(), summarize, ...budget })).rejects.toThrow('chatContextIncompleteTools');
  expect(summarize).not.toHaveBeenCalled();
});

it('honors a model catalog window and reserves enough space for a reasoning output', async () => {
  const result = await prepareChatContext(turns(1, 10), { signal: signal(), summarize: summary, contextWindowTokens: 100_000, contextWindowSource: 'catalog', outputReserveTokens: 7000 });
  expect(result.usage.contextWindowSource).toBe('catalog');
  expect(result.usage.remainingTokens).toBe(100_000 - 7000 - 2048 - result.usage.estimatedInputTokens);
});

it('keeps high-density Unicode inside the conservative text estimate', () => {
  expect(estimateChatTokens([{ role: 'user', content: '漢字'.repeat(200) }])).toBeGreaterThan(600);
});

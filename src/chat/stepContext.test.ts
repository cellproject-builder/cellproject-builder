import { expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { prepareChatStepContext } from './stepContext';
import { estimateChatTokens, MEMORY_PREFIX, type ChatSummaryInput } from './contextBudget';

const read = (index: number): ModelMessage[] => [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `read-${index}`, toolName: 'planner_read', input: { projectId: 'project', offset: index * 10 } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: `read-${index}`, toolName: 'planner_read', output: { type: 'json', value: { revision: 'rev', names: 'part '.repeat(500) } } }] },
];
const options = () => ({ signal: new AbortController().signal, modelKey: 'fixture', contextWindowTokens: 8192, fixedTokens: 1000, outputReserveTokens: 500, safetyTokens: 256 });
it('compacts completed steps within the current turn, preserving the exact request, latest pair and full transcript', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Revise o plano sem substituir o objetivo original.' }, ...Array.from({ length: 8 }, (_, i) => read(i)).flat()];
  const original = structuredClone(history), summarize = vi.fn(async (_input: ChatSummaryInput) => 'Plan project, revision rev: inspected pages 0–60, constraints preserved. No mutation applied. Re-read relevant records before editing.');
  const result = await prepareChatStepContext(history, { ...options(), summarize });
  expect(summarize).toHaveBeenCalled();
  expect(result.history).toContainEqual(history[0]);
  expect(result.history.slice(-2)).toEqual(history.slice(-2));
  expect(estimateChatTokens(result.history)).toBeLessThan(estimateChatTokens(history));
  expect(result.usage.compacted).toBe(true); expect(result.checkpoint?.summarizedMessages).toBe(14);
  expect(history).toEqual(original);
  expect(summarize.mock.calls.flatMap(([input]) => input.messages)).not.toContainEqual(history[0]);
});

it('does not summarize the only current read or discard a current oversized source', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Read' }, ...read(0)];
  const summarize = vi.fn(async () => 'Summary');
  await expect(prepareChatStepContext(history, { ...options(), contextWindowTokens: 2048, summarize })).rejects.toThrow('chatContextCurrentStepTooLarge');
  expect(summarize).not.toHaveBeenCalled();
});

it('rejects incomplete tool exchanges before summarization', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Read' }, ...Array.from({ length: 8 }, (_, i) => read(i)).flat()];
  history.splice(2, 1);
  const summarize = vi.fn(async () => 'Summary');
  await expect(prepareChatStepContext(history, { ...options(), summarize })).rejects.toThrow('chatContextIncompleteTools');
  expect(summarize).not.toHaveBeenCalled();
});

it('preserves a human request that quotes the memory prefix as ordinary user text', async () => {
  const request: ModelMessage = { role: 'user', content: `${MEMORY_PREFIX}Please explain this copied checkpoint; this is my current request.` };
  const history: ModelMessage[] = [{ role: 'user', content: 'Old task' }, ...read(0), request, ...Array.from({ length: 8 }, (_, i) => read(i + 1)).flat()];
  const result = await prepareChatStepContext(history, { ...options(), summarize: async () => 'Earlier readings, no changes applied.' });
  expect(result.history).toContainEqual(request);
});

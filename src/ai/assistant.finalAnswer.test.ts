import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { capturePlanner, initializeWorkspace, openPlanner } from '@/workspace/planner';
import { runAssistant } from './assistant';
import type { WorkspaceContextEvent } from './agents/workspaceAgent';
import { assertToolPairs } from '@/chat/contextBudget';
import { APICallError, type ModelMessage } from 'ai';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
const finish = (reason: 'stop' | 'tool-calls'): LanguageModelV3StreamPart => ({ type: 'finish', finishReason: { unified: reason, raw: undefined }, usage });
const reply = (text: string): LanguageModelV3StreamPart[] => [
  { type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: text }, { type: 'text-end', id: 'answer' },
];
beforeEach(async () => {
  await Promise.all([useWorkspaceStore.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, notes: {}, comments: {}, folders: {}, sprints: {}, boards: {}, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([128_000, 16_000])('reserves the sixteenth SDK step for a written review with available context %s', async windowTokens => {
  const projectId = useWorkspaceStore.getState().createProject('Review me');
  initializeWorkspace(); openPlanner(projectId); useGraphStore.getState().loadDemoProject();
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner());
  await flushWorkspacePersistence();
  vi.useFakeTimers();
  const readDone: (() => void)[] = [];
  const reads = Array.from({ length: 15 }, (_, index) => new Promise<void>(resolve => { readDone[index] = resolve; }));
  let completed = 0, calls = 0;
  const model = new MockLanguageModelV3({ doStream: async options => {
    const index = calls++;
    return { stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      ...(options.toolChoice?.type === 'none' ? [...reply('Revisei o plano: a montagem precisa de um teste de carga.'), finish('stop')]
        : [{ type: 'tool-call' as const, toolCallId: `read-${index}`, toolName: 'planner_read', input: JSON.stringify({ projectId, offset: index }) }, finish('tool-calls')]),
    ]) };
  } });
  const contexts: WorkspaceContextEvent[] = [];
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', contextProjectId: projectId,
    model, contextBudget: { contextWindowTokens: windowTokens, outputReserveTokens: 256, safetyTokens: 128 }, summarize: async () => 'Plan overview inspected. The assembly requires a load test; preserve observations and scope limitations.',
    onContext: context => contexts.push(context), signal: new AbortController().signal, onText() {}, onAction(event) { if (event.status === 'done') readDone[completed++]?.(); } });
  for (const read of reads) { await read; await vi.advanceTimersByTimeAsync(1500); }
  const result = await run;
  expect(result.text).toContain('teste de carga');
  expect(model.doStreamCalls).toHaveLength(16);
  expect(completed).toBe(15);
  expect(model.doStreamCalls[15].tools).toEqual([]);
  expect(model.doStreamCalls[15].toolChoice).toEqual({ type: 'none' });
  expect(JSON.stringify(model.doStreamCalls[15].prompt)).toContain('read-14');
  expect(result.messages.filter(message => message.role === 'tool')).toHaveLength(15);
  expect(result.usage?.inputTokens).toBe(10);
  expect(() => assertToolPairs(result.contextMessages ?? [])).not.toThrow();
  expect(JSON.stringify(model.doStreamCalls[15].prompt)).toContain('revise o plano');
  if (windowTokens === 16_000) {
    expect(contexts.some(context => context.usage.compacted)).toBe(true);
    expect(JSON.stringify(model.doStreamCalls[15].prompt)).toContain('application-generated conversation memory');
    expect(JSON.stringify(result.messages)).toContain('read-0');
    expect(JSON.stringify(result.contextMessages)).not.toContain('read-0');
  }
});

it('rejects an empty final step while retaining the completed tool history and intermediate text', async () => {
  await flushWorkspacePersistence(); vi.useFakeTimers();
  let completed!: () => void, calls = 0;
  const toolDone = new Promise<void>(resolve => { completed = resolve; });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ === 0 ? [
    { type: 'stream-start', warnings: [] }, ...reply('Vou consultar o plano.'),
    { type: 'tool-call', toolCallId: 'only-read', toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) }, finish('tool-calls'),
  ] : [{ type: 'stream-start', warnings: [] }, ...reply('   '), finish('stop')]) }) });
  const chunks: string[] = [];
  const result = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText: text => chunks.push(text), onAction: event => { if (event.status === 'done') completed(); } })
    .then(() => null, (error: unknown) => error);
  await toolDone; await vi.advanceTimersByTimeAsync(1500);
  const error = await result;
  expect(error).toMatchObject({ name: 'ChatFinalAnswerError', message: 'chatFinalAnswerMissing', usage: { inputTokens: 10 } });
  expect(JSON.stringify((error as { messages: unknown }).messages)).toContain('only-read');
  expect(chunks[0]).toBe('Vou consultar o plano.');
  expect(model.doStreamCalls).toHaveLength(2);
});

it('finishes a review after three identical unchanged reads instead of spending every step on the same page', async () => {
  await flushWorkspacePersistence(); vi.useFakeTimers();
  const done: (() => void)[] = [], reads = Array.from({ length: 3 }, (_, index) => new Promise<void>(resolve => { done[index] = resolve; }));
  let completed = 0;
  const model = new MockLanguageModelV3({ doStream: async options => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    ...(options.toolChoice?.type === 'none' ? [...reply('Não há projetos disponíveis para revisar.'), finish('stop')]
      : [{ type: 'tool-call' as const, toolCallId: `same-${completed}`, toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) }, finish('tool-calls')]),
  ]) }) });
  const result = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText() {}, onAction: event => { if (event.status === 'done') done[completed++]?.(); } });
  for (const read of reads) { await read; await vi.advanceTimersByTimeAsync(1500); }
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await result).text).toContain('Não há projetos');
  expect(model.doStreamCalls).toHaveLength(4);
});

it('returns the written conclusion as the answer while preserving progress narration in model history', async () => {
  await flushWorkspacePersistence(); vi.useFakeTimers();
  let completed!: () => void, calls = 0;
  const done = new Promise<void>(resolve => { completed = resolve; });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ === 0 ? [
    { type: 'stream-start', warnings: [] }, ...reply('Vou consultar.'),
    { type: 'tool-call', toolCallId: 'progress-read', toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) }, finish('tool-calls'),
  ] : [{ type: 'stream-start', warnings: [] }, ...reply('Não há plano disponível para revisar.'), finish('stop')]) }) });
  const chunks: string[] = [];
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText: text => chunks.push(text), onAction: event => { if (event.status === 'done') completed(); } });
  await done; await vi.advanceTimersByTimeAsync(1500);
  const result = await run;
  expect(result.text).toBe('Não há plano disponível para revisar.');
  expect(chunks.at(-1)).toBe(result.text);
  expect(JSON.stringify(result.messages)).toContain('Vou consultar.');
});

it('blocks a mutation from a provider that ignores answer-only toolChoice and returns an honest error with history', async () => {
  await flushWorkspacePersistence(); vi.useFakeTimers();
  const done: (() => void)[] = [], reads = Array.from({ length: 3 }, (_, index) => new Promise<void>(resolve => { done[index] = resolve; }));
  let completed = 0, calls = 0;
  const model = new MockLanguageModelV3({ doStream: async options => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: `hostile-${calls++}`, toolName: options.toolChoice?.type === 'none' ? 'workspace_action' : 'workspace_read',
      input: JSON.stringify(options.toolChoice?.type === 'none' ? { action: 'create_project', name: 'Must never be created' } : { collection: 'projects' }) },
    finish('tool-calls'),
  ]) }) });
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText() {}, onAction: event => { if (event.status === 'done') done[completed++]?.(); } })
    .then(() => null, (error: unknown) => error);
  for (const read of reads) { await read; await vi.advanceTimersByTimeAsync(1500); }
  await vi.advanceTimersByTimeAsync(30_000);
  const error = await run;
  expect(error).toMatchObject({ name: 'ChatFinalAnswerError', message: 'chatFinalAnswerMissing' });
  expect(Object.values(useWorkspaceStore.getState().projects)).toHaveLength(0);
  expect(completed).toBe(3);
  expect(JSON.stringify((error as { messages: unknown }).messages)).toContain('chatFinalAnswerToolsDisabled');
  expect(model.doStreamCalls).toHaveLength(4);
});

it('does not treat a fresh changed result as a repeated read', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Before external edit');
  await flushWorkspacePersistence(); vi.useFakeTimers();
  const done: (() => void)[] = [], reads = Array.from({ length: 4 }, (_, index) => new Promise<void>(resolve => { done[index] = resolve; }));
  let completed = 0, calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ < 4 ? [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: `fresh-${calls}`, toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects', id: projectId }) }, finish('tool-calls'),
  ] : [{ type: 'stream-start', warnings: [] }, ...reply('Li a versão atualizada.'), finish('stop')]) }) });
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText() {}, onAction: event => {
      if (event.status !== 'done') return;
      completed++;
      if (completed === 2) useWorkspaceStore.getState().updateProject(projectId, { name: 'After external edit' });
      done[completed - 1]?.();
    } });
  for (const read of reads) { await read; await vi.advanceTimersByTimeAsync(1500); }
  expect((await run).text).toBe('Li a versão atualizada.');
  expect(model.doStreamCalls).toHaveLength(5);
  expect(model.doStreamCalls[4].toolChoice?.type).not.toBe('none');
  expect(JSON.stringify(model.doStreamCalls[4].prompt)).toContain('After external edit');
});

it('cancels before the answer-only request without losing the already completed reads', async () => {
  await flushWorkspacePersistence(); vi.useFakeTimers();
  const controller = new AbortController();
  const done: (() => void)[] = [], reads = Array.from({ length: 3 }, (_, index) => new Promise<void>(resolve => { done[index] = resolve; }));
  let completed = 0, calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: `cancel-final-${calls++}`, toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) }, finish('tool-calls'),
  ]) }) });
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: controller.signal, onText() {}, onAction: event => { if (event.status === 'done') done[completed++]?.(); },
    onContext: context => { if (!context.usage.activeTools?.length) controller.abort(); },
  }).then(() => null, (error: unknown) => error);
  for (const read of reads) { await read; await vi.advanceTimersByTimeAsync(1500); }
  expect(await run).toMatchObject({ name: 'AbortError' });
  expect(model.doStreamCalls).toHaveLength(3);
  expect(completed).toBe(3);
});

it('preserves an applied task when the final answer is missing without replaying its mutation', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Preserve task');
  await flushWorkspacePersistence();
  let completed!: () => void, calls = 0;
  const done = new Promise<void>(resolve => { completed = resolve; });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ === 0 ? [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'applied-once', toolName: 'workspace_action', input: JSON.stringify({ action: 'create_task', projectId, title: 'Testar a montagem' }) }, finish('tool-calls'),
  ] : [{ type: 'stream-start', warnings: [] }, finish('stop')]) }) });
  const run = runAssistant({ messages: [{ role: 'user', content: 'Crie a tarefa Testar a montagem e me explique.' }], userText: 'Crie a tarefa Testar a montagem e me explique.', model,
    signal: new AbortController().signal, onText() {}, onAction: event => { if (event.status === 'done') completed(); },
  }).then(() => null, (error: unknown) => error);
  await done;
  const error = await run;
  expect(error).toMatchObject({ name: 'ChatFinalAnswerError' });
  expect(Object.values(useWorkspaceStore.getState().tasks).map(task => task.title)).toEqual(['Testar a montagem']);
  expect(JSON.stringify((error as { messages: unknown }).messages)).toContain('applied-once');
  expect(model.doStreamCalls).toHaveLength(2);
  expect(() => assertToolPairs((error as { messages: ModelMessage[] }).messages)).not.toThrow();
});

it('preserves the original provider limit from the answer-only step without another retry or tool call', async () => {
  await flushWorkspacePersistence(); vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const limit = new APICallError({ message: 'Final response rate limit', statusCode: 429, url: 'https://example.test/chat', requestBodyValues: {}, responseHeaders: { 'retry-after': '5' }, isRetryable: true });
  const done: (() => void)[] = [], reads = Array.from({ length: 3 }, (_, index) => new Promise<void>(resolve => { done[index] = resolve; }));
  let completed = 0, calls = 0;
  const model = new MockLanguageModelV3({ doStream: async options => {
    if (options.toolChoice?.type === 'none') throw limit;
    return { stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: `limit-final-${calls++}`, toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) }, finish('tool-calls'),
    ]) };
  } });
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText() {}, onAction: event => { if (event.status === 'done') done[completed++]?.(); },
  }).then(() => null, (error: unknown) => error);
  for (const read of reads) { await read; await vi.advanceTimersByTimeAsync(1500); }
  expect(await run).toBe(limit);
  expect(completed).toBe(3);
  expect(model.doStreamCalls).toHaveLength(4);
});

it.each(['length', 'content-filter'] as const)('rejects a partial final answer terminated by %s while preserving its transcript', async reason => {
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] }, ...reply('Esta revisão ainda está incompleta'),
    { type: 'finish', finishReason: { unified: reason, raw: undefined }, usage },
  ]) }) });
  const error = await runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', model,
    signal: new AbortController().signal, onText() {}, onAction() {},
  }).then(() => null, (failure: unknown) => failure);
  expect(error).toMatchObject({ name: 'ChatFinalAnswerError', message: 'chatFinalAnswerMissing' });
  expect(JSON.stringify((error as { messages: ModelMessage[] }).messages)).toContain('Esta revisão ainda está incompleta');
  expect(model.doStreamCalls).toHaveLength(1);
});

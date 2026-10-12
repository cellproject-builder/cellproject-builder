import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import * as client from './client';
import * as service from './service';
import { runAssistant } from './assistant';
import { useConfigStore } from '@/config/store';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace, openPlanner } from '@/workspace/planner';
import { useKBStore } from '@/kb/store';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, notes: {}, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
});
afterEach(() => vi.restoreAllMocks());

it('aborts in-flight planner work on model drift before applying its late result and cleans up its subscription', async () => {
  const previous = useConfigStore.getState();
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'SYNTHETIC_LOCAL_ONLY', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } });
  const projectId = useWorkspaceStore.getState().createProject('Drift test'); openPlanner(projectId);
  useGraphStore.getState().loadDemoProject();
  const project = useGraphStore.getState().project!, nodeId = project.rootId;
  let release!: (value: Awaited<ReturnType<typeof service.decomposeNode>>) => void, started!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
  const decompose = vi.spyOn(service, 'decomposeNode').mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'pending-decomposition', toolName: 'planner_ai', input: JSON.stringify({ action: 'decompose_node', projectId, nodeId }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ]) }) });
  vi.spyOn(client, 'aiModel', 'get').mockReturnValue(model);
  const unsubscribe = vi.fn(), originalSubscribe = useConfigStore.subscribe;
  vi.spyOn(useConfigStore, 'subscribe').mockImplementation(listener => {
    const off = originalSubscribe(listener); return () => { off(); unsubscribe(); };
  });
  const events: string[] = [];
  const failure = runAssistant({ messages: [{ role: 'user', content: 'Decompose this part' }], userText: 'Decompose this part',
    signal: new AbortController().signal, onText: () => {}, onAction: event => events.push(`${event.action}:${event.status}`),
  }).then(() => null, (error: unknown) => error);
  try {
    await begun;
    useConfigStore.setState({ providers: { openai: { apiKey: 'SYNTHETIC_LOCAL_ONLY', mainModel: 'gpt-4o-mini', kbModel: 'gpt-4o-mini' } } });
    expect(decompose.mock.calls[0][2]?.signal?.aborted).toBe(true);
    release({ nodes: [{ tempId: 'late', kind: 'passo', name: 'Must not stage', fx: '', problem: '', confidence: 10, confidenceReason: '', pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '' }], edges: [] });
    expect(await failure).toMatchObject({ message: 'chatContextModelChanged' });
    await vi.waitFor(() => expect(events).toContain('decompose_node:error'));
    expect(useGraphStore.getState().pendingSuggestions).toBeNull();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { useConfigStore.setState(previous); }
});

it.each(['success', 'provider error'])('cleans up the model subscription and external abort listener after %s', async outcome => {
  const previous = useConfigStore.getState();
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'SYNTHETIC_LOCAL_ONLY', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } });
  const failure = new Error('Synthetic provider failure');
  const model = new MockLanguageModelV3({ doStream: async () => {
    if (outcome === 'provider error') throw failure;
    return { stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'hello-answer' }, { type: 'text-delta', id: 'hello-answer', delta: 'Olá.' }, { type: 'text-end', id: 'hello-answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ]) };
  } });
  vi.spyOn(client, 'aiModel', 'get').mockReturnValue(model);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const unsubscribe = vi.fn(), originalSubscribe = useConfigStore.subscribe;
  vi.spyOn(useConfigStore, 'subscribe').mockImplementation(listener => {
    const off = originalSubscribe(listener); return () => { off(); unsubscribe(); };
  });
  const controller = new AbortController(), removed = vi.spyOn(controller.signal, 'removeEventListener');
  try {
    const result = await runAssistant({ messages: [{ role: 'user', content: 'Hello' }], userText: 'Hello', signal: controller.signal, onText: () => {}, onAction: () => {} })
      .then(value => value, (error: unknown) => error);
    if (outcome === 'provider error') expect(result).toBe(failure);
    else expect(result).toMatchObject({ text: 'Olá.', usage: { inputTokens: 10 } });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  } finally { useConfigStore.setState(previous); }
});

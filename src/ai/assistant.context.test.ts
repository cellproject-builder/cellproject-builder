import { beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { useWorkspaceStore } from '@/workspace/store';
import { EMPTY_OBJECTIVE_DRAFT, useGraphStore } from '@/store';
import { capturePlanner, initializeWorkspace, openPlanner, readPlanner } from '@/workspace/planner';
import { runAssistant } from './assistant';
import type { WorkspaceContextEvent } from './agents/workspaceAgent';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
beforeEach(async () => {
  await useWorkspaceStore.persist.rehydrate(); await useGraphStore.persist.rehydrate();
  useWorkspaceStore.setState({ projects: {}, notes: {}, tasks: {}, folders: {}, comments: {}, boards: {}, sprints: {} });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
});
it('reviews a new contextual plan conversation, applies once, compacts completed reads and keeps compact overrides across SDK steps', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Robot', 'Investigate the assembly before claiming it works');
  initializeWorkspace(); openPlanner(projectId); useGraphStore.getState().loadDemoProject();
  const plan = useGraphStore.getState().project!, nodeId = Object.keys(plan.nodes).find(id => id !== plan.rootId)!;
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner());
  const request = 'Revise o plano: renomeie a parte selecionada para Montagem revisada, preservando as premissas e o restante do plano.';
  let calls = 0;
  const call = (toolCallId: string, toolName: string, input: unknown): LanguageModelV3StreamPart => ({ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    ...(calls === 0 ? [call('discover', 'enable_capabilities', { capabilities: ['plan'] }), call('read-first', 'planner_read', { projectId })]
      : calls === 1 ? [call('apply-once', 'planner_action', { action: 'update_node', projectId, nodeId, patch: { name: 'Montagem revisada' } }), call('read-second', 'planner_read', { projectId, offset: 10 })]
        : calls === 2 ? [call('read-third', 'planner_read', { projectId, offset: 20 })] : [
          { type: 'text-start' as const, id: 'review-answer' }, { type: 'text-delta' as const, id: 'review-answer', delta: 'Montagem revisada foi aplicada. As premissas ainda exigem testes físicos.' }, { type: 'text-end' as const, id: 'review-answer' },
        ]),
    { type: 'finish', finishReason: { unified: calls++ < 3 ? 'tool-calls' : 'stop', raw: undefined }, usage },
  ]) }) });
  const contexts: WorkspaceContextEvent[] = [], events: unknown[] = [];
  const summarize = vi.fn(async () => `Project ${projectId}: earlier plan pages inspected. Node ${nodeId} was renamed to Montagem revisada (already applied); preserve the objective and other nodes. Read current records before another change.`);
  const result = await runAssistant({ messages: [{ role: 'user', content: request }], userText: request, contextProjectId: projectId, model,
    signal: new AbortController().signal, contextBudget: { contextWindowTokens: 16_000, outputReserveTokens: 256, safetyTokens: 128 }, summarize,
    onText() {}, onAction: event => events.push(event), onContext: context => contexts.push(context) });
  expect(model.doStreamCalls).toHaveLength(4); expect(summarize).toHaveBeenCalled();
  expect(contexts[0].usage.percent).toBeLessThan(35); expect(contexts.some(context => context.usage.compacted)).toBe(true);
  for (const index of [2, 3]) {
    const prompt = JSON.stringify(model.doStreamCalls[index].prompt);
    expect(prompt).toContain('application-generated conversation memory'); expect(prompt).not.toContain('read-first'); expect(prompt).toContain(request);
  }
  expect(JSON.stringify(result.messages)).toContain('read-first');
  expect(JSON.stringify(result.contextMessages)).not.toContain('read-first');
  expect(JSON.stringify(result.contextMessages)).toContain('Montagem revisada');
  expect(readPlanner(projectId).project?.nodes[nodeId].name).toBe('Montagem revisada');
  expect(Object.keys(readPlanner(projectId).project!.nodes)).toEqual(Object.keys(plan.nodes));
  expect(events.filter((event: any) => event.name === 'planner_action' && event.status === 'done')).toHaveLength(1);
  expect(events.filter((event: any) => event.name === 'planner_read' && event.status === 'done').every((event: any) => event.result === undefined)).toBe(true);
}, 12_000);

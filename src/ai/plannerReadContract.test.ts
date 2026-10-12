import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { capturePlanner, initializeWorkspace, openPlanner } from '@/workspace/planner';
import { captureChatTurnContext } from '@/chat/turnContext';
import { runAssistant } from './assistant';
import { createAssistantTools } from './workspaceTools';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, stepCountIs } from 'ai';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, notes: {}, folders: {}, comments: {}, boards: {}, sprints: {}, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function currentPlan() {
  const projectId = useWorkspaceStore.getState().createProject('Workspace project');
  initializeWorkspace(); openPlanner(projectId); useGraphStore.getState().loadDemoProject();
  const original = useGraphStore.getState().project!;
  useGraphStore.setState({ project: { ...original, id: 'distinct-plan-id', name: 'Nested engineering plan' }, selectedNodeId: original.rootId });
  useWorkspaceStore.getState().selectProject(projectId); useWorkspaceStore.getState().navigate('planner');
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner());
  return { projectId, nodeId: original.rootId, nodeCount: Object.keys(original.nodes).length };
}
const allSelectors = (projectId: string, nodeId: string) => ({ projectId, mode: 'overview', offset: 0, limit: 20, edgeOffset: 0, suggestionOffset: 0, parkedOffset: 0, nodeId, textField: 'oQue', textOffset: 0 });

it('uses explicit overview even when the model fills every inactive selector and a node is selected', async () => {
  const { projectId, nodeId, nodeCount } = currentPlan();
  await flushWorkspacePersistence(); vi.useFakeTimers();
  let done!: () => void, calls = 0;
  const readDone = new Promise<void>(resolve => { done = resolve; });
  const model = new MockLanguageModelV3({ doStream: async () => {
    done();
    return { stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ === 0 ? [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'explicit-overview', toolName: 'planner_read', input: JSON.stringify(allSelectors(projectId, nodeId)) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ] : [
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'review' }, { type: 'text-delta', id: 'review', delta: 'Revisei a estrutura do plano e os recursos, com limites explícitos.' }, { type: 'text-end', id: 'review' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ]) };
  } });
  const run = runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano', contextProjectId: projectId, turnContext: captureChatTurnContext(),
    model, signal: new AbortController().signal, onText() {}, onAction() {} });
  await readDone; await vi.advanceTimersByTimeAsync(1500);
  const result = await run;
  const toolMessage = result.messages.find(message => message.role === 'tool');
  const output = toolMessage?.content.find(part => part.type === 'tool-result')?.output;
  expect(output).toMatchObject({ type: 'json', value: { ok: true, result: {
    workspaceProjectId: projectId, workspaceProjectName: 'Workspace project', planId: 'distinct-plan-id', readMode: 'overview',
    nodePage: { total: nodeCount }, project: { id: 'distinct-plan-id', name: 'Nested engineering plan' },
  } } });
  const data = (output as { type: string; value: { result: Record<string, any> } }).value.result;
  expect(Object.keys(data.project.nodes).length).toBeGreaterThan(1);
  expect(data.edgePage.omitted).not.toBe(true);
  expect(data.text).toBeUndefined();
  expect(data.hiddenCriterionNodeIds).toBeInstanceOf(Array);
  expect(model.doStreamCalls[0].prompt.find(message => message.role === 'system')?.content).toContain('hiddenCriterionNodeIds');
  expect(model.doStreamCalls).toHaveLength(2);
});

function criterionPlan() {
  const { projectId } = currentPlan(), project = useGraphStore.getState().project!;
  const nodeIds = Object.keys(project.nodes).slice(0, 6);
  const criteria = ['PRIVATE-HIDDEN-CRITERION', '', '  \n ', 'VISIBLE-CRITERION', 'PRIVATE-GRACE-CRITERION', 'PRIVATE-HIDDEN-WITHOUT-USER'];
  useGraphStore.setState({ project: { ...project, nodes: { ...project.nodes, ...Object.fromEntries(nodeIds.map((id, index) => [id, {
    ...project.nodes[id], comoConfirmar: criteria[index], confirmado: index === 3, takenAsKnown: false,
    comoConfirmarUsuario: index === 0 || index === 1 || index === 4 ? 'The independent user criterion' : undefined,
    comoConfirmarUsuarioAt: index === 4 ? Date.now() : undefined,
  }])) } } });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'revise o plano');
  const execute = async (input: unknown) => {
    const output = await tools.planner_read.execute!(input as never, { toolCallId: 'criterion-read', messages: [] });
    expect(output).toMatchObject({ ok: true });
    return (output as { result: Record<string, any> }).result;
  };
  return { projectId, nodeIds, execute };
}

it('distinguishes stored hidden criteria from absent criteria only within the returned page without exposing their contents', async () => {
  const { projectId, nodeIds, execute } = criterionPlan();
  const before = useGraphStore.getState().project;
  const overview = await execute({ projectId, mode: 'overview', limit: 4 });
  expect(overview.hiddenCriterionNodeIds).toEqual([nodeIds[0]]);
  expect(overview.project.nodes[nodeIds[0]].comoConfirmar).toBe('');
  expect(overview.project.nodes[nodeIds[1]].comoConfirmar).toBe('');
  expect(overview.project.nodes[nodeIds[3]].comoConfirmar).toBe('VISIBLE-CRITERION');
  expect(JSON.stringify(overview)).not.toMatch(/PRIVATE-HIDDEN-CRITERION|PRIVATE-GRACE-CRITERION|PRIVATE-HIDDEN-WITHOUT-USER/);
  const secondPage = await execute({ projectId, mode: 'overview', offset: 4, limit: 1 });
  expect(secondPage.hiddenCriterionNodeIds).toEqual([nodeIds[4]]);
  expect(secondPage.project.nodes[nodeIds[4]].comoConfirmar).toBe('');
  const thirdPage = await execute({ projectId, mode: 'overview', offset: 5, limit: 1 });
  expect(thirdPage.hiddenCriterionNodeIds).toEqual([nodeIds[5]]);
  expect(useGraphStore.getState().project).toBe(before);
});

it('preserves hidden versus absent status through explicit node and legacy criterion-text reads, including the unlock grace period', async () => {
  const { projectId, nodeIds, execute } = criterionPlan();
  for (const [index, nodeId] of nodeIds.entries()) {
    const hiddenIds = index === 0 || index === 4 || index === 5 ? [nodeId] : [];
    const detail = await execute({ projectId, mode: 'node', nodeId });
    expect(detail.hiddenCriterionNodeIds).toEqual(hiddenIds);
    const text = await execute({ projectId, nodeId, textField: 'comoConfirmar', ...(index === 5 ? { mode: 'text' } : {}) });
    expect(text.hiddenCriterionNodeIds).toEqual(hiddenIds);
    expect(text.project.nodes).toEqual({});
    if (hiddenIds.length) expect(text.text).toEqual({ field: 'comoConfirmar', content: '', offset: 0, totalCharacters: 0, nextOffset: null });
    expect(JSON.stringify(detail) + JSON.stringify(text)).not.toMatch(/PRIVATE-HIDDEN-CRITERION|PRIVATE-GRACE-CRITERION|PRIVATE-HIDDEN-WITHOUT-USER/);
  }
  const unrelatedField = await execute({ projectId, mode: 'text', nodeId: nodeIds[0], textField: 'oQue' });
  expect(unrelatedField.hiddenCriterionNodeIds).toEqual([]);
  const { project } = useGraphStore.getState(), nodeId = nodeIds[4];
  useGraphStore.setState({ project: { ...project!, nodes: { ...project!.nodes, [nodeId]: { ...project!.nodes[nodeId], comoConfirmarUsuarioAt: Date.now() - 60_000 } } } });
  const revealed = await execute({ projectId, mode: 'text', nodeId, textField: 'comoConfirmar' });
  expect(revealed.hiddenCriterionNodeIds).toEqual([]);
  expect(revealed.text.content).toBe('PRIVATE-GRACE-CRITERION');
});

it('exposes explicit mode and nullable inactive selectors in the actual SDK tool schema', async () => {
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'schema' }, { type: 'text-delta', id: 'schema', delta: 'Pronto.' }, { type: 'text-end', id: 'schema' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ]) }) });
  await runAssistant({ messages: [{ role: 'user', content: 'Olá' }], userText: 'Olá', model, signal: new AbortController().signal, onText() {}, onAction() {} });
  const readTool = model.doStreamCalls[0].tools?.find(tool => tool.type === 'function' && tool.name === 'planner_read');
  const schema = (readTool?.type === 'function' ? readTool.inputSchema : undefined) as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  expect(schema.properties.mode).toMatchObject({ enum: ['overview', 'node', 'text'] });
  expect(schema.required).toEqual(expect.arrayContaining(Object.keys(schema.properties)));
  expect(JSON.stringify(schema.properties.nodeId)).toContain('null');
  expect(JSON.stringify(schema.properties.textField)).toContain('null');
  expect(schema.additionalProperties).toBe(false);
});

it('supports a strict-style null-filled overview while retaining legacy selected-node and text reads', async () => {
  const { projectId, nodeId, nodeCount } = currentPlan();
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Leia o plano');
  const execute = (input: unknown) => tools.planner_read.execute!(input as never, { toolCallId: 'contract', messages: [] });
  const overview = await execute({ ...allSelectors(projectId, nodeId), nodeId: null, textField: null, textOffset: null });
  expect(overview).toMatchObject({ ok: true, result: { readMode: 'overview', nodePage: { total: nodeCount } } });
  const node = await execute({ projectId, nodeId });
  expect(node).toMatchObject({ ok: true, result: { readMode: 'node', nodePage: { total: 1, scope: 'selected-node' } } });
  const explicitNode = await execute({ ...allSelectors(projectId, nodeId), mode: 'node' });
  expect(explicitNode).toMatchObject({ ok: true, result: { readMode: 'node', nodePage: { returned: 1, scope: 'selected-node' } } });
  expect((explicitNode as { result: { text?: unknown } }).result.text).toBeUndefined();
  const text = await execute({ projectId, nodeId, textField: 'oQue' });
  expect(text).toMatchObject({ ok: true, result: { readMode: 'text', nodePage: { scope: 'text-only' }, text: { field: 'oQue' } } });
  expect(await execute({ projectId, mode: 'node', nodeId: null })).toMatchObject({ ok: false, error: 'Choose nodeId for mode=node.' });
  expect(await execute({ projectId, mode: 'text', textField: null })).toMatchObject({ ok: false, error: 'Choose textField for mode=text.' });
});

it('transmits the explicit nullable read contract through the installed OpenRouter SDK and consumes a whole-plan response', async () => {
  const { projectId, nodeId, nodeCount } = currentPlan();
  const payloads: Record<string, any>[] = [];
  const model = createOpenRouter({ apiKey: 'offline-fixture', fetch: async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ id: `offline-${payloads.length}`, object: 'chat.completion', created: 1, model: 'openai/gpt-6.1-sol',
      choices: [{ index: 0, message: payloads.length === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 'wire-overview', type: 'function',
        function: { name: 'planner_read', arguments: JSON.stringify({ ...allSelectors(projectId, nodeId), nodeId: null, textField: null, textOffset: null }) } }] }
        : { role: 'assistant', content: 'Revisei as páginas da estrutura.' }, finish_reason: payloads.length === 1 ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });
  } }).chat('openai/gpt-6.1-sol');
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'revise o plano');
  const result = await generateText({ model, tools: { planner_read: tools.planner_read }, prompt: 'revise o plano', stopWhen: stepCountIs(2), maxRetries: 0 });
  expect(result.text).toBe('Revisei as páginas da estrutura.');
  const wire = payloads[0].tools[0].function.parameters;
  expect(wire.properties.mode.enum).toEqual(['overview', 'node', 'text']);
  expect(wire.required).toEqual(expect.arrayContaining(Object.keys(wire.properties)));
  expect(JSON.stringify(wire.properties.nodeId)).toContain('null');
  const response = JSON.parse(payloads[1].messages.find((message: { role: string }) => message.role === 'tool').content);
  expect(response).toMatchObject({ ok: true, result: { workspaceProjectId: projectId, planId: 'distinct-plan-id', readMode: 'overview', nodePage: { total: nodeCount } } });
  expect(Object.keys(response.result.project.nodes).length).toBeGreaterThan(1);
});

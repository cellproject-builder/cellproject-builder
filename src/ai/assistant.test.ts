import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { flushWorkspacePersistence, useWorkspaceStore as store } from '@/workspace/store';
import { flushChatPersistence, useChatStore as chatStore } from '@/chat/store';
import { workspaceRepository } from '@/data/workspaceRepository';
import { runAssistant } from './assistant';
import * as service from './service';
import * as visualSearch from '@/visuals/search';
import { EMPTY_OBJECTIVE_DRAFT, useGraphStore } from '@/store';
import { capturePlanner, initializeWorkspace, openPlanner, readPlanner } from '@/workspace/planner';
import type { AssistantActionEvent } from './workspaceTools';
import type { ImageReference } from '@/visuals/types';
import { captureChatTurnContext } from '@/chat/turnContext';
import { captureNoteEditBaseline } from './noteEditBaseline';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
beforeEach(async () => { await store.persist.rehydrate(); store.setState({ projects: {}, tasks: {}, notes: {}, sprints: {}, folders: {}, comments: {}, legacyImported: true }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('runs a real SDK tool loop, mutates the store, streams the reply and keeps tool history', async () => {
  let calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => {
    const parts: LanguageModelV3StreamPart[] = calls++ === 0 ? [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'workspace_action', input: JSON.stringify({ action: 'create_project', name: 'Criado pelo chat' }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] : [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Projeto criado.' }, { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ];
    return { stream: convertArrayToReadableStream(parts) };
  } });
  const events: string[] = [], chunks: string[] = [];
  const response = await runAssistant({ messages: [{ role: 'user', content: 'Crie um projeto.' }], userText: 'Crie um projeto.', model, signal: new AbortController().signal, onText: (text) => chunks.push(text), onAction: (event) => events.push(event.status) });
  expect(Object.values(store.getState().projects)[0].name).toBe('Criado pelo chat');
  expect(response.text).toBe('Projeto criado.');
  expect(chunks.at(-1)).toBe('Projeto criado.');
  expect(events).toEqual(['running', 'done']);
  expect(response.messages.some((m) => m.role === 'tool')).toBe(true);
  // Context occupancy uses the final request's input, not the sum across tool-loop requests.
  expect(response.usage?.inputTokens).toBe(10);
  expect(response.usage?.outputTokens).toBe(10);
});

it('carries the private submission baseline through the SDK adapter without exposing it to the model', async () => {
  const noteId = store.getState().createNote({ title: 'Focused note' });
  store.getState().updateNote(noteId, { blocks: [{ id: 'old', type: 'text', text: 'PRIVATE_BASELINE_ONLY' }] });
  const turnContext = { ...captureChatTurnContext(), surface: 'notes' as const, noteId, noteTitle: 'Focused note', excerpt: '', projectId: null, visibleProjectId: null };
  const noteEditBaseline = captureNoteEditBaseline(turnContext);
  store.getState().updateNote(noteId, { blocks: [{ id: 'local', type: 'text', text: 'Local text now' }] });
  let calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => {
    const parts: LanguageModelV3StreamPart[] = calls++ === 0 ? [
    { type: 'stream-start' as const, warnings: [] },
    { type: 'tool-call' as const, toolCallId: 'stale-update', toolName: 'workspace_action', input: JSON.stringify({ action: 'update_note', id: noteId, patch: { text: 'Stale replacement' } }) },
    { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage },
  ] : [
    { type: 'stream-start' as const, warnings: [] },
    { type: 'text-start', id: 'conflict-answer' }, { type: 'text-delta', id: 'conflict-answer', delta: 'A nota mudou; a substituição foi recusada e suas edições foram preservadas.' }, { type: 'text-end', id: 'conflict-answer' },
    { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: undefined }, usage },
    ];
    return { stream: convertArrayToReadableStream(parts) };
  } });
  const events: AssistantActionEvent[] = [];
  await runAssistant({ messages: [{ role: 'user', content: 'Revise this note' }], userText: 'Revise this note', model, signal: new AbortController().signal,
    turnContext, noteEditBaseline, onText: () => {}, onAction: event => events.push(event) });
  expect(store.getState().notes[noteId].blocks[0].text).toBe('Local text now');
  expect(events.at(-1)).toMatchObject({ action: 'update_note', status: 'error' });
  expect(JSON.stringify(model.doStreamCalls)).not.toMatch(/PRIVATE_BASELINE_ONLY|noteEditBaseline|textSnapshot/);
});

it('revises the referenced plan and searches its images in one SDK turn while keeping image URLs out of model history', async () => {
  await useGraphStore.persist.rehydrate();
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
  const withPlan = (name: string) => {
    const projectId = store.getState().createProject(name);
    openPlanner(projectId);
    useGraphStore.getState().loadDemoProject();
    const project = useGraphStore.getState().project!;
    useGraphStore.setState({ project: { ...project, id: `plan-${projectId}`, name } });
    const nodeId = Object.keys(project.nodes).find(id => id !== project.rootId)!;
    useGraphStore.getState().selectNode(nodeId);
    store.getState().savePlanner(projectId, capturePlanner());
    return { projectId, nodeId };
  };
  const requested = withPlan('Plano referenciado'), visible = withPlan('Outro plano visível');
  store.getState().selectProject(visible.projectId); store.getState().navigate('planner');
  const original = readPlanner(requested.projectId), other = readPlanner(visible.projectId);
  const reset = vi.spyOn(useGraphStore.getState(), 'resetProject');
  const image: ImageReference = { id: 'arduino-reference', sessionId: 'session-for-ui-only', title: 'Arduino Uno R3', description: 'Placa de referência',
    imageUrl: '/api/visuals/media?sessionId=session-for-ui-only&candidateId=arduino-reference', sourcePageUrl: 'https://example.com/arduino', credit: 'Fabricante', license: null, width: 320, height: 240 };
  const search = vi.spyOn(visualSearch, 'searchVisualImages').mockResolvedValue([image]);
  const text = 'Altere esse nó para Arduino Uno e busque imagens dele.';
  let calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => {
    const index = calls++;
    const parts: LanguageModelV3StreamPart[] = index === 0 ? [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'read-scoped-plan', toolName: 'planner_action', input: JSON.stringify({ action: 'read_plan', projectId: requested.projectId }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] : index === 1 ? [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'revise-selected-node', toolName: 'planner_action', input: JSON.stringify({ action: 'update_node', projectId: requested.projectId, nodeId: requested.nodeId, patch: { name: 'Arduino Uno', oQue: 'Placa de controle do protótipo' } }) },
      { type: 'tool-call', toolCallId: 'search-selected-node', toolName: 'visual_action', input: JSON.stringify({ action: 'search_images', projectId: requested.projectId, text: 'Arduino Uno', references: [{ kind: 'node', id: requested.nodeId }] }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] : [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'scoped-reply' },
      { type: 'text-delta', id: 'scoped-reply', delta: 'Atualizei o nó. Escolha uma imagem no carrossel para levar ao canvas.' },
      { type: 'text-end', id: 'scoped-reply' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ];
    return { stream: convertArrayToReadableStream(parts) };
  } });
  const events: AssistantActionEvent[] = [];
  const response = await runAssistant({ messages: [{ role: 'user', content: text }], userText: text, contextProjectId: requested.projectId,
    model, contextBudget: { contextWindowTokens: 32_768 }, signal: new AbortController().signal, onText: () => {}, onAction: event => events.push(event) });
  const changed = readPlanner(requested.projectId).project!;
  expect(changed.id).toBe(original.project!.id);
  expect(Object.keys(changed.nodes)).toEqual(Object.keys(original.project!.nodes));
  expect(changed.edges).toEqual(original.project!.edges);
  expect(changed.nodes[requested.nodeId]).toMatchObject({ name: 'Arduino Uno', oQue: 'Placa de controle do protótipo' });
  expect(readPlanner(visible.projectId)).toEqual(other);
  expect(reset).not.toHaveBeenCalled();
  expect(search).toHaveBeenCalledOnce();
  expect(search.mock.calls[0][0]).toMatchObject({ text: 'Arduino Uno', mentions: [{ id: requested.nodeId, kind: 'node', label: 'Arduino Uno' }] });
  expect(changed.visuals?.artifacts ?? []).toHaveLength(0);
  expect(events.filter(event => event.status === 'done').map(event => event.action)).toEqual(['read_plan', 'update_node', 'search_images']);
  const imageEvent = events.find(event => event.action === 'search_images' && event.status === 'done');
  expect(imageEvent?.result).toMatchObject({ projectId: requested.projectId, applied: false, count: 1, imageReferences: [image] });
  const history = JSON.stringify(response.messages);
  expect(history).toContain('search-selected-node');
  expect(history).toContain('Arduino Uno R3');
  expect(history).not.toContain('imageReferences');
  expect(history).not.toContain('session-for-ui-only');
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('selectedNodeId');
  expect(JSON.stringify(model.doStreamCalls[2].prompt)).not.toContain('session-for-ui-only');
  expect(response.text).toContain('carrossel');
}, 10_000);

it('does not write or invoke the model for an already cancelled request', async () => {
  const controller = new AbortController(); controller.abort();
  const model = new MockLanguageModelV3();
  await expect(runAssistant({ messages: [{ role: 'user', content: 'Crie um projeto.' }], userText: 'Crie um projeto.', model, signal: controller.signal, onText: () => {}, onAction: () => {} })).rejects.toThrow();
  expect(model.doStreamCalls).toHaveLength(0);
  expect(Object.keys(store.getState().projects)).toHaveLength(0);
});

it('rejects an oversized first request before invoking the model', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ]) }) });
  await expect(runAssistant({ messages: [{ role: 'user', content: 'Resuma.' }], userText: 'Resuma.', model,
    contextBudget: { contextWindowTokens: 2048 }, signal: new AbortController().signal, onText: () => {}, onAction: () => {},
  })).rejects.toThrow('chatContextToolsTooLarge');
  expect(model.doStreamCalls).toHaveLength(0);
});

it.each([
  { label: 'plain text', body: 'source '.repeat(20_000) },
  { label: 'nested data URL', body: 'data:image/png;base64,' + 'A'.repeat(140_000) },
])('reads a large source as an explicit partial projection without overflowing a new conversation ($label)', async ({ body }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const projectId = store.getState().createProject('Long reference', body);
  const originalObjective = store.getState().projects[projectId].objective;
  let calls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(calls++ === 0 ? [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'large-project', toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects', id: projectId }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ] : [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'partial-source-answer' }, { type: 'text-delta', id: 'partial-source-answer', delta: 'A fonte é extensa; consultei uma projeção parcial sem alterar seu conteúdo.' }, { type: 'text-end', id: 'partial-source-answer' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ]) }) });
  const events: AssistantActionEvent[] = [];
  const response = await runAssistant({ messages: [{ role: 'user', content: 'Leia essa referência.' }], userText: 'Leia essa referência.', model,
    contextBudget: { contextWindowTokens: 32_768 }, signal: new AbortController().signal, onText: () => {}, onAction: event => events.push(event),
  });
  expect(model.doStreamCalls).toHaveLength(2);
  expect(JSON.stringify(response.messages)).toContain('truncatedFields');
  expect(JSON.stringify(response.messages).length).toBeLessThan(8000);
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'workspace_read', status: 'done' })]));
  expect(store.getState().projects[projectId].objective === originalObjective).toBe(true);
});

it('stops after a planner rate limit without another model call or queued mutation', async () => {
  const projectId = store.getState().createProject('Limite', 'Objetivo do teste');
  const limit = new APICallError({ message: 'Too many requests', statusCode: 429, url: 'https://example.test/chat', requestBodyValues: {}, responseHeaders: { 'retry-after': '7' } });
  const planner = vi.spyOn(service, 'outlinePlans').mockRejectedValue(limit);
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'before', toolName: 'workspace_action', input: JSON.stringify({ action: 'create_task', projectId, title: 'Mantida' }) },
    { type: 'tool-call', toolCallId: 'limited', toolName: 'planner_ai', input: JSON.stringify({ action: 'generate_plans', projectId }) },
    { type: 'tool-call', toolCallId: 'after', toolName: 'workspace_action', input: JSON.stringify({ action: 'create_note', title: 'Não executar' }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ]) }) });
  const events: string[] = [];
  await expect(runAssistant({ messages: [{ role: 'user', content: 'Crie tarefa, plano e nota' }], userText: 'Crie tarefa, plano e nota', signal: new AbortController().signal, model, onText: () => {}, onAction: (event) => events.push(event.action + ':' + event.status) })).rejects.toBe(limit);
  expect(model.doStreamCalls).toHaveLength(1);
  expect(planner).toHaveBeenCalledOnce();
  expect(planner.mock.calls[0][5]).toMatchObject({ maxRetries: 0 });
  expect(Object.values(store.getState().tasks)).toHaveLength(1);
  expect(Object.values(store.getState().notes)).toHaveLength(0);
  expect(events).toContain('create_task:done');
  expect(events).not.toContain('create_note:running');
});

it('spaces model steps and cancels before starting the next request', async () => {
  await flushWorkspacePersistence();
  vi.useFakeTimers();
  const controller = new AbortController();
  let completed!: () => void;
  const toolDone = new Promise<void>((resolve) => { completed = resolve; });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'one', toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ]) }) });
  const run = runAssistant({ messages: [{ role: 'user', content: 'Resuma' }], userText: 'Resuma', model, signal: controller.signal, onText: () => {}, onAction: (event) => { if (event.status === 'done') completed(); } });
  const failed = run.then(() => null, (error: unknown) => error);
  await toolDone;
  await vi.advanceTimersByTimeAsync(1000);
  expect(model.doStreamCalls).toHaveLength(1);
  controller.abort();
  expect(await failed).toMatchObject({ name: 'AbortError' });
  expect(model.doStreamCalls).toHaveLength(1);
});

it('preserves the main model rate-limit error and retry headers without retrying', async () => {
  const limit = new APICallError({
    message: 'Main model rate limit', statusCode: 429, url: 'https://example.test/model',
    requestBodyValues: {}, responseHeaders: { 'retry-after': '13', 'x-request-id': 'limited-request' },
    isRetryable: true,
  });
  const model = new MockLanguageModelV3({ doStream: async () => { throw limit; } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const actions = vi.fn(), onText = vi.fn();
  const error = await runAssistant({ messages: [{ role: 'user', content: 'Resuma meus projetos.' }], userText: 'Resuma meus projetos.', model,
    signal: new AbortController().signal, onText, onAction: actions }).then(() => null, (failure: unknown) => failure);
  expect(error).toBe(limit);
  expect(error).toMatchObject({ statusCode: 429, responseHeaders: { 'retry-after': '13', 'x-request-id': 'limited-request' } });
  expect(model.doStreamCalls).toHaveLength(1);
  expect(actions).not.toHaveBeenCalled();
  expect(onText).not.toHaveBeenCalled();
});

it('rejects the original streamed error after delivering partial text instead of reporting success', async () => {
  const failure = new APICallError({ message: 'Stream interrupted', statusCode: 502, url: 'https://example.test/stream', requestBodyValues: {}, isRetryable: true });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'partial' },
    { type: 'text-delta', id: 'partial', delta: 'Resposta ainda parcial.' },
    { type: 'text-end', id: 'partial' }, { type: 'error', error: failure },
  ]) }) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const chunks: string[] = [], success = vi.fn();
  const run = runAssistant({ messages: [{ role: 'user', content: 'Resuma.' }], userText: 'Resuma.', model,
    signal: new AbortController().signal, onText: (text) => chunks.push(text), onAction: () => {} });
  const outcome = run.then(success, (error: unknown) => error);
  expect(await outcome).toBe(failure);
  expect(success).not.toHaveBeenCalled();
  expect(chunks).toEqual(['Resposta ainda parcial.']);
  expect(model.doStreamCalls).toHaveLength(1);
});

it('streams intermediate and final text and restores real tool history from chat persistence between two turns', async () => {
  await flushWorkspacePersistence();
  await chatStore.persist.rehydrate();
  chatStore.setState({ sessionId: 'sdk-real-history', messages: [], modelHistory: [], pendingHistory: null, archivedSessions: [], running: false, error: null, rateLimits: {} });
  await flushChatPersistence();
  vi.useFakeTimers();
  let calls = 0, firstToolDone!: () => void, secondToolDone!: () => void;
  const firstDone = new Promise<void>((resolve) => { firstToolDone = resolve; });
  const secondDone = new Promise<void>((resolve) => { secondToolDone = resolve; });
  const model = new MockLanguageModelV3({ doStream: async () => {
    const index = calls++;
    const parts: LanguageModelV3StreamPart[] = index % 2 === 0 ? [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: `intro-${index}` },
      { type: 'text-delta', id: `intro-${index}`, delta: index === 0 ? 'Vou consultar.' : 'Vou conferir novamente.' },
      { type: 'text-end', id: `intro-${index}` },
      { type: 'tool-call', toolCallId: `read-${index}`, toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects' }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] : [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: `reply-${index}` },
      { type: 'text-delta', id: `reply-${index}`, delta: index === 1 ? 'Consulta concluída.' : 'Conferência concluída.' },
      { type: 'text-end', id: `reply-${index}` },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ];
    return { stream: convertArrayToReadableStream(parts) };
  } });
  const firstChunks: string[] = [];
  const firstInput = [{ role: 'user' as const, content: 'Consulte os projetos.' }];
  const firstRun = runAssistant({ messages: firstInput, userText: firstInput[0].content, model, signal: new AbortController().signal,
    onText: (text) => firstChunks.push(text), onAction: (event) => { if (event.status === 'done') firstToolDone(); } });
  await firstDone;
  await vi.advanceTimersByTimeAsync(1500);
  const first = await firstRun;
  expect(first.text).toBe('Consulta concluída.');
  expect(firstChunks[0]).toBe('Vou consultar.');
  expect(firstChunks.at(-1)).toBe(first.text);
  expect(first.messages.some((message) => message.role === 'tool')).toBe(true);

  // Use actual IndexedDB persistence between requests, with SDK-generated
  // ModelMessages rather than hand-written tool call/result fixtures.
  vi.useRealTimers();
  const firstHistory = [...firstInput, ...first.messages];
  chatStore.setState({ modelHistory: firstHistory, messages: [
    { id: 'first-user', role: 'user', text: firstInput[0].content, createdAt: Date.now() },
    { id: 'first-assistant', role: 'assistant', text: first.text, createdAt: Date.now() },
  ] });
  await flushChatPersistence();
  const read = vi.spyOn(workspaceRepository, 'getItem');
  await chatStore.persist.rehydrate();
  const restoredHistory = chatStore.getState().modelHistory;
  expect(read).toHaveBeenCalledWith('dynamic_diary-chat');
  expect(restoredHistory).not.toBe(firstHistory);
  expect(restoredHistory).toEqual(firstHistory);
  expect(restoredHistory.some((message) => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some((part) => part.type === 'tool-call' && part.toolCallId === 'read-0' && part.toolName === 'workspace_read'))).toBe(true);
  expect(restoredHistory.some((message) => message.role === 'tool'
    && message.content.some((part) => part.type === 'tool-result' && part.toolCallId === 'read-0' && part.toolName === 'workspace_read'))).toBe(true);
  vi.useFakeTimers();
  const secondChunks: string[] = [];
  const secondInput = [...restoredHistory, { role: 'user' as const, content: 'Confira novamente.' }];
  const secondRun = runAssistant({ messages: secondInput, userText: 'Confira novamente.', model, signal: new AbortController().signal,
    onText: (text) => secondChunks.push(text), onAction: (event) => { if (event.status === 'done') secondToolDone(); } });
  await secondDone;
  await vi.advanceTimersByTimeAsync(1500);
  const second = await secondRun;
  expect(second.text).toBe('Conferência concluída.');
  expect(secondChunks[0]).toBe('Vou conferir novamente.');
  expect(secondChunks.at(-1)).toBe(second.text);
  expect(model.doStreamCalls).toHaveLength(4);
  const secondTurnPrompt = model.doStreamCalls[2].prompt;
  expect(secondTurnPrompt.some((message) => message.role === 'tool' && message.content.some((part) => part.type === 'tool-result' && part.toolCallId === 'read-0'))).toBe(true);
  expect(second.messages.some((message) => message.role === 'tool' && message.content.some((part) => part.type === 'tool-result' && part.toolCallId === 'read-2'))).toBe(true);
});

it('reserves a written final answer inside sixteen SDK steps while preserving request spacing', async () => {
  await flushWorkspacePersistence();
  vi.useFakeTimers();
  const completed: (() => void)[] = [];
  const stepsDone = Array.from({ length: 15 }, (_, index) => new Promise<void>((resolve) => { completed[index] = resolve; }));
  const requestedAt: number[] = [];
  let done = 0;
  const model = new MockLanguageModelV3({ doStream: async options => {
    requestedAt.push(Date.now());
    return { stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      ...(options.toolChoice?.type === 'none' ? [
        { type: 'text-start' as const, id: 'bounded-answer' }, { type: 'text-delta' as const, id: 'bounded-answer', delta: 'Consultei as páginas disponíveis; não há projetos cadastrados.' }, { type: 'text-end' as const, id: 'bounded-answer' },
        { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: undefined }, usage },
      ] : [
        { type: 'tool-call' as const, toolCallId: `step-${requestedAt.length}`, toolName: 'workspace_read', input: JSON.stringify({ collection: 'projects', offset: requestedAt.length }) },
        { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage },
      ]),
    ]) };
  } });
  const run = runAssistant({ messages: [{ role: 'user', content: 'Continue consultando os projetos.' }], userText: 'Continue consultando os projetos.',
    model, signal: new AbortController().signal, onText: () => {}, onAction: (event) => { if (event.status === 'done') completed[done++](); } });
  for (let index = 0; index < 15; index++) {
    await stepsDone[index];
    await vi.advanceTimersByTimeAsync(1500);
  }
  const result = await run;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(model.doStreamCalls).toHaveLength(16);
  expect(done).toBe(15);
  expect(result.text).toContain('não há projetos cadastrados');
  expect(model.doStreamCalls[15].toolChoice).toEqual({ type: 'none' });
  expect(model.doStreamCalls[15].tools).toEqual([]);
  expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(15);
  expect(requestedAt.slice(1).every((time, index) => time - requestedAt[index] >= 1500)).toBe(true);
});

it('cancels in-flight planner work without applying its late result or a queued mutation', async () => {
  const projectId = store.getState().createProject('Cancelamento', 'Objetivo para o plano');
  const controller = new AbortController();
  let started!: () => void, release!: (outlines: service.PlanOutline[]) => void, finished!: () => void;
  const plannerStarted = new Promise<void>((resolve) => { started = resolve; });
  const plannerFinished = new Promise<void>((resolve) => { finished = resolve; });
  const planner = vi.spyOn(service, 'outlinePlans').mockImplementation(() => {
    started();
    // Simulate a provider that returns even after cancellation. The tool must
    // check the signal again before committing that stale response.
    return new Promise<service.PlanOutline[]>((resolve) => { release = resolve; });
  });
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'before-cancel', toolName: 'workspace_action', input: JSON.stringify({ action: 'create_task', projectId, title: 'Entrega já criada' }) },
    { type: 'tool-call', toolCallId: 'planning-cancel', toolName: 'planner_ai', input: JSON.stringify({ action: 'generate_plans', projectId }) },
    { type: 'tool-call', toolCallId: 'after-cancel', toolName: 'workspace_action', input: JSON.stringify({ action: 'create_note', title: 'Não criar após cancelar' }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
  ]) }) });
  const events: string[] = [];
  const failure = runAssistant({ messages: [{ role: 'user', content: 'Crie tarefa, plano e nota.' }], userText: 'Crie tarefa, plano e nota.',
    model, signal: controller.signal, onText: () => {}, onAction: (event) => {
      events.push(event.action + ':' + event.status);
      if (event.action === 'generate_plans' && event.status === 'error') finished();
    } }).then(() => null, (error: unknown) => error);
  await plannerStarted;
  expect(planner.mock.calls[0][5]).toMatchObject({ signal: expect.any(AbortSignal), maxRetries: 0 });
  controller.abort();
  expect(planner.mock.calls[0][5]?.signal?.aborted).toBe(true);
  release([{ id: 'stale-plan', title: 'Late result', pitch: 'Late', approach: '', strategy: 'reaproveitar', archetype: 'construir', rank: 1, rankReason: '', outline: { categorias: [] } }]);
  await plannerFinished;
  expect(await failure).toMatchObject({ name: 'AbortError' });
  await flushWorkspacePersistence();
  expect(model.doStreamCalls).toHaveLength(1);
  expect(planner).toHaveBeenCalledOnce();
  expect(Object.values(store.getState().tasks).map((task) => task.title)).toEqual(['Entrega já criada']);
  expect(Object.values(store.getState().notes)).toHaveLength(0);
  expect(store.getState().projects[projectId].planner?.objectiveDraft.outlines?.some((outline) => outline.id === 'stale-plan')).not.toBe(true);
  expect(events).toContain('create_task:done');
  expect(events).toContain('generate_plans:error');
  expect(events).not.toContain('create_note:running');
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { createVisualTools, executeVisualAction, visualActionSchema } from './visualTools';

const services = vi.hoisted(() => ({ search: vi.fn(), generate: vi.fn() }));
const fit = vi.hoisted(() => vi.fn<typeof import('@/visuals/componentFit').assessImageProjectFit>().mockResolvedValue([]));
vi.mock('@/visuals/componentFit', () => ({ assessImageProjectFit: fit }));
vi.mock('@/visuals/controller', () => ({ runVisualSearch: services.search, runVisualGeneration: services.generate }));
vi.mock('@/workspace/uiRequests', () => ({ requestWorkspaceUI: vi.fn() }));
vi.mock('@/workspace/planner', () => ({ readPlanner: () => ({ project: { id: 'plan' } }), getPlannerOwnerId: () => 'project' }));
vi.mock('@/visuals/ui/uiStore', () => ({ useVisualPopupStore: { getState: () => ({ open: vi.fn() }) } }));

beforeEach(() => {
  services.search.mockReset().mockResolvedValue([{ id: 'image-1', sessionId: 'session', title: 'ESP32', description: 'Board reference', imageUrl: '/api/visuals/media?sessionId=session&candidateId=image-1', sourcePageUrl: 'https://example.com/esp32', credit: null, license: null, width: 400, height: 300 }]);
  services.generate.mockReset().mockResolvedValue({ id: 'proposal', status: 'ready' });
  useWorkspaceStore.setState({ activeProjectId: 'project', projects: { project: { id: 'project', name: 'Study', objective: '', archived: false, createdAt: 1, updatedAt: 1 } }, notes: {} });
  useGraphStore.setState({ project: { id: 'plan', name: 'Study', objective: '', createdAt: 1, updatedAt: 1, rootId: 'root', nodes: {}, edges: {} } });
});

describe('assistant visual actions', () => {
  it('preserves requested groups, reports missing images and passes the project context to documentary review', async () => {
    services.search.mockImplementationOnce(async (_input, options) => {
      options.onDetails({ targetMatches: { 'image-1': [0] }, intent: { query: 'ESP32 USB cable', label: 'Placa e cabo', targets: [{ aliases: ['ESP32'], identifiers: ['ESP32'] }, { aliases: ['Cabo USB'], identifiers: [] }] } });
      return [{ id: 'image-1', title: 'ESP32', description: 'Board', imageUrl: '/api/visuals/media?sessionId=session&candidateId=image-1', sourcePageUrl: 'https://example.com/esp32', sessionId: 'session' }];
    });
    const result = await executeVisualAction({ action: 'search_images', projectId: 'project', text: 'ESP32 e cabo USB', references: [] }, new AbortController().signal);
    expect(result).toMatchObject({ groups: [{ label: 'ESP32', imageIds: ['image-1'] }, { label: 'Cabo USB', imageIds: [] }], contextRevision: expect.any(String) });
    expect(fit).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ sources: expect.arrayContaining([expect.objectContaining({ kind: 'project' })]) }), 'ESP32 e cabo USB', expect.any(Object));
  });
  it('searches images through the shared gallery service without inserting an object', async () => {
    const result = await executeVisualAction({ action: 'search_images', projectId: 'project', text: 'ESP32', references: [] }, new AbortController().signal);
    expect(services.search).toHaveBeenCalledWith({ text: 'ESP32', mentions: [], attachments: [] }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ applied: false, count: 1 });
    expect(services.generate).not.toHaveBeenCalled();
  });
  it('uses the actual human request as a requirement source instead of agent-added search instructions', async () => {
    const tools = createVisualTools(new AbortController().signal, (_name, fn) => async input => ({ ok: true, result: await fn(input) }), undefined, 'Quero uma placa para estudar.');
    await tools.visual_action.execute!({ action: 'search_images', projectId: 'project', text: 'ESP32. Alimentação obrigatória 48 V.', references: [] }, { toolCallId: 'fit-source', messages: [] });
    const sources = fit.mock.calls.at(-1)![1].sources;
    expect(sources.find(source => source.id === 'request')?.text).toBe('Quero uma placa para estudar.');
    expect(JSON.stringify(sources)).not.toContain('48 V');
  });
  it('returns real image candidates for the chat carousel without opening a popup', async () => {
    const result = await executeVisualAction({ action: 'search_images', projectId: 'project', text: 'ESP32', references: [] }, new AbortController().signal);
    expect(services.search).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ openPopup: false }));
    expect(result).toMatchObject({ projectId: 'project', planId: 'plan', input: { text: 'ESP32', mentions: [], attachments: [] }, imageReferences: [expect.objectContaining({ imageUrl: '/api/visuals/media?sessionId=session&candidateId=image-1', sessionId: 'session' })] });
  });
  it('keeps carousel payloads out of model history while the UI retains them', async () => {
    const tools = createVisualTools(new AbortController().signal, (_name, fn) => async input => ({ ok: true, result: await fn(input) }));
    const input = { action: 'search_images' as const, projectId: 'project', text: 'ESP32', references: [] };
    const output = await tools.visual_action.execute!(input, { toolCallId: 'images', messages: [] });
    expect(output).toMatchObject({ result: { imageReferences: expect.any(Array) } });
    const modelOutput = await tools.visual_action.toModelOutput!({ input, output, toolCallId: 'images' });
    expect(JSON.stringify(modelOutput)).not.toContain('imageUrl');
    expect(JSON.stringify(modelOutput)).toContain('https://example.com/esp32');
  });
  it('compacts a search result inside a persistence-failure envelope without hiding the failure', async () => {
    const tools = createVisualTools(new AbortController().signal, (_name, fn) => async input => ({ ok: true, result: await fn(input) }));
    const input = { action: 'search_images' as const, projectId: 'project', text: 'PRIVATE INPUT', references: [] };
    const search = await executeVisualAction(input, new AbortController().signal);
    const output = { ok: false, result: { applied: true, saved: false, result: search, error: 'Local saving failed.' } };
    const modelOutput = await tools.visual_action.toModelOutput!({ input, output, toolCallId: 'not-saved' });
    const serialized = JSON.stringify(modelOutput);
    expect(serialized).not.toContain('imageReferences');
    expect(serialized).not.toContain('imageUrl');
    expect(serialized).not.toContain('PRIVATE INPUT');
    expect(serialized).toContain('Local saving failed.');
    expect(serialized).toContain('saved');
    expect(serialized).toContain('https://example.com/esp32');
  });
  it('reports a ready model as awaiting approval rather than applied', async () => {
    expect(await executeVisualAction({ action: 'generate_model', projectId: 'project', text: 'ESP32', references: [] }, new AbortController().signal))
      .toMatchObject({ applied: false, requiresApproval: true, proposalId: 'proposal' });
  });
  it('uses pixel analysis only when the human enabled it and the request selects an image', async () => {
    const mediaId = 'media';
    useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { version: 1, mode: 'approval', proposals: [], artifacts: [{ id: 'local-board', label: 'Board', kind: 'image', x: 0, y: 0, width: 100, height: 100, mediaId, scene: null, source: null, revisions: [{ scene: null, mediaId, createdAt: 1 }], revisionIndex: 0 }], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [], analyzeImages: true } } } } }));
    const selected = await executeVisualAction({ action: 'generate_model', projectId: 'project', text: 'Model this board', references: [{ kind: 'image', id: 'local-board' }] }, new AbortController().signal);
    expect(selected).toMatchObject({ imageAnalysis: 'pixels', requiresApproval: true });
    expect(services.generate).toHaveBeenLastCalledWith(expect.objectContaining({ analyzeImages: true }), expect.anything());
    const textOnly = await executeVisualAction({ action: 'generate_model', projectId: 'project', text: 'A sphere', references: [] }, new AbortController().signal);
    expect(textOnly).toMatchObject({ imageAnalysis: 'metadata' });
    expect(services.generate.mock.calls.at(-1)![0].analyzeImages).toBeUndefined();
    expect(useGraphStore.getState().project!.visuals!.drafts.model.analyzeImages).toBe(true);
    expect(visualActionSchema.safeParse({ action: 'generate_model', projectId: 'project', text: 'x', references: [], analyzeImages: true }).success).toBe(false);
  });
  it('rejects invented source IDs and authority/policy fields', async () => {
    await expect(executeVisualAction({ action: 'generate_model', projectId: 'project', text: 'ESP32', references: [{ kind: 'note', id: 'invented' }] }, new AbortController().signal)).rejects.toThrow();
    expect(services.generate).not.toHaveBeenCalled();
    expect(visualActionSchema.safeParse({ action: 'generate_model', projectId: 'project', text: 'x', references: [], actor: 'human', mode: 'automatic' }).success).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { capturePlanner, initializeWorkspace } from '@/workspace/planner';
import { buildDemoProject } from '@/data/demoProject';
import { getVisualWorkspace, mutateVisualWorkspace, saveVisualDraft } from './domain';
import { useVisualPopupStore } from './ui/uiStore';
import { addReferenceImage } from './media';
import { searchVisualImages } from './search';
import { generateVisualModel } from './generation';
import * as controller from './controller';
import type { ImageReference, VisualArtifact } from './types';
import { chatImageSearchRevision } from './projectSearchContext';

vi.mock('./media', () => ({ addReferenceImage: vi.fn() }));
vi.mock('./search', () => ({ searchVisualImages: vi.fn() }));
vi.mock('./generation', () => ({ generateVisualModel: vi.fn() }));

const reference: ImageReference = { id: 'board', title: 'Arduino Uno', description: 'Board', imageUrl: '/api/visuals/media?sessionId=session&candidateId=board', sourcePageUrl: 'https://example.com/board', credit: null, license: null, width: 400, height: 200, sessionId: 'session' };
const image: VisualArtifact = { id: 'local-board', kind: 'image', label: reference.title, x: 0, y: 0, width: 200, height: 100, mediaId: 'board-media', scene: null, source: reference, revisions: [{ scene: null, mediaId: 'board-media', createdAt: 1 }], revisionIndex: 0 };
let projectId: string;
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'plan' }, aiJobs: {}, selectedNodeId: null });
  initializeWorkspace();
  projectId = useWorkspaceStore.getState().createProject('Chat test');
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner());
  initializeWorkspace();
  useWorkspaceStore.setState({ activeProjectId: projectId });
  mutateVisualWorkspace(w => ({ ...w, artifacts: [], proposals: [] }));
  useVisualPopupStore.setState({ searchOpen: false, modelOpen: false, searchMinimized: false, modelMinimized: false, modelBase: null });
  controller.useVisualSearchStore.setState({ search: null });
  controller.setVisualPlacementResolver(() => ({ x: 500, y: 300 }));
  vi.mocked(searchVisualImages).mockReset().mockResolvedValue([reference]);
  vi.mocked(addReferenceImage).mockReset().mockImplementation(async (_reference, point, _signal, options) => {
    const linkedNodeId = options?.linkedNodeId === undefined ? useGraphStore.getState().selectedNodeId : options.linkedNodeId;
    const inserted = { ...image, x: point.x - (options?.center ? image.width / 2 : 0), y: point.y - (options?.center ? image.height / 2 : 0), linkedNodeId };
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, inserted] }));
    return inserted;
  });
});

describe('chat image integration', () => {
  it('delivers search and model results without reopening a tool minimized by the user', async () => {
    const input = { text: 'Arduino Uno', mentions: [], attachments: [] };
    const tools = useVisualPopupStore.getState(); tools.open('search'); tools.minimize('search');
    await controller.runVisualSearch(input, { signal: new AbortController().signal });
    expect(controller.useVisualSearchStore.getState().search?.results).toEqual([reference]);
    expect(useVisualPopupStore.getState().searchMinimized).toBe(true);
    tools.open('model'); tools.minimize('model');
    vi.mocked(generateVisualModel).mockResolvedValue({ id: 'model-result', projectId: 'plan', status: 'ready', label: 'Arduino', scene: { version: 1, label: 'Arduino', objects: [] }, input, createdAt: 1, contextFingerprint: 'v1' });
    await controller.runVisualGeneration(input, { signal: new AbortController().signal });
    expect(useVisualPopupStore.getState().modelMinimized).toBe(true);
  });
  it('rejects an obsolete assessment before inserting an image after project requirements change', async () => {
    const searchInput = { text: 'Arduino Uno', mentions: [], attachments: [] };
    const expectedContextRevision = chatImageSearchRevision(projectId, searchInput);
    const noteId = useWorkspaceStore.getState().createNote({ projectId, title: 'Alimentação revisada' });
    useWorkspaceStore.getState().updateNote(noteId, { blocks: [{ id: 'power', type: 'text', text: 'O controle deve operar em 3.3 V' }] });
    await expect(controller.addChatImageReference(reference, projectId, { expectedContextRevision, searchInput })).rejects.toThrow('visualSearchContextChanged');
    expect(addReferenceImage).not.toHaveBeenCalled();
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
  });
  it('returns chat results without opening the gallery or replacing its last canvas search', async () => {
    const input = { text: 'Arduino Uno', mentions: [], attachments: [] };
    const result = await controller.runVisualSearch(input, { signal: new AbortController().signal, openPopup: false });
    expect(result).toEqual([reference]);
    expect(useVisualPopupStore.getState().searchOpen).toBe(false);
    expect(controller.useVisualSearchStore.getState().search).toBeNull();
    await controller.runVisualSearch(input, { signal: new AbortController().signal });
    expect(useVisualPopupStore.getState().searchOpen).toBe(true);
    expect(controller.useVisualSearchStore.getState().search?.results).toEqual([reference]);
  });
  it('adds only the chosen image at the viewport and reuses it without moving it', async () => {
    const first = await controller.addChatImageReference(reference, projectId);
    expect(first).toMatchObject({ id: image.id, x: 400, y: 250 });
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
    controller.setVisualPlacementResolver(() => ({ x: 900, y: 700 }));
    const second = await controller.addChatImageReference(reference, projectId);
    expect(second).toMatchObject({ id: image.id, x: 400, y: 250 });
    expect(addReferenceImage).toHaveBeenCalledOnce();
  });
  it('passes a chosen image into the 3D draft while preserving its text and attachments', async () => {
    const attachment = { id: 'file', name: 'spec.txt', mime: 'text/plain', byteLength: 4, mediaId: 'spec-media', text: 'spec' };
    saveVisualDraft('model', { text: 'Keep proportions', mentions: [], attachments: [attachment], analyzeImages: true });
    await controller.addChatImageReference(reference, projectId, { useAs3D: true });
    expect(getVisualWorkspace(useGraphStore.getState().project).drafts.model).toMatchObject({ text: 'Keep proportions', attachments: [attachment], analyzeImages: true, mentions: [expect.objectContaining({ id: image.id, kind: 'image' })] });
    expect(useVisualPopupStore.getState().modelOpen).toBe(true);
  });
  it('reuses the same registered image URL without moving it or replacing its link', async () => {
    const reused = { ...image, x: 123, y: 456, linkedNodeId: useGraphStore.getState().project!.rootId, source: { ...reference, id: 'previous-result', sessionId: 'previous-session' } };
    mutateVisualWorkspace(w => ({ ...w, artifacts: [reused] }));
    const result = await controller.addChatImageReference(reference, projectId, { linkedNodeId: null });
    expect(result).toMatchObject({ id: image.id, x: 123, y: 456, linkedNodeId: reused.linkedNodeId });
    expect(addReferenceImage).not.toHaveBeenCalled();
  });
  it('connects an image to the node used for its chat search', async () => {
    const nodeId = Object.values(useGraphStore.getState().project!.nodes).find(node => node.id !== useGraphStore.getState().project!.rootId)!.id;
    const artifact = await controller.addChatImageReference(reference, projectId, { linkedNodeId: nodeId });
    expect(artifact.linkedNodeId).toBe(nodeId);
    expect(useGraphStore.getState().project!.nodes[nodeId]).toBeDefined();
  });
  it('keeps a chat image free when the search did not reference a node', async () => {
    useGraphStore.setState({ selectedNodeId: useGraphStore.getState().project!.rootId });
    const artifact = await controller.addChatImageReference(reference, projectId);
    expect(artifact.linkedNodeId).toBeNull();
  });
  it('rejects another project before downloading and rejects a switched plan after download', async () => {
    await expect(controller.addChatImageReference(reference, 'other-project')).rejects.toThrow('visualProjectChanged');
    expect(addReferenceImage).not.toHaveBeenCalled();
    vi.mocked(addReferenceImage).mockImplementation(async () => {
      useGraphStore.setState(state => ({ project: { ...state.project!, id: 'other-plan' } }));
      return image;
    });
    await expect(controller.addChatImageReference(reference, projectId, { useAs3D: true })).rejects.toThrow('visualProjectChanged');
    expect(useVisualPopupStore.getState().modelOpen).toBe(false);
  });
  it('rejects an old search from another plan within the same project before downloading', async () => {
    const planId = useGraphStore.getState().project!.id;
    useGraphStore.setState(state => ({ project: { ...state.project!, id: 'replacement-plan' } }));
    await expect(controller.addChatImageReference(reference, projectId, { expectedPlanId: planId })).rejects.toThrow('visualProjectChanged');
    expect(addReferenceImage).not.toHaveBeenCalled();
  });
  it('does not reposition an image deduplicated during the pending download', async () => {
    const concurrent = { ...image, x: 23, y: 45, linkedNodeId: useGraphStore.getState().project!.rootId };
    vi.mocked(addReferenceImage).mockImplementation(async () => {
      mutateVisualWorkspace(w => ({ ...w, artifacts: [concurrent] }));
      return concurrent;
    });
    const result = await controller.addChatImageReference(reference, projectId, { linkedNodeId: null });
    expect(result).toMatchObject(concurrent);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toEqual([concurrent]);
  });
});

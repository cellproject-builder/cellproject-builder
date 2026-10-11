import { beforeEach, describe, expect, it, vi } from 'vitest';
import { availableCanvasResources, importCanvasResource, updateCanvasAttachments, watchCanvasAttachmentScope } from './canvasDomain';
import type { CanvasAttachments } from './canvasModel';

const state = vi.hoisted(() => ({
  runtime: null as object | null,
  workspace: { activeBoardId: 'board', boards: {} as Record<string, { id: string; archived: boolean; attachments?: CanvasAttachments }>, projects: {} as Record<string, { attachments: unknown[] }>, updateBoard: vi.fn() },
  graph: { project: null as { id: string; visuals: unknown } | null },
  owner: 'managed', listeners: new Set<() => void>(),
  store: vi.fn(), extract: vi.fn(), visualAssert: vi.fn(), visualDispose: vi.fn(), mutateVisual: vi.fn(),
}));
vi.mock('@/store', () => ({ useGraphStore: { getState: () => state.graph } }));
vi.mock('@/workspace/store', () => ({ useWorkspaceStore: { getState: () => state.workspace, subscribe: (callback: () => void) => { state.listeners.add(callback); return () => state.listeners.delete(callback); } } }));
vi.mock('@/workspace/planner', () => ({ getPlannerOwnerId: () => state.owner }));
vi.mock('@/cloud/runtime', () => ({ getCloudRuntime: () => state.runtime }));
vi.mock('@/visuals/media', () => ({ storeCanvasFile: state.store }));
vi.mock('@/kb/extract', () => ({ extractPdfText: state.extract }));
vi.mock('@/visuals/domain', () => ({
  getVisualWorkspace: (project: { visuals: unknown }) => project.visuals,
  mutateVisualWorkspace: state.mutateVisual,
  watchVisualScope: () => ({ assert: state.visualAssert, dispose: state.visualDispose }),
}));
const changed = () => state.listeners.forEach(listener => listener());
const scope = { kind: 'board' as const, id: 'board' };
const pdf = () => new File(['%PDF-1.7'], 'Manual.pdf', { type: 'application/pdf' });
beforeEach(() => {
  state.runtime = null; state.graph.project = null; state.workspace.activeBoardId = 'board';
  state.workspace.boards = { board: { id: 'board', archived: false }, other: { id: 'other', archived: false } };
  state.workspace.projects = {}; state.listeners.clear();
  state.workspace.updateBoard.mockReset(); state.store.mockReset().mockResolvedValue({ id: 'media', mime: 'application/pdf', size: 8 });
  state.extract.mockReset().mockResolvedValue({ text: '', pageCount: 2 });
  state.visualAssert.mockReset(); state.visualDispose.mockReset(); state.mutateVisual.mockReset();
});

describe('canvas attachment scope and original import', () => {
  it('stores a scanned PDF original even when local extraction has no text', async () => {
    const file = pdf(), resource = await importCanvasResource(file, scope);
    expect(state.store).toHaveBeenCalledExactlyOnceWith(file, 'board:board', undefined);
    expect(state.extract).toHaveBeenCalledWith(file, undefined, { signal: undefined, maxPages: 100, maxChars: 24_000 });
    expect(resource).toMatchObject({ kind: 'pdf', mediaId: 'media', text: null, pages: 2, mime: 'application/pdf' });
    expect(state.workspace.updateBoard).not.toHaveBeenCalled();
    expect(state.listeners.size).toBe(0);
  });

  it('rejects an aborted import before reading or storing bytes and releases its guard', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(importCanvasResource(pdf(), scope, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.store).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });

  it('does not return an import after switching away and back while the original was storing', async () => {
    let resolve: (value: { id: string; mime: string; size: number }) => void = () => {};
    state.store.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = importCanvasResource(pdf(), scope);
    state.workspace.activeBoardId = 'other'; changed(); state.workspace.activeBoardId = 'board'; changed();
    resolve({ id: 'media', mime: 'application/pdf', size: 8 });
    await expect(pending).rejects.toThrow('attachmentContextChanged');
    expect(state.extract).not.toHaveBeenCalled(); expect(state.workspace.updateBoard).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });

  it('rejects account changes after PDF extraction and never materializes an attachment', async () => {
    let resolve: (value: { text: string; pageCount: number }) => void = () => {};
    state.extract.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = importCanvasResource(pdf(), scope);
    await vi.waitFor(() => expect(state.extract).toHaveBeenCalledOnce());
    state.runtime = {}; resolve({ text: 'Documento da conta anterior', pageCount: 2 });
    await expect(pending).rejects.toThrow('attachmentContextChanged');
    expect(state.workspace.updateBoard).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });

  it('keeps a board guard stale after archival is reversed and unsubscribes it', () => {
    const guard = watchCanvasAttachmentScope(scope); guard.assert();
    state.workspace.boards.board.archived = true; changed(); state.workspace.boards.board.archived = false; changed();
    expect(() => guard.assert()).toThrow('attachmentContextChanged');
    guard.dispose(); expect(state.listeners.size).toBe(0);
  });

  it('rejects inactive board mutations and invalid resource references before committing', () => {
    state.workspace.activeBoardId = 'other';
    expect(() => updateCanvasAttachments(scope, () => ({ resources: [], cards: [] }))).toThrow('attachmentContextChanged');
    state.workspace.activeBoardId = 'board';
    expect(() => updateCanvasAttachments(scope, () => ({ resources: [], cards: [{ id: 'card', resourceIds: ['missing'], x: 0, y: 0, width: 240, height: 290 }] }))).toThrow();
    expect(state.workspace.updateBoard).not.toHaveBeenCalled();
  });

  it('exposes legacy extracted PDFs without claiming an original blob exists, and honors removal', () => {
    state.graph.project = { id: 'plan', visuals: { artifacts: [], drafts: {}, proposals: [] } };
    state.workspace.projects.managed = { attachments: [{ id: 'manual', name: 'Manual.pdf', kind: 'pdf', size: 300, text: 'Texto legado', pages: 4, addedAt: 1 }] };
    const planScope = { kind: 'planner' as const, id: 'plan' };
    expect(availableCanvasResources(planScope)).toEqual([expect.objectContaining({ id: 'file-manual', mediaId: null, text: 'Texto legado', pages: 4 })]);
    state.graph.project.visuals = { artifacts: [], drafts: {}, proposals: [], attachments: { resources: [], cards: [], hiddenResourceIds: ['file-manual'] } };
    expect(availableCanvasResources(planScope)).toEqual([]);
  });
});

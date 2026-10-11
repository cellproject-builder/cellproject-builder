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
const resource = (id: string, text: string | null = null): CanvasAttachments['resources'][number] => ({ id, name: `${id}.pdf`, kind: 'pdf', mediaId: `media-${id}`, mime: 'application/pdf', size: 8, text, url: null, addedAt: 1, pages: 2 });
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

  it('rejects an invalid PDF header before extracting or storing an original', async () => {
    await expect(importCanvasResource(new File(['not a PDF'], 'invalid.pdf', { type: 'application/pdf' }), scope)).rejects.toThrow('visualPdfInvalid');
    expect(state.extract).not.toHaveBeenCalled(); expect(state.store).not.toHaveBeenCalled();
  });

  it('does not persist a malformed PDF that the extractor rejects', async () => {
    state.extract.mockRejectedValueOnce(new Error('Invalid PDF structure'));
    await expect(importCanvasResource(pdf(), scope)).rejects.toThrow('Invalid PDF structure');
    expect(state.store).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });

  it('validates the extracted page count before storing the original', async () => {
    state.extract.mockResolvedValueOnce({ text: '', pageCount: 101 });
    await expect(importCanvasResource(pdf(), scope)).rejects.toThrow();
    expect(state.store).not.toHaveBeenCalled();
  });

  it('does not store an original when cancellation occurs during extraction', async () => {
    const abort = new AbortController(); let resolve: (value: { text: string; pageCount: number }) => void = () => {};
    state.extract.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = importCanvasResource(pdf(), scope, abort.signal);
    await vi.waitFor(() => expect(state.extract).toHaveBeenCalledOnce());
    abort.abort(); resolve({ text: 'Late text', pageCount: 2 });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.store).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });

  it('rejects a full resource library before extracting or storing another original', async () => {
    state.workspace.boards.board.attachments = { resources: Array.from({ length: 100 }, (_, i) => resource(`existing-${i}`)), cards: [] };
    await expect(importCanvasResource(pdf(), scope)).rejects.toThrow();
    expect(state.extract).not.toHaveBeenCalled(); expect(state.store).not.toHaveBeenCalled();
  });

  it('rejects an import that exceeds the library text budget before storing its original', async () => {
    state.workspace.boards.board.attachments = { resources: Array.from({ length: 10 }, (_, i) => resource(`existing-${i}`, 'x'.repeat(24_000))), cards: [] };
    state.extract.mockResolvedValueOnce({ text: 'one extra character', pageCount: 2 });
    await expect(importCanvasResource(pdf(), scope)).rejects.toThrow('attachmentTextBudget');
    expect(state.store).not.toHaveBeenCalled();
  });

  it('rechecks the latest library budget after extraction before storing an original', async () => {
    let resolve: (value: { text: string; pageCount: number }) => void = () => {};
    state.extract.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = importCanvasResource(pdf(), scope);
    await vi.waitFor(() => expect(state.extract).toHaveBeenCalledOnce());
    state.workspace.boards.board.attachments = { resources: Array.from({ length: 100 }, (_, i) => resource(`existing-${i}`)), cards: [] };
    resolve({ text: '', pageCount: 2 });
    await expect(pending).rejects.toThrow(); expect(state.store).not.toHaveBeenCalled();
  });

  it('accepts the exact library text budget and stores the original once', async () => {
    state.workspace.boards.board.attachments = { resources: Array.from({ length: 9 }, (_, i) => resource(`existing-${i}`, 'x'.repeat(24_000))), cards: [] };
    state.extract.mockResolvedValueOnce({ text: 'y'.repeat(24_000), pageCount: 100 });
    const imported = await importCanvasResource(pdf(), scope);
    expect(imported.text).toHaveLength(24_000); expect(imported.pages).toBe(100); expect(state.store).toHaveBeenCalledOnce();
  });

  it('infers an absent PDF MIME from its extension before local validation', async () => {
    const file = new File(['%PDF-1.7'], 'Manual.PDF');
    const imported = await importCanvasResource(file, scope);
    expect(imported.kind).toBe('pdf'); expect(imported.mime).toBe('application/pdf');
    expect(state.extract).toHaveBeenCalledExactlyOnceWith(file, undefined, { signal: undefined, maxPages: 100, maxChars: 24_000 });
    expect(state.store).toHaveBeenCalledExactlyOnceWith(file, 'board:board', undefined);
  });

  it('infers an absent Markdown MIME while preserving its text and original', async () => {
    const file = new File(['# Source'], 'source.md'); Object.defineProperty(file, 'text', { value: async () => '# Source' });
    state.store.mockResolvedValueOnce({ id: 'markdown-media', mime: 'text/markdown', size: 8 });
    const imported = await importCanvasResource(file, scope);
    expect(imported).toMatchObject({ kind: 'text', mime: 'text/markdown', text: '# Source', mediaId: 'markdown-media' });
    expect(state.extract).not.toHaveBeenCalled(); expect(state.store).toHaveBeenCalledOnce();
  });

  it.each([
    new File(['%PDF-1.7'], 'Manual.pdf', { type: 'application/octet-stream' }),
    Object.defineProperty(pdf(), 'size', { value: 10 * 1024 * 1024 + 1 }),
  ])('rejects unsupported or oversized originals before extraction and storage', async file => {
    await expect(importCanvasResource(file, scope)).rejects.toThrow();
    expect(state.extract).not.toHaveBeenCalled(); expect(state.store).not.toHaveBeenCalled();
  });

  it('does not return an import after switching away and back while the original was storing', async () => {
    let resolve: (value: { id: string; mime: string; size: number }) => void = () => {};
    state.store.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = importCanvasResource(pdf(), scope);
    await vi.waitFor(() => expect(state.store).toHaveBeenCalledOnce());
    state.workspace.activeBoardId = 'other'; changed(); state.workspace.activeBoardId = 'board'; changed();
    resolve({ id: 'media', mime: 'application/pdf', size: 8 });
    await expect(pending).rejects.toThrow('attachmentContextChanged');
    expect(state.workspace.updateBoard).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
  });

  it('rejects account changes after PDF extraction and never materializes an attachment', async () => {
    let resolve: (value: { text: string; pageCount: number }) => void = () => {};
    state.extract.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = importCanvasResource(pdf(), scope);
    await vi.waitFor(() => expect(state.extract).toHaveBeenCalledOnce());
    state.runtime = {}; resolve({ text: 'Documento da conta anterior', pageCount: 2 });
    await expect(pending).rejects.toThrow('attachmentContextChanged');
    expect(state.store).not.toHaveBeenCalled(); expect(state.workspace.updateBoard).not.toHaveBeenCalled(); expect(state.listeners.size).toBe(0);
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { useWorkspaceStore as store, flushWorkspacePersistence, ensureWorkspaceHydrated } from '@/workspace/store';
import { createBoardDocument } from './model';
import { createNoteCanvas } from '@/workspace/noteCanvasModel';

beforeEach(async () => {
  configureCloud(null);
  await store.persist.rehydrate();
  store.setState({ boards: {}, activeBoardId: null, projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'projects', legacyImported: false });
});

describe('independent board persistence', () => {
  it('creates and opens a board without requiring or creating a project or note', () => {
    const id = store.getState().createBoard();
    expect(store.getState()).toMatchObject({ activeBoardId: id, surface: 'boards', projects: {}, notes: {} });
    expect(store.getState().boards[id]).toMatchObject({ id, title: 'Novo quadro', archived: false, document: createBoardDocument() });
    const second = store.getState().createBoard('Rascunho');
    store.getState().openBoard(id);
    expect(store.getState().activeBoardId).toBe(id);
    expect(store.getState().boards[second].title).toBe('Rascunho');
    expect(() => store.getState().openBoard('missing')).toThrow('boardMissing');
  });

  it('keeps the document after archiving and allows recovery without changing identity', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      const id = store.getState().createBoard('Antes');
      clock.mockReturnValue(200);
      const document = { ...createBoardDocument(), viewport: { x: -10, y: 20, zoom: .7 }, items: [{ id: 'text', kind: 'text' as const, x: 20, y: 30, width: 200, height: 100, text: 'Ideia', color: '#abcdef', fontSize: 18 }] };
      store.getState().updateBoard(id, { title: '  Depois  ', document, archived: true });
      document.items[0].text = 'External mutation';
      expect(store.getState().boards[id]).toMatchObject({ id, title: 'Depois', archived: true, createdAt: 100, updatedAt: 200, document: { items: [{ text: 'Ideia' }] } });
      store.getState().updateBoard(id, { archived: false });
      expect(store.getState().boards[id].archived).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it('rejects an invalid edit atomically, preserving the prior record', () => {
    const id = store.getState().createBoard('Preservar'), before = store.getState().boards;
    expect(() => store.getState().updateBoard(id, { title: 'Mudar', document: { ...createBoardDocument(), viewport: { x: 0, y: 0, zoom: Infinity } } })).toThrow();
    expect(store.getState().boards).toBe(before);
    expect(() => store.getState().updateBoard('missing', { title: 'A' })).toThrow('boardMissing');
    expect(() => store.getState().createBoard('   ')).toThrow();
  });

  it('round-trips the board through actual workspace storage without transient selection', async () => {
    const id = store.getState().createBoard('Persistir');
    store.getState().updateBoard(id, { document: { ...createBoardDocument(), viewport: { x: -100, y: 50, zoom: 1.2 } } });
    await flushWorkspacePersistence();
    const raw = await idbGet<string>('cellproject-workspace'), envelope = JSON.parse(raw!);
    expect(envelope.state.boards[id].document.viewport).toEqual({ x: -100, y: 50, zoom: 1.2 });
    expect(envelope.state.activeBoardId).toBeUndefined();
    store.setState({ boards: {} }); await flushWorkspacePersistence();
    await idbSet('cellproject-workspace', raw);
    await store.persist.rehydrate();
    expect(store.getState().boards[id].title).toBe('Persistir');
  });

  it('hydrates a legacy envelope without inheriting boards from the prior workspace', async () => {
    store.getState().createBoard('Não vazar'); await flushWorkspacePersistence();
    await idbSet('cellproject-workspace', JSON.stringify({ version: 2, state: { projects: {}, tasks: {}, notes: {}, folders: {}, sprints: {}, legacyImported: true } }));
    await store.persist.rehydrate();
    expect(store.getState().boards).toEqual({});
    expect(store.getState().activeBoardId).toBeNull();
  });

  it('refuses a malformed remote board before replacing live data or writing partial state', async () => {
    store.getState().createBoard('Local'); await flushWorkspacePersistence();
    const before = store.getState(), raw = JSON.stringify({ version: 2, state: { boards: { bad: { id: 'bad', document: { version: 9 } } } } });
    const fetcher = vi.fn<typeof fetch>(), cloud = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: raw, revision: 1 }], media: [] }, fetcher);
    configureCloud(cloud);
    try {
      await expect(ensureWorkspaceHydrated()).rejects.toThrow('quadro inválido');
      expect(store.getState()).toBe(before);
      expect(cloud.get('cellproject-workspace')).toBe(raw);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { configureCloud(null); }
  });

  it('shares the raster budget in both directions between boards and notebooks', () => {
    const src = 'data:image/png;base64,iVBORw0KGgoA' + 'A'.repeat(1536 * 1024);
    const image = { kind: 'image' as const, src, label: '', x: 0, y: 0, width: 100, height: 100 };
    const threeImages = { ...createBoardDocument(), items: Array.from({ length: 3 }, (_, i) => ({ ...image, id: `image-${i}` })) };
    for (let i = 0; i < 3; i++) store.getState().updateBoard(store.getState().createBoard(), { document: threeImages });
    const noteId = store.getState().createNote();
    const canvas = { ...createNoteCanvas(), items: [{ ...image, id: 'first' }] };
    store.getState().updateNote(noteId, { canvas });
    const notesBefore = store.getState().notes;
    expect(() => store.getState().updateNote(noteId, { canvas: { ...canvas, items: [...canvas.items, { ...image, id: 'second' }] } })).toThrow('limite do workspace');
    expect(store.getState().notes).toBe(notesBefore);
    const fourth = store.getState().createBoard(), boardsBefore = store.getState().boards;
    expect(() => store.getState().updateBoard(fourth, { document: { ...createBoardDocument(), items: [{ ...image, id: 'fourth' }] } })).toThrow('limite do workspace');
    expect(store.getState().boards).toBe(boardsBefore);
  });
});

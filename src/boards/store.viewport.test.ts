import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get as idbGet } from 'idb-keyval';
import { configureCloud } from '@/cloud/runtime';
import { useWorkspaceStore as store, flushWorkspacePersistence } from '@/workspace/store';
import { boardRecordSchema, createBoardDocument, type BoardDocument } from './model';

beforeEach(async () => {
  configureCloud(null); await store.persist.rehydrate();
  store.setState({ boards: {}, activeBoardId: null, projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'boards' });
});
afterEach(async () => { vi.restoreAllMocks(); await flushWorkspacePersistence(); configureCloud(null); });

function populatedBoard() {
  const id = store.getState().createBoard('Navigation');
  store.getState().updateBoard(id, { document: { ...createBoardDocument(), items: [
    { id: 'ink', kind: 'drawing', x: 0, y: 0, width: 100, height: 100, points: [{ x: 1, y: 2, pressure: .5 }, { x: 3, y: 4 }], color: '#abcdef', widthStroke: 2 },
    { id: 'model', kind: 'model', x: 100, y: 100, width: 200, height: 200, scene: { version: 1, label: 'Synthetic box', objects: [{ id: 'box', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#abcdef' }] } },
  ], edges: [{ id: 'edge', source: 'ink', target: 'model' }] } });
  return id;
}

it('changes only the validated viewport while preserving scene, ink, items and edges identities', () => {
  const id = populatedBoard(), before = store.getState().boards[id], viewport = { x: -80, y: 90, zoom: 2 };
  const fullParse = vi.spyOn(boardRecordSchema, 'parse');
  store.getState().updateBoardViewport(id, viewport);
  const after = store.getState().boards[id];
  expect(after.document.viewport).toEqual(viewport); expect(after.document.viewport).not.toBe(viewport);
  expect(after.document.items).toBe(before.document.items); expect(after.document.edges).toBe(before.document.edges);
  expect(after.document.items[0]).toBe(before.document.items[0]); expect(after.document.items[1]).toBe(before.document.items[1]);
  expect(fullParse).not.toHaveBeenCalled();
  viewport.x = 999; expect(after.document.viewport.x).toBe(-80);
});

it('persists a narrow viewport update through the actual workspace storage', async () => {
  const id = populatedBoard();
  store.getState().updateBoardViewport(id, { x: -123, y: 45, zoom: .7 });
  await flushWorkspacePersistence();
  const envelope = JSON.parse((await idbGet<string>('cellproject-workspace'))!);
  expect(envelope.state.boards[id].document.viewport).toEqual({ x: -123, y: 45, zoom: .7 });
  expect(envelope.state.boards[id].document.items[0].points).toEqual([{ x: 1, y: 2, pressure: .5 }, { x: 3, y: 4 }]);
  expect(envelope.state.activeBoardId).toBeUndefined();
});

it('keeps an unchanged viewport and board record referentially stable', () => {
  const id = populatedBoard(), before = store.getState().boards;
  const notifications = vi.fn(), off = store.subscribe(notifications);
  try {
    store.getState().updateBoardViewport(id, { ...before[id].document.viewport });
    expect(store.getState().boards).toBe(before); expect(notifications).not.toHaveBeenCalled();
  } finally { off(); }
});

it.each([
  { x: Infinity, y: 0, zoom: 1 }, { x: 100001, y: 0, zoom: 1 }, { x: 0, y: -100001, zoom: 1 },
  { x: 0, y: 0, zoom: .01 }, { x: 0, y: 0, zoom: 9 }, { x: 0, y: 0, zoom: NaN },
  { x: 0, y: 0, zoom: 1, items: [] },
])('rejects invalid or expanded viewport input atomically: %j', viewport => {
  const id = populatedBoard(), before = store.getState().boards;
  expect(() => store.getState().updateBoardViewport(id, viewport)).toThrow();
  expect(store.getState().boards).toBe(before);
});

it('rejects viewport writes after archiving, leaving the active board or removing it', () => {
  const id = populatedBoard(), viewport = { x: 50, y: 60, zoom: 2 };
  store.getState().updateBoard(id, { archived: true }); const archived = store.getState().boards;
  expect(() => store.getState().updateBoardViewport(id, viewport)).toThrow('boardContextChanged'); expect(store.getState().boards).toBe(archived);
  store.getState().updateBoard(id, { archived: false }); store.getState().createBoard('Other'); const inactive = store.getState().boards;
  expect(() => store.getState().updateBoardViewport(id, viewport)).toThrow('boardContextChanged'); expect(store.getState().boards).toBe(inactive);
  expect(() => store.getState().updateBoardViewport('missing', viewport)).toThrow('boardMissing');
});

it('validates title and archive metadata without parsing or cloning the unchanged document', () => {
  const id = populatedBoard(), before = store.getState().boards[id], fullParse = vi.spyOn(boardRecordSchema, 'parse');
  store.getState().updateBoard(id, { title: '  Renamed  ', archived: true });
  expect(store.getState().boards[id].title).toBe('Renamed'); expect(store.getState().boards[id].archived).toBe(true);
  expect(store.getState().boards[id].document).toBe(before.document); expect(fullParse).not.toHaveBeenCalled();
  const stable = store.getState().boards;
  expect(() => store.getState().updateBoard(id, { title: ' '.repeat(10) })).toThrow();
  expect(() => store.getState().updateBoard(id, { archived: 'yes' } as never)).toThrow();
  expect(() => store.getState().updateBoard(id, { unexpected: true } as never)).toThrow();
  expect(store.getState().boards).toBe(stable);
});

it('retains full validation and the point budget for arbitrary document edits', () => {
  const id = populatedBoard(), before = store.getState().boards, document = before[id].document;
  const ink = document.items[0]; if (ink.kind !== 'drawing') throw new Error('missing drawing');
  const tooManyPoints: BoardDocument = { ...document, items: Array.from({ length: 25 }, (_, index) => ({ ...ink, id: `ink-${index}`, points: Array.from({ length: 4096 }, () => ({ x: 1, y: 1 })) })) };
  expect(() => store.getState().updateBoard(id, { document: tooManyPoints })).toThrow('boardDrawingPointBudget');
  expect(() => store.getState().updateBoard(id, { document: { ...document, items: [{ ...ink, points: [{ x: 101, y: 1 }] }] } })).toThrow('boardDrawingBounds');
  expect(() => store.getState().updateBoard(id, { document: undefined } as never)).toThrow();
  expect(store.getState().boards).toBe(before);
});

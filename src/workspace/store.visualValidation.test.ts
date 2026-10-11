import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureCloud } from '@/cloud/runtime';
import * as boardModel from '@/boards/model';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { createNoteCanvas, noteCanvasSchema } from './noteCanvasModel';
import { createNoteInk, noteInkSchema } from './noteInkModel';
import * as noteImages from './noteImages';

beforeEach(async () => {
  configureCloud(null); await store.persist.rehydrate();
  store.setState({ boards: {}, activeBoardId: null, projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'notes' });
});
afterEach(async () => { vi.restoreAllMocks(); await flushWorkspacePersistence(); configureCloud(null); });

function visualNote(points = 2) {
  const id = store.getState().createNote({ title: 'Synthetic note' });
  const strokes = Array.from({ length: points === 100000 ? 25 : 1 }, (_, index) => ({ id: `stroke-${index}`, color: '#abcdef', width: 2,
    points: Array.from({ length: points === 100000 ? 4000 : points }, (_, point) => ({ x: point % 100, y: Math.floor(point / 100), pressure: .5 })) }));
  store.getState().updateNote(id, { ink: { ...createNoteInk(), strokes }, canvas: { ...createNoteCanvas(), strokes } });
  return id;
}

it('edits text on a note with two 100000 point documents without traversing unchanged ink, canvas or image budgets', () => {
  const id = visualNote(100000), before = store.getState().notes[id];
  const inkParse = vi.spyOn(noteInkSchema, 'parse'), canvasParse = vi.spyOn(noteCanvasSchema, 'parse');
  const noteBudget = vi.spyOn(noteImages, 'assertNoteImageBudget'), workspaceBudget = vi.spyOn(boardModel, 'assertBoardWorkspaceImageBudget');
  for (let edit = 0; edit < 10; edit++) store.getState().updateNote(id, { title: `Edited ${edit}`, blocks: [{ id: 'text', type: 'text', text: `Text ${edit}` }] });
  const after = store.getState().notes[id];
  expect(after.title).toBe('Edited 9'); expect(after.blocks[0].text).toBe('Text 9');
  expect(after.ink).toBe(before.ink); expect(after.canvas).toBe(before.canvas);
  expect(inkParse).not.toHaveBeenCalled(); expect(canvasParse).not.toHaveBeenCalled();
  expect(noteBudget).not.toHaveBeenCalled(); expect(workspaceBudget).not.toHaveBeenCalled();
});

it('validates explicitly supplied visual payloads even when they use the existing reference', () => {
  const id = visualNote(), note = store.getState().notes[id];
  const inkParse = vi.spyOn(noteInkSchema, 'parse'), canvasParse = vi.spyOn(noteCanvasSchema, 'parse');
  const noteBudget = vi.spyOn(noteImages, 'assertNoteImageBudget'), workspaceBudget = vi.spyOn(boardModel, 'assertBoardWorkspaceImageBudget');
  store.getState().updateNote(id, { ink: note.ink, canvas: note.canvas });
  expect(inkParse).toHaveBeenCalledOnce(); expect(canvasParse).toHaveBeenCalledOnce();
  expect(noteBudget).toHaveBeenCalledOnce(); expect(workspaceBudget).toHaveBeenCalledOnce();
});

it('rejects malicious new visual data and preserves the prior note atomically', () => {
  const id = visualNote(), before = store.getState().notes;
  const note = before[id];
  expect(() => store.getState().updateNote(id, { title: 'Invalid', ink: { ...note.ink!, strokes: [{ ...note.ink!.strokes[0], points: [{ x: Infinity, y: 0 }] }] } })).toThrow();
  expect(() => store.getState().updateNote(id, { canvas: { ...note.canvas!, items: [{ id: 'image', kind: 'image', x: 0, y: 0, width: 100, height: 100, label: '', src: 'javascript:alert(1)' }] } })).toThrow();
  expect(() => store.getState().updateNote(id, { canvas: null } as never)).toThrow();
  expect(store.getState().notes).toBe(before);
});

it('keeps ownership checks active when only text changes on a visual note', () => {
  const id = visualNote(), before = store.getState().notes;
  expect(() => store.getState().updateNote(id, { title: 'Invalid', projectId: 'missing' })).toThrow('projectMissing');
  expect(() => store.getState().updateNote(id, { folderId: 'missing' })).toThrow('folderMissing');
  expect(() => store.getState().updateNote(id, { taskId: 'missing' })).toThrow('invalidTask');
  expect(store.getState().notes).toBe(before);
});

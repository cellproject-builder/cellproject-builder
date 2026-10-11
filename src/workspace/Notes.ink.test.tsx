import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '@/data/workspaceTransfer';
import { Notes } from './Notes';
import { createNoteCanvas } from './noteCanvasModel';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
const live = vi.hoisted(() => ({ preview: vi.fn(), finish: vi.fn(), remote: [] as unknown[] }));
vi.mock('@/ink/live', () => ({ useLiveInk: (scope: { surface: string }) => scope.surface === 'note' ? live : { ...live, remote: [] } }));

let root: Root, host: HTMLDivElement, id: string;
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} });
beforeEach(async () => {
  live.preview.mockClear(); live.finish.mockClear(); live.remote = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' }); await store.persist.rehydrate();
  store.setState({ notes: {}, projects: {}, tasks: {}, folders: {} });
  id = store.getState().createNote({ title: 'Título preservado' });
  store.getState().updateNote(id, { blocks: [{ id: 'paragraph', type: 'text', text: 'Desenhar por cima desta escrita.' }] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Notes initialNoteId={id} />); await flushWorkspacePersistence(); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
function openInk() {
  act(() => Simulate.click(button('Desenhar na nota')));
  act(() => Simulate.click(host.querySelector('[data-ink-palette-trigger]')!));
  const body = host.querySelector<HTMLElement>('[data-note-document]')!, stage = host.querySelector<HTMLElement>('[data-note-ink]')!;
  expect(body).not.toBeNull(); expect(stage).not.toBeNull();
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 600, 600));
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 600, 600));
  vi.spyOn(host.querySelector<HTMLElement>('[data-ink-anchor="block:paragraph"]')!, 'getBoundingClientRect').mockReturnValue(rect(10, 120, 600, 80));
  return stage;
}
function pointer(target: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', x: number, y: number) {
  act(() => Simulate[type](target, { pointerId: 7, clientX: x, clientY: y, button: 0, pressure: .6, pointerType: 'pen' } as never));
}
it('draws over the document while retaining text layout and keeping the notebook optional', () => {
  const paragraph = host.querySelector<HTMLTextAreaElement>('[data-block]')!;
  openInk();
  expect(host.querySelector('[data-block]')).toBe(paragraph);
  expect(paragraph.value).toBe('Desenhar por cima desta escrita.');
  expect(host.querySelector<HTMLElement>('.ws-note-notebook')?.hidden).toBe(true);
  expect(store.getState().notes[id].canvas).toBeUndefined();
  expect(host.querySelector<HTMLElement>('[data-note-ink]')?.style.pointerEvents).toBe('auto');
  act(() => Simulate.click(button('Voltar ao texto')));
  expect(host.querySelector<HTMLElement>('[data-note-ink]')?.style.pointerEvents).toBe('none');
  const inactive = host.querySelector<HTMLElement>('[data-note-ink]')!;
  pointer(inactive, 'pointerDown', 40, 140); pointer(inactive, 'pointerUp', 130, 160);
  expect(store.getState().notes[id].ink).toBeUndefined();
  act(() => Simulate.change(paragraph, { target: { value: 'Texto continua editável.' } } as never));
  expect(store.getState().notes[id].blocks[0].text).toBe('Texto continua editável.');
});

it('keeps optional notebook tools in one compact side palette and hides them while drawing over text', () => {
  act(() => { store.getState().updateNote(id, { canvas: createNoteCanvas() }); });
  const tools = host.querySelector('[aria-label="Ferramentas do caderno"]')!;
  expect(tools).not.toBeNull();
  expect(tools.closest('[data-note-document]')).not.toBeNull();
  expect(tools.matches('[data-ink-palette]')).toBe(true);
  expect(tools.closest('.note-canvas')).not.toBeNull();
  expect(host.querySelector('[data-ink-palette-controls]')).toBeNull();
  openInk();
  expect(host.querySelector('[aria-label="Ferramentas do caderno"]')).toBeNull();
  expect(host.querySelector('[aria-label="Ferramentas de tinta da nota"]')).not.toBeNull();
});
it('commits one anchored gesture and retains it through undo, backup and reload', async () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerMove', 110, 150);
  expect(store.getState().notes[id].ink).toBeUndefined();
  expect(live.preview).toHaveBeenCalled();
  pointer(stage, 'pointerUp', 130, 160);
  const ink = store.getState().notes[id].ink!;
  expect(ink.strokes).toHaveLength(1);
  expect(live.finish).toHaveBeenCalledWith(ink.strokes[0].id, false);
  expect(ink.strokes[0].anchor).toEqual({ id: 'block:paragraph', x: 0, y: 200, width: 1200 });
  expect(ink.strokes[0].points[0]).toMatchObject({ x: 60, y: 240, pressure: .6 });
  expect(restoreWorkspaceBackup(createWorkspaceBackup(store.getState(), Date.now())).notes[id].ink).toEqual(ink);
  await act(async () => { await flushWorkspacePersistence(); await store.persist.rehydrate(); });
  expect(store.getState().notes[id].ink).toEqual(ink);
  act(() => Simulate.click(button('Desfazer tinta')));
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(0);
  act(() => Simulate.click(button('Refazer tinta')));
  expect(store.getState().notes[id].ink).toEqual(ink);
});

it('renders a remote preview without saving it, then deduplicates the canonical stroke', () => {
  const stroke = { id: 'remote-ink', color: '#abcdef', width: 2, points: [{ x: 30, y: 40 }, { x: 100, y: 60 }] };
  live.remote = [{ sender: 'other-device', gestureId: stroke.id, stroke, committed: false }];
  act(() => { store.getState().updateNote(id, { title: 'Prévia remota' }); });
  expect(host.querySelector('[data-remote-ink]')).not.toBeNull();
  expect(store.getState().notes[id].ink).toBeUndefined();
  act(() => { store.getState().updateNote(id, { ink: { version: 1, width: 1200, height: 900, strokes: [stroke] } }); });
  expect(host.querySelector('[data-remote-ink]')).toBeNull();
  expect(host.querySelectorAll('[data-note-ink-stroke="remote-ink"]')).toHaveLength(1);
});
it('discards a cancelled gesture and cannot finish a gesture after deleting its note', async () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerMove', 110, 150); pointer(stage, 'pointerCancel', 110, 150);
  expect(store.getState().notes[id].ink).toBeUndefined();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerMove', 110, 150);
  await act(async () => { store.getState().trashNote(id); await flushWorkspacePersistence(); });
  pointer(stage, 'pointerUp', 130, 160);
  expect(store.getState().notes[id].ink).toBeUndefined();
});
it('rebases undo onto the latest ink and retains other text and notebook edits', () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerUp', 130, 160);
  const ink = store.getState().notes[id].ink!;
  act(() => { store.getState().updateNote(id, { title: 'Título revisto', ink: { ...ink, strokes: [...ink.strokes, { id: 'concurrent', color: '#abcdef', width: 2, points: [{ x: 300, y: 400 }] }] } }); });
  act(() => Simulate.click(button('Desfazer tinta')));
  expect(store.getState().notes[id].ink?.strokes.map(stroke => stroke.id)).toEqual(['concurrent']);
  expect(store.getState().notes[id].title).toBe('Título revisto');
  expect(store.getState().notes[id].blocks[0].text).toBe('Desenhar por cima desta escrita.');
});
it('follows a resized text section and preserves fallback ink after removing that section', () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerUp', 130, 160);
  const ink = store.getState().notes[id].ink!;
  vi.mocked(host.querySelector<HTMLElement>('[data-ink-anchor="block:paragraph"]')!.getBoundingClientRect).mockReturnValue(rect(310, 220, 300, 100));
  act(() => { store.getState().updateNote(id, { title: 'Mudança de layout' }); });
  const path = host.querySelector('[data-note-ink-stroke]')!;
  expect(path.parentElement?.getAttribute('transform')).toBe('translate(600 400) scale(0.5) translate(0 -200)');
  expect(store.getState().notes[id].ink).toEqual(ink);
  act(() => { store.getState().updateNote(id, { blocks: [{ id: 'replacement', type: 'text', text: 'A tinta continua preservada.' }] }); });
  expect(path.parentElement?.getAttribute('transform')).toBeNull();
  expect(store.getState().notes[id].ink).toEqual(ink);
});
it('retains coalesced stylus pressure samples and makes erasing reversible', () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140);
  act(() => Simulate.pointerMove(stage, { pointerId: 7, clientX: 130, clientY: 160, button: 0, pressure: .9, pointerType: 'pen', nativeEvent: { getCoalescedEvents: () => [{ clientX: 70, clientY: 145, pressure: .3, pointerType: 'pen' }, { clientX: 100, clientY: 150, pressure: .7, pointerType: 'pen' }] } } as never));
  pointer(stage, 'pointerUp', 130, 160);
  expect(store.getState().notes[id].ink?.strokes[0].points).toMatchObject([{ x: 60, pressure: .6 }, { x: 120, pressure: .3 }, { x: 180, pressure: .7 }, { x: 240, pressure: .9 }]);
  act(() => Simulate.click(button('Borracha na nota')));
  pointer(stage, 'pointerDown', 70, 145); pointer(stage, 'pointerUp', 70, 145);
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(0);
  act(() => Simulate.click(button('Desfazer tinta')));
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(1);
});
it('erases anchored ink crossed by a fast sweep as one reversible operation', () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerUp', 130, 160);
  const original = store.getState().notes[id].ink!;
  act(() => Simulate.click(button('Borracha na nota')));
  pointer(stage, 'pointerDown', 10, 150); pointer(stage, 'pointerMove', 200, 150); pointer(stage, 'pointerCancel', 200, 150);
  expect(store.getState().notes[id].ink).toEqual(original);
  pointer(stage, 'pointerDown', 10, 150); pointer(stage, 'pointerMove', 200, 150);
  expect(store.getState().notes[id].ink).toEqual(original);
  pointer(stage, 'pointerUp', 200, 150);
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(0);
  expect(store.getState().notes[id].blocks[0].text).toBe('Desenhar por cima desta escrita.');
  act(() => Simulate.click(button('Desfazer tinta')));
  expect(store.getState().notes[id].ink).toEqual(original);
});
it('uses coalesced eraser segments even when the delivered event returns outside the drawing', () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerUp', 130, 160);
  act(() => Simulate.click(button('Borracha na nota')));
  pointer(stage, 'pointerDown', 10, 150);
  act(() => Simulate.pointerMove(stage, { pointerId: 7, clientX: 10, clientY: 300, button: 0, pointerType: 'pen', nativeEvent: { getCoalescedEvents: () => [{ clientX: 200, clientY: 150, pointerType: 'pen' }] } } as never));
  pointer(stage, 'pointerUp', 10, 300);
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(0);
});
it('draws and erases near the end of a long note while respecting the document height limit', () => {
  const stage = openInk(), body = host.querySelector<HTMLElement>('[data-note-document]')!;
  vi.mocked(body.getBoundingClientRect).mockReturnValue(rect(10, 20, 600, 3000));
  vi.mocked(stage.getBoundingClientRect).mockReturnValue(rect(10, 20, 600, 3000));
  pointer(stage, 'pointerDown', 40, 2920); pointer(stage, 'pointerUp', 130, 2940);
  expect(store.getState().notes[id].ink).toMatchObject({ height: 6000, strokes: [{ points: [{ x: 60, y: 5800 }, { x: 240, y: 5840 }] }] });
  act(() => Simulate.click(button('Borracha na nota')));
  pointer(stage, 'pointerDown', 10, 2930); pointer(stage, 'pointerUp', 200, 2930);
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(0);
  act(() => Simulate.click(button('Desenhar livremente na nota')));
  vi.mocked(body.getBoundingClientRect).mockReturnValue(rect(10, 20, 600, 8000));
  vi.mocked(stage.getBoundingClientRect).mockReturnValue(rect(10, 20, 600, 8000));
  pointer(stage, 'pointerDown', 40, 7000); pointer(stage, 'pointerUp', 130, 7010);
  expect(store.getState().notes[id].ink?.height).toBe(10000);
  expect(store.getState().notes[id].ink?.strokes[0].points.every(point => point.y <= 10000)).toBe(true);
});
it('discards pending ink when switching to another note', async () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerMove', 110, 150);
  let other = ''; act(() => { other = store.getState().createNote({ title: 'Outra nota' }); });
  await act(async () => { root.render(<Notes key={other} initialNoteId={other} />); await flushWorkspacePersistence(); });
  pointer(stage, 'pointerUp', 130, 160);
  expect(store.getState().notes[id].ink).toBeUndefined();
  expect(store.getState().notes[other].ink).toBeUndefined();
});
it('selects a stroke crossing the lasso and deletes it as one undoable action', () => {
  const stage = openInk();
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerUp', 130, 160);
  act(() => Simulate.click(button('Laço de seleção na nota')));
  pointer(stage, 'pointerDown', 70, 135); pointer(stage, 'pointerMove', 100, 135); pointer(stage, 'pointerMove', 100, 170); pointer(stage, 'pointerMove', 70, 170); pointer(stage, 'pointerUp', 70, 135);
  expect(button('Apagar tinta selecionada').disabled).toBe(false);
  act(() => Simulate.click(button('Apagar tinta selecionada')));
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(0);
  act(() => Simulate.click(button('Desfazer tinta')));
  expect(store.getState().notes[id].ink?.strokes).toHaveLength(1);
});
it('moves anchored highlighter ink after a section grows without exceeding the saved brush width', () => {
  const stage = openInk(), anchor = host.querySelector<HTMLElement>('[data-ink-anchor="block:paragraph"]')!;
  vi.mocked(anchor.getBoundingClientRect).mockReturnValue(rect(10, 120, 300, 80));
  act(() => Simulate.click(host.querySelector('[data-ink-brush-trigger]')!));
  act(() => Simulate.click(button('Marca-texto')));
  pointer(stage, 'pointerDown', 40, 140); pointer(stage, 'pointerUp', 130, 160);
  vi.mocked(anchor.getBoundingClientRect).mockReturnValue(rect(10, 120, 600, 80));
  act(() => { store.getState().updateNote(id, { title: 'Seção ampliada' }); });
  act(() => Simulate.click(button('Laço de seleção na nota')));
  pointer(host.querySelector('[data-note-ink-stroke]')!, 'pointerDown', 70, 160); pointer(stage, 'pointerMove', 90, 170); pointer(stage, 'pointerUp', 90, 170);
  const stroke = store.getState().notes[id].ink!.strokes[0];
  expect(stroke.points[0]).toMatchObject({ x: 80, y: 250 });
  expect(stroke.width).toBe(18);
  expect(stroke.anchor?.width).toBe(600);
});

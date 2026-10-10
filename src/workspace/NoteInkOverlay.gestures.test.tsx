import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { NoteInkOverlay } from './NoteInkOverlay';
import { useWorkspaceStore as store } from './store';

const live = vi.hoisted(() => ({ preview: vi.fn(), finish: vi.fn(), remote: [] }));
vi.mock('@/ink/live', () => ({ useLiveInk: () => live }));
let root: Root, host: HTMLDivElement, id: string, paper: HTMLDivElement, body: HTMLDivElement, stage: HTMLDivElement, switchNote: (id: string) => void;
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  live.preview.mockClear(); live.finish.mockClear();
  store.setState({ notes: {}, projects: {}, tasks: {}, folders: {} }); id = store.getState().createNote({ title: 'Nota com texto' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  function Harness() {
    const [noteId, setNoteId] = useState(id); switchNote = setNoteId;
    const note = store(state => state.notes[noteId]), bodyRef = useRef<HTMLDivElement>(null), toolsRef = useRef<HTMLDivElement>(null), [drawing, setDrawing] = useState(true);
    return <div className="ws-note-editor"><div ref={toolsRef} /><div className="ws-note-paper"><div className="ws-note-document" ref={bodyRef}><textarea data-ink-anchor="title" defaultValue="Nota com texto" /><NoteInkOverlay note={note} drawing={drawing} onDrawingChange={setDrawing} bodyRef={bodyRef} toolsRef={toolsRef} /></div></div></div>;
  }
  act(() => root.render(<Harness />));
  paper = host.querySelector('.ws-note-paper')!; body = host.querySelector('.ws-note-document')!; stage = host.querySelector('[data-note-ink]')!;
  Object.defineProperty(paper, 'clientWidth', { configurable: true, value: 600 });
  vi.spyOn(paper, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 400));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => { const zoom = Number(body.style.zoom) || 1; return rect(-paper.scrollLeft, -paper.scrollTop, 600 * zoom, 600 * zoom); });
  vi.spyOn(body.querySelector('textarea')!, 'getBoundingClientRect').mockImplementation(() => { const zoom = Number(body.style.zoom) || 1; return rect(-paper.scrollLeft, 50 * zoom - paper.scrollTop, 600 * zoom, 80 * zoom); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture', x: number, y: number, extra: Record<string, unknown> = {}) {
  act(() => Simulate[type](stage, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, pressure: .7, ...extra } as never));
}
function openPalette() { const trigger = host.querySelector('[data-ink-palette-trigger]'); expect(trigger).not.toBeNull(); act(() => Simulate.click(trigger!)); }
function enableFinger() { openPalette(); act(() => Simulate.change(host.querySelector('[aria-label="Desenhar com dedo"]')!, { target: { checked: true } } as never)); }

it('pans and pinches the text document with touch without saving ink or changing the text', () => {
  const before = store.getState().notes[id]; paper.scrollLeft = 100; paper.scrollTop = 100;
  pointer('pointerDown', 100, 100); pointer('pointerMove', 80, 70);
  expect(paper.scrollLeft).toBe(120); expect(paper.scrollTop).toBe(130);
  pointer('pointerDown', 180, 70, { pointerId: 2, isPrimary: false }); pointer('pointerMove', 280, 70, { pointerId: 2 });
  expect(body.style.zoom).toBe('2');
  pointer('pointerUp', 80, 70); pointer('pointerUp', 280, 70, { pointerId: 2 });
  expect(store.getState().notes[id]).toBe(before); expect(live.preview).not.toHaveBeenCalled(); expect(hasActiveDataIngestions()).toBe(false);
});
it('keeps the palette outside scaled/scrolled writing, with exit and undo together', () => {
  openPalette(); const palette = host.querySelector('[data-ink-palette]')!;
  expect(palette.closest('.ws-note-document')).toBeNull(); expect(palette.closest('.ws-note-editor')).not.toBeNull();
  expect(palette.querySelector('[aria-label="Voltar ao texto"]')).not.toBeNull(); expect(palette.querySelector('[aria-label="Desfazer tinta"]')).not.toBeNull();
});
it('ignores palm movement while pen draws and stops the held pen on blur', () => {
  pointer('pointerDown', 20, 60, { pointerType: 'pen' }); expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerDown', 100, 100, { pointerId: 2 }); pointer('pointerMove', 200, 200, { pointerId: 2 });
  expect(paper.scrollTop).toBe(0); expect(paper.scrollLeft).toBe(0);
  act(() => window.dispatchEvent(new Event('blur'))); pointer('pointerUp', 40, 80, { pointerType: 'pen' });
  expect(store.getState().notes[id].ink).toBeUndefined(); expect(live.finish).toHaveBeenCalledWith(expect.any(String), true); expect(hasActiveDataIngestions()).toBe(false);
});
it('opts into finger ink and cancels it for pinch without releasing a still owned touch capture', () => {
  enableFinger(); const owned = new Set<number>(), release = vi.fn((pointerId: number) => { owned.delete(pointerId); pointer('lostPointerCapture', 0, 0, { pointerId }); });
  Object.assign(stage, { setPointerCapture: (pointerId: number) => owned.add(pointerId), hasPointerCapture: (pointerId: number) => owned.has(pointerId), releasePointerCapture: release });
  pointer('pointerDown', 10, 60); pointer('pointerMove', 40, 60); pointer('pointerDown', 80, 60, { pointerId: 2, isPrimary: false });
  expect(live.finish).toHaveBeenCalledWith(expect.any(String), true); expect(release).not.toHaveBeenCalled(); expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerMove', 120, 60, { pointerId: 2 }); expect(body.style.zoom).toBe('2');
  pointer('pointerUp', 120, 60, { pointerId: 2 }); pointer('pointerMove', 50, 60); pointer('pointerUp', 50, 60); expect(store.getState().notes[id].ink).toBeUndefined();
  pointer('pointerDown', 20, 60); pointer('pointerUp', 40, 80); expect(store.getState().notes[id].ink!.strokes).toHaveLength(1);
});
it('draws in the same logical anchored coordinates after zooming and clamps local zoom', () => {
  pointer('pointerDown', 0, 0); pointer('pointerDown', 100, 0, { pointerId: 2 }); pointer('pointerMove', 200, 0, { pointerId: 2 }); pointer('pointerUp', 0, 0); pointer('pointerUp', 200, 0, { pointerId: 2 });
  expect(body.style.zoom).toBe('2'); paper.scrollLeft = 0; paper.scrollTop = 0;
  pointer('pointerDown', 40, 120, { pointerType: 'pen' }); pointer('pointerUp', 80, 160, { pointerType: 'pen' });
  expect(store.getState().notes[id].ink!.strokes[0]).toMatchObject({ anchor: { id: 'title', x: 0, y: 100, width: 1200 }, points: [{ x: 40, y: 120, pressure: .7 }, { x: 80, y: 160, pressure: .7 }] });
  pointer('pointerDown', 0, 0); pointer('pointerDown', 100, 0, { pointerId: 2 }); pointer('pointerMove', 1000, 0, { pointerId: 2 }); expect(body.style.zoom).toBe('3');
});
it('keeps anchored logical coordinates after zoom and document scrolling', () => {
  pointer('pointerDown', 0, 0); pointer('pointerDown', 100, 0, { pointerId: 2 }); pointer('pointerMove', 200, 0, { pointerId: 2 }); pointer('pointerUp', 0, 0); pointer('pointerUp', 200, 0, { pointerId: 2 });
  paper.scrollLeft = 50; paper.scrollTop = 100;
  pointer('pointerDown', 40, 120, { pointerType: 'pen' }); pointer('pointerUp', 80, 160, { pointerType: 'pen' });
  expect(store.getState().notes[id].ink!.strokes[0]).toMatchObject({ anchor: { id: 'title', x: 0, y: 100, width: 1200 }, points: [{ x: 90, y: 220, pressure: .7 }, { x: 130, y: 260, pressure: .7 }] });
  expect(stage.style.height).toBe('600px');
});
it('resets view and ownership on another note, and restores temporary body styles on unmount', () => {
  pointer('pointerDown', 0, 0); pointer('pointerDown', 100, 0, { pointerId: 2 }); pointer('pointerMove', 200, 0, { pointerId: 2 }); pointer('pointerUp', 0, 0); pointer('pointerUp', 200, 0, { pointerId: 2 });
  pointer('pointerDown', 40, 120, { pointerType: 'pen' });
  const other = store.getState().createNote({ title: 'Outra nota' });
  act(() => switchNote(other)); pointer('pointerUp', 80, 160, { pointerType: 'pen' });
  expect(body.style.zoom).toBe('1'); expect(paper.scrollTop).toBe(0); expect(paper.scrollLeft).toBe(0);
  expect(store.getState().notes[id].ink).toBeUndefined(); expect(store.getState().notes[other].ink).toBeUndefined(); expect(hasActiveDataIngestions()).toBe(false);
  act(() => root.render(null)); expect(body.style.width).toBe(''); expect(['', undefined]).toContain(body.style.zoom);
});

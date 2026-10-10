import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { createNoteCanvas, type NoteCanvasDocument } from './noteCanvasModel';
import { NoteCanvas } from './NoteCanvas';
const live = vi.hoisted(() => ({ preview: vi.fn(), finish: vi.fn(), remote: [] as unknown[] }));
vi.mock('@/ink/live', () => ({ useLiveInk: () => live }));

let root: Root, host: HTMLDivElement, last: NoteCanvasDocument, replace: (doc: NoteCanvasDocument) => void;
const image = { id: 'image-1', kind: 'image' as const, x: 100, y: 100, width: 200, height: 150, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1EAAAAASUVORK5CYII=', label: 'Esboço' };
beforeEach(() => {
  live.preview.mockClear(); live.finish.mockClear(); live.remote = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function mount(initial = createNoteCanvas(), drawing = true, readOnly = false) {
  function Harness() {
    const [doc, setDoc] = useState(initial), [draw, setDraw] = useState(drawing);
    replace = setDoc;
    last = doc;
    return <NoteCanvas document={doc} onChange={setDoc} drawing={draw} onDrawingChange={setDraw} readOnly={readOnly} onAddImage={() => {}} onGenerate={() => {}} liveDocumentId="test-note" />;
  }
  act(() => root.render(<Harness />));
  const stage = host.querySelector<HTMLElement>('[data-note-canvas]')!;
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 450, width: 600, height: 450, toJSON() {} });
  return stage;
}
function pointer(target: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', x: number, y: number) {
  act(() => Simulate[type](target, { pointerId: 1, clientX: x, clientY: y, button: 0, pressure: .5, pointerType: 'pen' } as never));
}
describe('free note canvas', () => {
  it('sweeps the eraser between sparse samples and keeps cancelling and undoing atomic', () => {
    const crossed = { id: 'crossed', color: '#abcdef', width: 3, tool: 'pen' as const, points: [{ x: 100, y: 50 }, { x: 100, y: 150 }] };
    const untouched = { ...crossed, id: 'untouched', points: [{ x: 100, y: 300 }, { x: 100, y: 350 }] };
    const stage = mount({ ...createNoteCanvas(), strokes: [crossed, untouched], items: [image] });
    act(() => Simulate.click(host.querySelector('[aria-label="Borracha"]')!));
    pointer(stage, 'pointerDown', 0, 50); pointer(stage, 'pointerMove', 100, 50); pointer(stage, 'pointerCancel', 100, 50);
    expect(last.strokes).toEqual([crossed, untouched]);
    pointer(stage, 'pointerDown', 0, 50); pointer(stage, 'pointerMove', 100, 50);
    expect(last.strokes).toEqual([crossed, untouched]);
    pointer(stage, 'pointerUp', 100, 50);
    expect(last.strokes).toEqual([untouched]);
    expect(last.items).toEqual([image]);
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.strokes).toEqual([untouched, crossed]);
  });

  it('sweeps the eraser through native coalesced corners instead of connecting only event endpoints', () => {
    const crossed = { id: 'coalesced-crossing', color: '#abcdef', width: 2, points: [{ x: 100, y: 50 }, { x: 100, y: 150 }] };
    const stage = mount({ ...createNoteCanvas(), strokes: [crossed] });
    act(() => Simulate.click(host.querySelector('[aria-label="Borracha"]')!));
    pointer(stage, 'pointerDown', 0, 50);
    act(() => Simulate.pointerMove(stage, { pointerId: 1, clientX: 0, clientY: 150, button: 0, pointerType: 'pen', nativeEvent: { getCoalescedEvents: () => [{ clientX: 100, clientY: 50, pointerType: 'pen' }] } } as never));
    pointer(stage, 'pointerUp', 0, 150);
    expect(last.strokes).toHaveLength(0);
  });

  it('sends coalesced live ink without saving a partial gesture and ends it once', () => {
    const stage = mount();
    pointer(stage, 'pointerDown', 10, 20);
    act(() => Simulate.pointerMove(stage, { pointerId: 1, clientX: 60, clientY: 40, button: 0, pressure: .9, pointerType: 'pen', nativeEvent: { getCoalescedEvents: () => [{ clientX: 20, clientY: 25, pointerType: 'pen', pressure: .3 }] } } as never));
    expect(last.strokes).toHaveLength(0);
    expect(live.preview).toHaveBeenCalled();
    pointer(stage, 'pointerUp', 60, 40);
    expect(last.strokes[0].points).toMatchObject([{ x: 20, pressure: .5 }, { x: 40, pressure: .3 }, { x: 120, pressure: .9 }]);
    expect(live.finish).toHaveBeenCalledExactlyOnceWith(last.strokes[0].id, false);
  });
  it('persists distinct ink tools and transparency in the optional notebook', () => {
    const stage = mount();
    act(() => Simulate.click(host.querySelector('[aria-label="Marca-texto"]')!));
    pointer(stage, 'pointerDown', 10, 20); pointer(stage, 'pointerMove', 60, 40); pointer(stage, 'pointerUp', 60, 40);
    expect(last.strokes[0]).toMatchObject({ tool: 'highlighter', opacity: .28 });
    expect(last.strokes[0].width).toBeGreaterThan(3);
    const highlight = host.querySelector(`[data-note-stroke="${last.strokes[0].id}"]`)!;
    expect(Number(highlight.getAttribute('opacity'))).toBeLessThan(1);
    act(() => Simulate.click(host.querySelector('[aria-label="Monoline"]')!));
    pointer(stage, 'pointerDown', 10, 60); pointer(stage, 'pointerUp', 60, 70);
    expect(last.strokes[1]).toMatchObject({ tool: 'monoline' });
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.strokes).toHaveLength(1);
    expect(last.strokes[0].tool).toBe('highlighter');
  });
  it('does not traverse existing ink on each pointer move and updates replaced strokes', () => {
    let reads = 0;
    const points = Array.from({ length: 1000 }, (_, index) => ({ get x() { reads++; return index; }, y: 20 }));
    const original = { id: 'saved-ink', color: '#aaaaaa', width: 2, points };
    const initial = { ...createNoteCanvas(), strokes: [original] };
    const stage = mount(initial);
    const saved = host.querySelector('[data-note-stroke="saved-ink"]')!;
    const path = saved.getAttribute('d');
    reads = 0;
    pointer(stage, 'pointerDown', 10, 30);
    for (let index = 0; index < 20; index++) pointer(stage, 'pointerMove', 20 + index, 40);
    expect(saved.getAttribute('d')).toBe(path);
    expect(host.querySelectorAll('[data-note-stroke]')).toHaveLength(2);
    expect(reads).toBe(0);
    pointer(stage, 'pointerCancel', 40, 40);
    act(() => replace({ ...initial, strokes: [{ ...original, points: [{ x: 10, y: 10 }, { x: 30, y: 30 }] }] }));
    expect(saved.getAttribute('d')).toBe('M10,10 L30,30');
  });
  it('commits one pressure stroke in logical coordinates and undoes/redoes the gesture', () => {
    const stage = mount();
    pointer(stage, 'pointerDown', 10, 20); pointer(stage, 'pointerMove', 60, 40);
    expect(last.strokes).toHaveLength(0);
    pointer(stage, 'pointerUp', 60, 40);
    expect(last.strokes[0].points[0]).toEqual({ x: 20, y: 40, pressure: .5 });
    expect(last.strokes[0].points.at(-1)).toEqual({ x: 120, y: 80, pressure: .5 });
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.strokes).toHaveLength(0);
    act(() => Simulate.click(host.querySelector('[aria-label="Refazer"]')!));
    expect(last.strokes).toHaveLength(1);
  });
  it('discards cancelled drawing and cancelled movement without saving partial operations', () => {
    const stage = mount({ ...createNoteCanvas(), items: [image] });
    pointer(stage, 'pointerDown', 10, 20); pointer(stage, 'pointerMove', 30, 40); pointer(stage, 'pointerCancel', 30, 40);
    expect(last.strokes).toHaveLength(0);
    act(() => Simulate.click(host.querySelector('[aria-label="Selecionar"]')!));
    const item = host.querySelector('[data-note-item="image-1"]')!;
    pointer(item, 'pointerDown', 60, 60); pointer(stage, 'pointerMove', 120, 100); pointer(stage, 'pointerCancel', 120, 100);
    expect(last.items[0]).toEqual(image);
  });
  it('moves and resizes the object itself, then supports keyboard deletion with undo', () => {
    const stage = mount({ ...createNoteCanvas(), items: [image] }, false);
    const item = host.querySelector('[data-note-item="image-1"]')!;
    pointer(item, 'pointerDown', 60, 60); pointer(stage, 'pointerMove', 100, 90); pointer(stage, 'pointerUp', 100, 90);
    expect(last.items[0]).toMatchObject({ x: 180, y: 160 });
    const handle = host.querySelector('[aria-label="Redimensionar objeto"]')!;
    pointer(handle, 'pointerDown', 190, 155); pointer(stage, 'pointerMove', 220, 185); pointer(stage, 'pointerUp', 220, 185);
    expect(last.items[0].width).toBeGreaterThan(200);
    act(() => Simulate.keyDown(stage, { key: 'Delete' }));
    expect(last.items).toHaveLength(0);
    act(() => Simulate.keyDown(stage, { key: 'z', ctrlKey: true }));
    expect(last.items).toHaveLength(1);
  });
  it('draws a ruler segment and erases a stroke as reversible actions', () => {
    const stage = mount();
    act(() => Simulate.click(host.querySelector('[aria-label="Opções de desenho"]')!));
    act(() => Simulate.click(host.querySelector('[aria-label="Régua — traço reto"]')!));
    pointer(stage, 'pointerDown', 10, 10); pointer(stage, 'pointerMove', 30, 80); pointer(stage, 'pointerMove', 60, 20); pointer(stage, 'pointerUp', 60, 20);
    expect(last.strokes[0].points).toHaveLength(2);
    act(() => Simulate.click(host.querySelector('[aria-label="Borracha"]')!));
    pointer(stage, 'pointerDown', 30, 15); pointer(stage, 'pointerUp', 30, 15);
    expect(last.strokes).toHaveLength(0);
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.strokes).toHaveLength(1);
  });
  it('retains diagram controls without dragging or selecting the object', () => {
    const diagram = { id: 'diagram-1', kind: 'diagram' as const, x: 20, y: 30, width: 600, height: 450, diagram: torqueDiagram(), values: {} };
    mount({ ...createNoteCanvas(), items: [diagram] }, false);
    const range = host.querySelector<HTMLInputElement>('[aria-label="Carga"]')!;
    act(() => Simulate.change(range, { target: { value: '.5' } } as never));
    expect(last.items[0]).toMatchObject({ x: 20, y: 30, values: { mass: .5 } });
    expect(host.querySelector('[aria-label="Redimensionar objeto"]')).toBeNull();
  });
  it('does not mutate a read-only notebook', () => {
    const stage = mount({ ...createNoteCanvas(), items: [image] }, true, true);
    pointer(stage, 'pointerDown', 10, 10); pointer(stage, 'pointerMove', 80, 80); pointer(stage, 'pointerUp', 80, 80);
    expect(last.strokes).toHaveLength(0);
    expect(host.querySelector('[aria-label="Caneta"]')).toBeNull();
  });
  it('preserves an image arriving during a drawing gesture and when undoing that gesture', () => {
    const stage = mount();
    pointer(stage, 'pointerDown', 10, 20); pointer(stage, 'pointerMove', 60, 40);
    act(() => replace({ ...last, items: [image] }));
    pointer(stage, 'pointerUp', 60, 40);
    expect(last.items).toEqual([image]);
    expect(last.strokes).toHaveLength(1);
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.items).toEqual([image]);
    expect(last.strokes).toHaveLength(0);
  });
  it('undoes an older gesture without discarding a diagram added afterward', () => {
    const stage = mount();
    pointer(stage, 'pointerDown', 10, 20); pointer(stage, 'pointerUp', 60, 40);
    const diagram = { id: 'diagram-1', kind: 'diagram' as const, x: 20, y: 30, width: 600, height: 450, diagram: torqueDiagram(), values: {} };
    act(() => replace({ ...last, items: [diagram] }));
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.items).toEqual([diagram]);
    expect(last.strokes).toHaveLength(0);
  });
  it('persists text immediately while grouping consecutive edits into one undo operation', () => {
    const stage = mount();
    act(() => Simulate.click(host.querySelector('[aria-label="Adicionar texto"]')!));
    pointer(stage, 'pointerDown', 80, 90);
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Texto do objeto"]')!;
    act(() => Simulate.change(input, { target: { value: 'Distância' } } as never));
    expect(last.items[0].kind === 'text' && last.items[0].text).toBe('Distância');
    act(() => Simulate.change(input, { target: { value: 'Distância entre os eixos' } } as never));
    act(() => Simulate.blur(input));
    expect(last.items[0].kind === 'text' && last.items[0].text).toBe('Distância entre os eixos');
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.items[0].kind === 'text' && last.items[0].text).toBe('');
  });
  it('retains the latest text if the editor unmounts without blur and preserves concurrent additions', () => {
    const stage = mount();
    act(() => Simulate.click(host.querySelector('[aria-label="Adicionar texto"]')!));
    pointer(stage, 'pointerDown', 80, 90);
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Texto do objeto"]')!;
    act(() => Simulate.change(input, { target: { value: 'Esboço' } } as never));
    act(() => replace({ ...last, items: [...last.items, image] }));
    act(() => Simulate.change(input, { target: { value: 'Esboço atualizado' } } as never));
    expect(last.items).toHaveLength(2);
    expect(last.items[0].kind === 'text' && last.items[0].text).toBe('Esboço atualizado');
    act(() => Simulate.click(host.querySelector('[aria-label="Desfazer"]')!));
    expect(last.items[0].kind === 'text' && last.items[0].text).toBe('');
    expect(last.items[1]).toEqual(image);
    act(() => Simulate.click(host.querySelector('[aria-label="Refazer"]')!));
    act(() => root.render(null));
    expect(last.items[0].kind === 'text' && last.items[0].text).toBe('Esboço atualizado');
    expect(last.items[1]).toEqual(image);
  });
  it('supports keyboard focus and nudge of an image without entering drawing mode', () => {
    const stage = mount({ ...createNoteCanvas(), items: [image] }, false);
    const item = host.querySelector<HTMLElement>('[data-note-item="image-1"]')!;
    expect(item.tabIndex).toBe(0);
    act(() => Simulate.focus(item));
    act(() => Simulate.keyDown(item, { key: 'ArrowRight', shiftKey: true }));
    expect(last.items[0]).toMatchObject({ x: 110, y: 100 });
    expect(stage.classList.contains('tool-select')).toBe(true);
  });
  it('zooms only the notebook viewport and retains logical drawing coordinates', () => {
    const initial = createNoteCanvas(), stage = mount(initial);
    const viewport = host.querySelector('.note-canvas-viewport');
    expect(viewport?.contains(stage)).toBe(true);
    const enlarge = host.querySelector('[aria-label="Ampliar caderno"]')!;
    act(() => Simulate.click(enlarge)); act(() => Simulate.click(enlarge));
    expect(stage.style.width).toBe('200%');
    expect(last).toBe(initial);
    vi.mocked(stage.getBoundingClientRect).mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900, toJSON() {} });
    pointer(stage, 'pointerDown', 50, 60); pointer(stage, 'pointerUp', 70, 80);
    expect(last.strokes[0].points[0]).toEqual({ x: 50, y: 60, pressure: .5 });
    expect(last).toMatchObject({ width: 1200, height: 900 });
  });
  it('bounds view zoom and allows zoom in a read-only notebook without editing it', () => {
    const initial = { ...createNoteCanvas(), items: [image] }, stage = mount(initial, false, true);
    const enlarge = host.querySelector('[aria-label="Ampliar caderno"]')!, shrink = host.querySelector('[aria-label="Reduzir caderno"]')!;
    for (let index = 0; index < 12; index++) act(() => Simulate.click(enlarge));
    expect(stage.style.width).toBe('300%');
    expect((enlarge as HTMLButtonElement).disabled).toBe(true);
    for (let index = 0; index < 12; index++) act(() => Simulate.click(shrink));
    expect(stage.style.width).toBe('100%');
    expect((shrink as HTMLButtonElement).disabled).toBe(true);
    expect(last).toBe(initial);
    expect(host.querySelector('[aria-label="Caneta"]')).toBeNull();
  });
});

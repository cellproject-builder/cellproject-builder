import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node, NodeProps } from '@xyflow/react';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { useVisualViewStore } from '@/visuals/rendering/viewStore';
import { BoardItemNode, type BoardNodeData } from './BoardItemNode';
import type { BoardItem } from './model';
import { hasActiveDataIngestions } from '@/cloud/activity';

const mocks = vi.hoisted(() => ({ resize: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  Position: { Left: 'left', Right: 'right', Bottom: 'bottom' },
  Handle: ({ type }: { type: string }) => <span data-handle={type} />,
  NodeResizer: (props: unknown) => { mocks.resize(props); return null; },
  NodeToolbar: ({ isVisible, children }: { isVisible: boolean; children: React.ReactNode }) => isVisible ? children : null,
}));

let host: HTMLDivElement, root: Root;
const update = vi.fn(), remove = vi.fn(), refine = vi.fn();
const base = { id: 'item', x: 10, y: 20, width: 300, height: 200 };
const card: BoardItem = { ...base, kind: 'card', text: '**Ideia** e _teste_\n\n# Título\n- Peça\n\n```js\nconst a = 1;\n```\n<img src=x onerror=alert(1)>', color: '#a78bfa', fontSize: 18 };
async function render(item = card, selected = true, webglAvailable = true) {
  const props: NodeProps<Node<BoardNodeData>> = { id: `visual:${item.id}`, type: 'boardItem', data: { item, english: false, onUpdate: update, onRemove: remove, onRefine: refine, webglAvailable }, selected, dragging: false, draggable: true, selectable: true, deletable: true, isConnectable: true, zIndex: 0, positionAbsoluteX: item.x, positionAbsoluteY: item.y, width: item.width, height: item.height };
  await act(async () => root.render(<BoardItemNode {...props} />));
}
async function click(label: string) { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); useVisualViewStore.setState({ angles: {}, pitches: {}, zooms: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('independent board items', () => {
  it('holds remote refresh during resize and releases after completion, cancellation, or unmount', async () => {
    await render();expect(hasActiveDataIngestions()).toBe(false);
    const start=async()=>act(async()=>mocks.resize.mock.calls.at(-1)![0].onResizeStart());
    await start();expect(hasActiveDataIngestions()).toBe(true);
    await act(async()=>mocks.resize.mock.calls.at(-1)![0].onResizeEnd(null,{x:10,y:20,width:400,height:240}));
    expect(hasActiveDataIngestions()).toBe(false);
    await start();await act(async()=>window.dispatchEvent(new Event('pointercancel')));expect(hasActiveDataIngestions()).toBe(false);
    await start();await act(async()=>window.dispatchEvent(new Event('blur')));expect(hasActiveDataIngestions()).toBe(false);
    await start();await act(async()=>window.dispatchEvent(new Event('mouseup')));expect(hasActiveDataIngestions()).toBe(false);
    await start();await act(async()=>root.unmount());expect(hasActiveDataIngestions()).toBe(false);
  });
  it('renders formatted text safely, including lists and code, without executing markup', async () => {
    await render();
    expect(host.querySelector('strong')?.textContent).toBe('Ideia');
    expect(host.querySelector('em')?.textContent).toBe('teste');
    expect(host.querySelector('h1')?.textContent).toBe('Título');
    expect(host.querySelector('li')?.textContent).toBe('Peça');
    expect(host.querySelector('pre code')?.textContent).toBe('const a = 1;');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.querySelectorAll('[data-handle]')).toHaveLength(2);
  });

  it('formats a local card draft and commits only once on Ctrl+Enter', async () => {
    await render({ ...card, text: 'Minha ideia' }); await click('Editar texto');
    const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(document.activeElement).toBe(editor);
    editor.setSelectionRange(0, 5); await click('Negrito');
    expect(editor.value).toBe('**Minha** ideia'); expect(update).not.toHaveBeenCalled();
    await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(update).toHaveBeenCalledOnce(); expect(update.mock.calls[0][0]).toMatchObject({ kind: 'card', text: '**Minha** ideia' });
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('discards a draft with Escape and routes refinement and removal through callbacks', async () => {
    await render(); await click('Editar texto');
    await act(async () => host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(update).not.toHaveBeenCalled(); expect(host.querySelector('textarea')).toBeNull();
    await click('Aprimorar com IA'); expect(refine).toHaveBeenCalledWith('item');
    await click('Remover do quadro'); expect(remove).toHaveBeenCalledWith('item');
  });

  it('keeps image resizing proportional and scales drawing points with its rectangle', async () => {
    await render({ ...base, kind: 'image', src: 'data:image/png;base64,a', label: 'Referência' });
    expect(mocks.resize.mock.calls.at(-1)![0].keepAspectRatio).toBe(true);
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('Referência');
    await render({ ...base, kind: 'drawing', points: [{ x: 0, y: 0 }, { x: 300, y: 200 }], color: '#ffffff', widthStroke: 2 });
    const resize = mocks.resize.mock.calls.at(-1)![0];
    await act(async () => resize.onResizeEnd(null, { x: 5, y: 8, width: 150, height: 100 }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ width: 150, height: 100, points: [{ x: 0, y: 0 }, { x: 150, y: 100 }] }));
  });

  it.each([[600, 400], [150, 100]])('scales original drawing points after live dimensions change to %s × %s', async (width, height) => {
    const drawing: BoardItem = { ...base, kind: 'drawing', points: [{ x: 30, y: 20 }, { x: 270, y: 180 }], color: '#ffffff', widthStroke: 2 };
    await render(drawing);
    await act(async () => mocks.resize.mock.calls.at(-1)![0].onResizeStart());
    // ReactFlow updates the rendered dimensions while a resize gesture is active.
    await render({ ...drawing, width, height });
    expect(host.querySelector('svg.board-item-drawing')?.getAttribute('viewBox')).toBe('0 0 300 200');
    await act(async () => mocks.resize.mock.calls.at(-1)![0].onResizeEnd(null, { x: 10, y: 20, width, height }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ width, height, points: [{ x: width / 10, y: height / 10 }, { x: width * .9, y: height * .9 }] }));
  });

  it('preserves brush properties and pressure while resizing a stroke', async () => {
    await render({ ...base, kind: 'drawing', points: [{ x: 30, y: 20, pressure:.2 }, { x: 270, y: 180, pressure:.9 }], color: '#facc15', widthStroke: 12, tool:'highlighter', opacity:.4 });
    await act(async () => mocks.resize.mock.calls.at(-1)![0].onResizeEnd(null, { x: 10, y: 20, width:150, height:100 }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({tool:'highlighter',opacity:.4,points:[{x:15,y:10,pressure:.2},{x:135,y:90,pressure:.9}]}));
  });

  it('offers text refinement only for cards and loose text, keeping unsupported model edits hidden', async () => {
    await render(card); expect(host.querySelector('[aria-label="Aprimorar com IA"]')).not.toBeNull();
    await render({ ...card, kind: 'text' }); expect(host.querySelector('[aria-label="Aprimorar com IA"]')).not.toBeNull();
    await render({ ...base, kind: 'diagram', diagram: torqueDiagram(), values: {} });
    expect(host.querySelector('[aria-label="Aprimorar com IA"]')).toBeNull();
    await render({ ...base, kind: 'model', scene: { version: 1, label: 'Motor', objects: [] } });
    expect(host.querySelector('[aria-label="Aprimorar com IA"]')).toBeNull();
  });

  it('zooms an unselected 3D object with Ctrl+wheel without selecting or resizing it', async () => {
    const item: BoardItem = { ...base, kind: 'model', scene: { version: 1, label: 'Motor', objects: [] } };
    await render(item, false); const surface = host.querySelector('.board-item-surface')!;
    const bubble = vi.fn(); host.addEventListener('wheel', bubble);
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true });
    await act(async () => surface.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(bubble).not.toHaveBeenCalled();
    expect(useVisualViewStore.getState().zooms.item).toBeGreaterThan(1);
    expect(update).not.toHaveBeenCalled(); expect(host.querySelector('.is-selected')).toBeNull();
    expect(host.textContent).not.toContain('WebGL');
    await render(item, false, false); expect(host.textContent).toContain('WebGL');
  });

  it('writes interactive SVG parameter changes into the board item', async () => {
    await render({ ...base, kind: 'diagram', diagram: torqueDiagram(), values: {} });
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '.4'); slider.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ kind: 'diagram', values: expect.objectContaining({ mass: .4 }) }));
  });

  it('rotates with Ctrl without leaking graph selection, then restores normal dragging', async () => {
    const item: BoardItem = { ...base, kind: 'model', scene: { version: 1, label: 'Motor', objects: [] } };
    await render(item, false);
    const surface = host.querySelector('.board-item-surface')!;
    const pointer = (type: string, values = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10, ...values }); surface.dispatchEvent(event);
    };
    const graph = vi.fn(); host.addEventListener('mousedown', graph); host.addEventListener('click', graph);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
      pointer('pointerdown', { ctrlKey: true }); surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: true }));
      pointer('pointermove', { ctrlKey: true, clientX: 40, clientY: 30 });
    });
    expect(useVisualViewStore.getState().angles.item).toBeCloseTo(.36); expect(useVisualViewStore.getState().pitches.item).toBeCloseTo(.24);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' })); pointer('pointerup'); surface.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(graph).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    await act(async () => { pointer('pointerdown'); surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(graph).toHaveBeenCalledOnce();
  });

  it('keeps editor focus and draft while using formatting, and commits on leaving the editor', async () => {
    await render({ ...card, text: 'Uma ideia' }); await click('Editar texto');
    const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
    editor.setSelectionRange(4, 9);
    const italic = host.querySelector<HTMLButtonElement>('[aria-label="Itálico"]')!;
    await act(async () => { italic.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); italic.click(); });
    expect(document.activeElement).toBe(editor); expect(update).not.toHaveBeenCalled(); expect(editor.value).toBe('Uma _ideia_');
    await act(async () => editor.blur());
    expect(update).toHaveBeenCalledOnce(); expect(update.mock.calls[0][0].text).toBe('Uma _ideia_');
  });
});

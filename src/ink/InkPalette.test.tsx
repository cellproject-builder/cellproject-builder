import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InkPalette } from './InkPalette';

let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const palette = () => host.querySelector('[data-ink-palette]')!;
const trigger = () => host.querySelector<HTMLButtonElement>('[data-ink-palette-trigger]')!;
const controls = () => host.querySelector('[data-ink-palette-controls]');
function mount(outer = vi.fn()) { act(() => root.render(<div onPointerDown={outer}><InkPalette label="Ferramentas do quadro" onUndo={() => {}} canUndo onExit={() => {}} exitLabel="Sair do desenho"><button>Borracha</button></InkPalette></div>)); return outer; }

it('starts compact and keeps undo and exit accessible while tool choices are collapsed', () => {
  mount(); expect(controls()).toBeNull(); expect(trigger().getAttribute('aria-expanded')).toBe('false');
  const undo = host.querySelector<HTMLButtonElement>('[aria-label="Desfazer"]')!;
  const exit = host.querySelector<HTMLButtonElement>('[aria-label="Sair do desenho"]')!;
  expect(undo).not.toBeNull(); expect(exit).not.toBeNull();
  act(() => trigger().click());
  expect(controls()?.textContent).toContain('Borracha');
  expect(controls()?.contains(undo)).toBe(false); expect(controls()?.contains(exit)).toBe(false);
  expect(host.querySelectorAll('[data-ink-palette-controls]')).toHaveLength(1);
  act(() => trigger().click());
  expect(controls()).toBeNull(); expect(document.activeElement).toBe(trigger());
});

it.each(['pen', 'mouse'])('does not reveal choices during %s hover and keeps explicit choices open until dismissed', pointerType => {
  mount(); act(() => Simulate.pointerEnter(palette(), { pointerType } as never)); expect(controls()).toBeNull();
  act(() => Simulate.pointerLeave(palette(), { pointerType } as never)); expect(controls()).toBeNull();
  act(() => trigger().click());
  act(() => Simulate.pointerLeave(palette(), { pointerType } as never)); expect(controls()).not.toBeNull();
});

it('ignores touch hover and prevents a palette tap from starting canvas ink', () => {
  const outer = mount(); act(() => Simulate.pointerEnter(palette(), { pointerType: 'touch' } as never)); expect(controls()).toBeNull();
  act(() => Simulate.pointerDown(trigger(), { pointerId: 1, pointerType: 'touch', button: 0 } as never));
  expect(outer).not.toHaveBeenCalled(); act(() => trigger().click()); expect(controls()).not.toBeNull();
});

it('does not open on focus and Escape collapses explicit choices without leaving drawing mode', () => {
  const leave = vi.fn(), drawingKey = vi.fn(); act(() => root.render(<div onKeyDown={leave}><InkPalette label="Ferramentas do plano" onKeyDown={drawingKey}><button>Desfazer</button></InkPalette></div>));
  act(() => trigger().focus()); expect(controls()).toBeNull();
  act(() => trigger().click()); expect(controls()).not.toBeNull();
  const undo = controls()!.querySelector<HTMLButtonElement>('button')!; act(() => undo.focus());
  act(() => Simulate.keyDown(undo, { key: 'Escape' } as never));
  expect(controls()).toBeNull(); expect(document.activeElement).toBe(trigger()); expect(leave).not.toHaveBeenCalled(); expect(drawingKey).not.toHaveBeenCalled();
  act(() => Simulate.keyDown(trigger(), { key: 'Escape' } as never));
  expect(drawingKey).toHaveBeenCalledOnce(); expect(leave).toHaveBeenCalledOnce();
});

it('closes on an outside pointer without stealing its focus and cleans up after unmount', () => {
  mount(); act(() => trigger().click()); const outside = document.createElement('button'); document.body.append(outside);
  try { act(() => { outside.focus(); outside.dispatchEvent(new Event('pointerdown', { bubbles: true })); }); expect(controls()).toBeNull(); expect(document.activeElement).toBe(outside); }
  finally { outside.remove(); }
});
it('closes before the canvas stops propagation of the next drawing or navigation pointer', () => {
  const canvas = document.createElement('div'); document.body.append(canvas);
  canvas.addEventListener('pointerdown', event => event.stopPropagation());
  try { mount(); act(() => trigger().click()); expect(controls()).not.toBeNull(); act(() => canvas.dispatchEvent(new Event('pointerdown', { bubbles: true }))); expect(controls()).toBeNull(); }
  finally { canvas.remove(); }
});

it('follows the canvas orientation after resize while preserving the open tools', () => {
  let width = 1100, height = 700;
  let resize: () => void = () => {};
  const disconnect = vi.fn();
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  try {
    act(() => root.render(<div><InkPalette variant="strip" label="Ferramentas"><button>Caneta</button></InkPalette></div>));
    act(() => trigger().click());
    expect(palette().getAttribute('data-dock')).toBe('left');
    width = 700; height = 1100;
    act(() => resize());
    expect(palette().getAttribute('data-dock')).toBe('top');
    expect(controls()?.textContent).toContain('Caneta');
    act(() => root.render(<InkPalette label="Ferramentas"><button>Caneta</button></InkPalette>));
    expect(disconnect).toHaveBeenCalled();
  } finally { bounds.mockRestore(); vi.unstubAllGlobals(); }
});

it('uses the top edge on a shallow landscape canvas so persistent history does not consume the choices', () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 260));
  try {
    act(() => root.render(<InkPalette label="Ferramentas" onUndo={() => {}} canUndo onExit={() => {}}><button>Borracha</button></InkPalette>));
    expect(palette().getAttribute('data-dock')).toBe('top');
  } finally { bounds.mockRestore(); }
});

it('keeps history actions independent of the choices and only offers redo when available', () => {
  const undo = vi.fn(), redo = vi.fn(), exit = vi.fn();
  const mountHistory = (canUndo: boolean, canRedo: boolean, disabled = false) => act(() => root.render(<InkPalette label="Ferramentas" english onUndo={undo} canUndo={canUndo} onRedo={redo} canRedo={canRedo} onExit={exit} disabled={disabled}><button>Pen</button></InkPalette>));
  mountHistory(false, false);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(true);
  expect(host.querySelector('[aria-label="Redo"]')).toBeNull();
  mountHistory(true, true);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Exit drawing"]')!.click());
  expect(undo).toHaveBeenCalledOnce(); expect(redo).toHaveBeenCalledOnce(); expect(exit).toHaveBeenCalledOnce();
  expect(controls()).toBeNull();
  mountHistory(true, true, true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(true);
  expect(trigger().disabled).toBe(true);
});

it('waits for a touch click instead of hiding the strip trigger during pointer focus', () => {
  act(() => root.render(<InkPalette variant="strip" label="Ferramentas"><button>Caneta</button></InkPalette>));
  act(() => { Simulate.pointerDown(trigger(), { pointerType: 'touch' } as never); trigger().focus(); });
  expect(controls()).toBeNull();
  act(() => { Simulate.pointerUp(trigger()); trigger().click(); });
  expect(controls()).not.toBeNull();
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(trigger().tabIndex).toBe(0);
});

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
function mount(outer = vi.fn()) { act(() => root.render(<div onPointerDown={outer}><InkPalette label="Ferramentas do quadro"><button>Desfazer</button><button>Sair do desenho</button></InkPalette></div>)); return outer; }

it('starts compact, expands on touch click and keeps exit and undo in the same palette', () => {
  mount(); expect(controls()).toBeNull(); expect(trigger().getAttribute('aria-expanded')).toBe('false');
  act(() => trigger().click());
  expect(controls()?.textContent).toContain('Desfazer'); expect(controls()?.textContent).toContain('Sair do desenho');
  expect(host.querySelectorAll('[data-ink-palette-controls]')).toHaveLength(1);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Recolher ferramentas de desenho"]')!.click());
  expect(controls()).toBeNull(); expect(document.activeElement).toBe(trigger());
});

it.each(['pen', 'mouse'])('expands transiently on %s hover and keeps a clicked palette pinned after leaving', pointerType => {
  mount(); act(() => Simulate.pointerEnter(palette(), { pointerType } as never)); expect(controls()).not.toBeNull();
  act(() => Simulate.pointerLeave(palette(), { pointerType } as never)); expect(controls()).toBeNull();
  act(() => Simulate.pointerEnter(palette(), { pointerType } as never)); act(() => trigger().click());
  act(() => Simulate.pointerLeave(palette(), { pointerType } as never)); expect(controls()).not.toBeNull();
});

it('ignores touch hover and prevents a palette tap from starting canvas ink', () => {
  const outer = mount(); act(() => Simulate.pointerEnter(palette(), { pointerType: 'touch' } as never)); expect(controls()).toBeNull();
  act(() => Simulate.pointerDown(trigger(), { pointerId: 1, pointerType: 'touch', button: 0 } as never));
  expect(outer).not.toHaveBeenCalled(); act(() => trigger().click()); expect(controls()).not.toBeNull();
});

it('opens through keyboard focus and Escape collapses without bubbling to leave drawing mode', () => {
  const leave = vi.fn(); act(() => root.render(<div onKeyDown={leave}><InkPalette label="Ferramentas do plano"><button>Desfazer</button></InkPalette></div>));
  act(() => trigger().focus()); expect(controls()).not.toBeNull();
  const undo = controls()!.querySelector<HTMLButtonElement>('button')!; act(() => undo.focus());
  act(() => Simulate.keyDown(undo, { key: 'Escape' } as never));
  expect(controls()).toBeNull(); expect(document.activeElement).toBe(trigger()); expect(leave).not.toHaveBeenCalled();
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

it('lets the first control pin a hover-opened strip before it becomes the collapse action', () => {
  act(() => root.render(<InkPalette variant="strip" label="Ferramentas"><button>Caneta</button></InkPalette>));
  act(() => Simulate.pointerEnter(palette(), { pointerType: 'mouse', clientX: 100, clientY: 200 } as never));
  const first = controls()!.querySelector('button')!;
  expect(first.getAttribute('aria-label')).toBe('Manter ferramentas abertas');
  act(() => first.click());
  act(() => Simulate.pointerLeave(palette()));
  expect(controls()).not.toBeNull();
  expect(first.getAttribute('aria-label')).toBe('Recolher ferramentas de desenho');
  act(() => first.click());
  expect(controls()).toBeNull();
});

it('waits for a touch click instead of hiding the strip trigger during pointer focus', () => {
  act(() => root.render(<InkPalette variant="strip" label="Ferramentas"><button>Caneta</button></InkPalette>));
  act(() => { Simulate.pointerDown(trigger(), { pointerType: 'touch' } as never); trigger().focus(); });
  expect(controls()).toBeNull();
  act(() => { Simulate.pointerUp(trigger()); trigger().click(); });
  expect(controls()).not.toBeNull();
  expect(controls()?.querySelector('button')?.getAttribute('aria-label')).toBe('Recolher ferramentas de desenho');
});

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InkToolbar } from './InkToolbar';
import { InkStroke } from './InkStroke';
import { InkPaletteOverlayContext, type InkPaletteDock } from './InkPaletteOverlay';
import { createInkSettings, type InkSettings } from './model';

let host: HTMLDivElement, root: Root, latest: InkSettings;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

function OverlayHarness({ dock = 'left' }: { dock?: InkPaletteDock }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null), [value, onChange] = useState(createInkSettings());
  latest = value;
  return <InkPaletteOverlayContext.Provider value={{ target, dock }}><div onPointerDown={event => event.stopPropagation()}>
    <div data-scrolling-rail><InkToolbar value={value} onChange={onChange} /></div>
    <div ref={setTarget} data-palette-overlay />
  </div></InkPaletteOverlayContext.Provider>;
}

it('offers five accessible brushes and controlled color, width and opacity', () => {
  function Harness() { const [value, onChange] = useState(createInkSettings()); latest = value; return <InkToolbar value={value} onChange={onChange} />; }
  act(() => root.render(<Harness />));
  expect(host.querySelectorAll('button[aria-pressed]')).toHaveLength(5);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Bico de pena"]')!.click());
  expect(latest.tool).toBe('fountain');
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Marca-texto"]')!.click());
  expect(latest.tool).toBe('highlighter');
  expect(latest.opacity).toBeLessThan(1);
  expect(host.querySelector('[aria-label="Marca-texto"]')?.getAttribute('aria-pressed')).toBe('true');
  act(() => Simulate.change(host.querySelector('[aria-label="Cor do traço"]')!, { target: { value: '#123456' } } as never));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Ajustar traço"]')!.click());
  act(() => Simulate.change(host.querySelector('[aria-label="Espessura do traço"]')!, { target: { value: '12' } } as never));
  act(() => Simulate.change(host.querySelector('[aria-label="Opacidade do traço"]')!, { target: { value: '45' } } as never));
  expect(latest).toMatchObject({ color: '#123456', width: 12, opacity: .45 });
  expect(host.querySelector('[aria-label="Borracha"]')).toBeNull();
});

it('keeps brush settings out of the drawing area until requested and dismisses them with Escape', () => {
  act(() => root.render(<InkToolbar value={createInkSettings()} onChange={() => {}} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Ajustar traço"]')!;
  expect(trigger).not.toBeNull();
  expect(host.querySelector('[aria-label="Espessura do traço"]')).toBeNull();
  act(() => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('[aria-label="Espessura do traço"]')).not.toBeNull();
  act(() => Simulate.keyDown(host.querySelector('[role="dialog"]')!, { key: 'Escape' } as never));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('portals settings outside the scrolling rail and keeps slider interactions inside the popover boundary', () => {
  act(() => root.render(<OverlayHarness />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Ajustar traço"]')!;
  act(() => trigger.click());
  const dialog = host.querySelector<HTMLDivElement>('[role="dialog"]')!;
  expect(host.querySelector('[data-scrolling-rail]')!.contains(dialog)).toBe(false);
  expect(host.querySelector('[data-palette-overlay]')!.contains(dialog)).toBe(true);
  const width = dialog.querySelector<HTMLInputElement>('[aria-label="Espessura do traço"]')!;
  expect(document.activeElement).toBe(width);
  act(() => width.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  act(() => Simulate.change(width, { target: { value: '10' } } as never));
  expect(latest.width).toBe(10);
  expect(host.querySelector('[role="dialog"]')).toBe(dialog);
  act(() => { width.focus(); Simulate.keyDown(width, { key: 'Escape' } as never); });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  act(() => trigger.click());
  act(() => host.querySelector('[data-palette-overlay]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it.each(['left', 'right', 'top', 'bottom'] as const)('opens %s-docked settings inward and contains them in the canvas', dock => {
  act(() => root.render(<OverlayHarness dock={dock} />));
  const overlay = host.querySelector<HTMLDivElement>('[data-palette-overlay]')!, trigger = host.querySelector<HTMLButtonElement>('[aria-label="Ajustar traço"]')!;
  const canvas = new DOMRect(20, 30, 600, 400);
  const anchor = new DOMRect(dock === 'right' ? 568 : dock === 'left' ? 28 : 240, dock === 'bottom' ? 378 : dock === 'top' ? 38 : 110, 44, 44);
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(canvas);
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(anchor);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'dialog' ? new DOMRect(0, 0, 254, 198) : new DOMRect(); });
  act(() => trigger.click());
  const dialog = overlay.querySelector<HTMLDivElement>('[role="dialog"]')!;
  const left = Number.parseFloat(dialog.style.left) + canvas.left, top = Number.parseFloat(dialog.style.top) + canvas.top;
  const width = Number.parseFloat(dialog.style.width), height = Math.min(198, Number.parseFloat(dialog.style.maxHeight));
  expect(left).toBeGreaterThanOrEqual(canvas.left);
  expect(left + width).toBeLessThanOrEqual(canvas.right);
  expect(top).toBeGreaterThanOrEqual(canvas.top);
  expect(top + height).toBeLessThanOrEqual(canvas.bottom);
  if (dock === 'left') expect(left).toBeGreaterThanOrEqual(anchor.right);
  if (dock === 'right') expect(left + width).toBeLessThanOrEqual(anchor.left);
  if (dock === 'top') expect(top).toBeGreaterThanOrEqual(anchor.bottom);
  if (dock === 'bottom') expect(top + height).toBeLessThanOrEqual(anchor.top);
});

it('limits portal dimensions on a tiny canvas and updates its anchor after scrolling and resize', () => {
  act(() => root.render(<OverlayHarness dock="top" />));
  const overlay = host.querySelector<HTMLDivElement>('[data-palette-overlay]')!, trigger = host.querySelector<HTMLButtonElement>('[aria-label="Ajustar traço"]')!;
  let canvas = new DOMRect(0, 0, 180, 160), anchor = new DOMRect(20, 8, 44, 44);
  vi.spyOn(overlay, 'getBoundingClientRect').mockImplementation(() => canvas);
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => anchor);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'dialog' ? new DOMRect(0, 0, 254, 198) : new DOMRect(); });
  act(() => trigger.click());
  const dialog = overlay.querySelector<HTMLDivElement>('[role="dialog"]')!;
  expect(Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(164);
  expect(Number.parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(144);
  canvas = new DOMRect(0, 0, 500, 400); anchor = new DOMRect(250, 8, 44, 44);
  act(() => window.dispatchEvent(new Event('resize')));
  const afterResize = dialog.style.left;
  expect(Number.parseFloat(dialog.style.width)).toBe(254);
  anchor = new DOMRect(100, 8, 44, 44);
  act(() => host.querySelector('[data-scrolling-rail]')!.dispatchEvent(new Event('scroll')));
  expect(dialog.style.left).not.toBe(afterResize);
});

it('adds repeatable graphite grain to pencil ink while retaining one selectable path', () => {
  act(() => root.render(<svg><InkStroke stroke={{ ...createInkSettings('pencil'), points: [{ x: 10, y: 20 }, { x: 30, y: 30 }] }} /></svg>));
  const path = host.querySelector('path')!;
  expect(host.querySelectorAll('path')).toHaveLength(1);
  expect(path.getAttribute('filter')).toMatch(/^url\(#.+\)$/);
  expect(host.querySelector('feTurbulence')?.getAttribute('seed')).toBe('17');
  expect(host.querySelector('feComposite')?.getAttribute('in')).toBe('SourceGraphic');
});

it('uses English labels and disables every interactive brush control', () => {
  act(() => root.render(<InkToolbar value={createInkSettings()} onChange={() => {}} english disabled />));
  expect(host.querySelector('[aria-label="Highlighter"]')).not.toBeNull();
  expect([...host.querySelectorAll<HTMLInputElement>('button,input')].every(control => control.disabled)).toBe(true);
});

it('renders a selectable single vector path with native consumer attributes', () => {
  const select = vi.fn();
  act(() => root.render(<svg><InkStroke stroke={{ ...createInkSettings(), points: [{ x: 10, y: 20 }] }} legacyMode="note" selected onPointerDown={select} data-note-stroke="note-ink" data-board-stroke="board-ink" /></svg>));
  const path = host.querySelector('path')!;
  expect(host.querySelectorAll('path')).toHaveLength(1);
  expect(path.dataset.noteStroke).toBe('note-ink');
  expect(path.dataset.boardStroke).toBe('board-ink');
  expect(path.classList.contains('is-selected')).toBe(true);
  act(() => Simulate.pointerDown(path, { pointerId: 1 } as never));
  expect(select).toHaveBeenCalledOnce();
});

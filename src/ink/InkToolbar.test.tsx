import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InkToolbar } from './InkToolbar';
import { InkStroke } from './InkStroke';
import { createInkSettings, type InkSettings } from './model';

let host: HTMLDivElement, root: Root, latest: InkSettings;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

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

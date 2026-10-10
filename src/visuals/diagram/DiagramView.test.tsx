import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { DiagramView } from './DiagramView';
import { torqueDiagram } from './fixture';
import { useThemeStore } from '@/theme';
import type { DiagramV1 } from './model';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('updates bindings, supports keyboard node navigation and keeps controls from starting canvas gestures', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const changed = vi.fn(), selected = vi.fn(), gesture = vi.fn();
  try {
    await act(async () => root.render(<div onPointerDown={gesture}><DiagramView diagram={torqueDiagram('9_A', '-B')} values={{ reach: .2 }} nodeNames={{ '9_A': 'Servo', '-B': 'Ensaio' }} onParameter={changed} onSelectNode={selected} english /></div>));
    expect(host.querySelector('[data-element-id="arm"]')?.getAttribute('x2')).toBe('270');
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="Carga"]')!;
    act(() => Simulate.pointerDown(slider)); expect(gesture).not.toHaveBeenCalled();
    act(() => { slider.value = '.4'; Simulate.change(slider); }); expect(changed).toHaveBeenCalledWith('mass', .4);
    const servo = host.querySelector('[aria-label="Open node: Servo"]')!;
    act(() => Simulate.keyDown(servo, { key: 'Enter' })); expect(selected).toHaveBeenCalledWith('9_A');
    expect(host.querySelector('svg')?.style.overflow).toBe('hidden');
    expect(host.textContent).toContain('Assumptions'); expect(host.querySelector('script,foreignObject,iframe,image')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.replace('#', '').match(/../g)!.slice(0, 3).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

const labels = (): DiagramV1 => ({ ...torqueDiagram(), parameters: [], constants: {}, calculations: [], bindings: [], elements: [
  { id: 'heading', type: 'text', x: 10, y: 20, fill: '#16324f', text: 'Identificação antes do vínculo' },
  { id: 'default', type: 'text', x: 10, y: 40, text: 'Informação ainda desconhecida' },
  { id: 'semantic', type: 'text', x: 10, y: 60, fill: '#ffb454', text: 'Falta identificar o ambiente' },
  { id: 'card', type: 'rect', x: 10, y: 80, width: 250, height: 50, fill: '#ffffff' },
  { id: 'card-label', type: 'text', x: 20, y: 105, fill: '#16324f', text: 'Texto sobre cartão branco' },
] });

it('makes legacy dark labels readable on OLED without changing semantic colors, local cards or the saved diagram', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const diagram = labels(), saved = JSON.stringify(diagram), previousTheme = useThemeStore.getState().theme;
  try {
    act(() => useThemeStore.getState().setTheme('oled'));
    await act(async () => root.render(<DiagramView diagram={diagram} />));
    const fill = (id: string) => host.querySelector(`[data-element-id="${id}"]`)!.getAttribute('fill')!;
    expect(contrast(fill('heading'), '#000000')).toBeGreaterThanOrEqual(7);
    expect(contrast(fill('default') === 'currentColor' ? '#f5f5f7' : fill('default'), '#000000')).toBeGreaterThanOrEqual(4.5);
    expect(fill('semantic')).toBe('#ffb454');
    expect(fill('card-label')).toBe('#16324f');
    expect(fill('card')).toBe('#ffffff');
    expect(JSON.stringify(diagram)).toBe(saved);
  } finally { act(() => { root.unmount(); useThemeStore.getState().setTheme(previousTheme); }); host.remove(); }
});

it('uses the surrounding surface and filled circles, including inherited and transparent text colors', async () => {
  const host = document.createElement('div'); host.style.backgroundColor = '#ffffff'; host.style.color = '#f5f5f7'; document.body.append(host);
  const root = createRoot(host), previousTheme = useThemeStore.getState().theme;
  const diagram = labels(); diagram.elements = [
    { id: 'on-surface', type: 'text', x: 10, y: 20, fill: '#16324f', text: 'Superfície branca no tema escuro' },
    { id: 'circle', type: 'circle', cx: 100, cy: 100, r: 50, fill: '#111111' },
    { id: 'on-circle', type: 'text', x: 70, y: 100, fill: '#fff2ffff', text: 'Círculo escuro' },
    { id: 'transparent-label', type: 'text', x: 10, y: 180, fill: '#00000011', text: 'Texto translúcido' },
    { id: 'inherited-label', type: 'text', x: 10, y: 210, fill: 'currentColor', text: 'Cor herdada' },
    { id: 'transparent-hidden', type: 'text', x: 10, y: 215, fill: '#16324f00', text: 'Oculto por transparência' },
  ];
  try {
    act(() => useThemeStore.getState().setTheme('oled'));
    await act(async () => root.render(<DiagramView diagram={diagram} />));
    const fill = (id: string) => host.querySelector(`[data-element-id="${id}"]`)!.getAttribute('fill')!;
    expect(fill('on-surface')).toBe('#16324f');
    expect(fill('on-circle')).toBe('#fff2ffff');
    expect(contrast(fill('transparent-label'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fill('inherited-label'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(fill('transparent-hidden')).toBe('#16324f00');
  } finally { act(() => { root.unmount(); useThemeStore.getState().setTheme(previousTheme); }); host.remove(); }
});

it('recalculates label contrast when switching themes, including text on dark and translucent shapes', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const previousTheme = useThemeStore.getState().theme;
  const diagram = labels(); diagram.elements.push(
    { id: 'dark-card', type: 'rect', x: 280, y: 80, width: 170, height: 50, fill: '#182030' },
    { id: 'light-label', type: 'text', x: 290, y: 105, fill: '#ffffff', text: 'Cartão escuro' },
    { id: 'glass-card', type: 'rect', x: 10, y: 140, width: 250, height: 50, fill: '#ffffff22' },
    { id: 'glass-label', type: 'text', x: 20, y: 165, fill: '#16324f', text: 'Cartão translúcido' },
    { id: 'invisible', type: 'text', x: 10, y: 210, fill: 'none', text: 'Oculto intencionalmente' },
  );
  try {
    act(() => useThemeStore.getState().setTheme('oled'));
    await act(async () => root.render(<DiagramView diagram={diagram} />));
    const fill = (id: string) => host.querySelector(`[data-element-id="${id}"]`)!.getAttribute('fill')!;
    expect(contrast(fill('glass-label'), '#222222')).toBeGreaterThanOrEqual(4.5);
    act(() => useThemeStore.getState().setTheme('light'));
    expect(fill('heading')).toBe('#16324f');
    expect(contrast(fill('semantic'), '#f5f5f7')).toBeGreaterThanOrEqual(4.5);
    expect(fill('light-label')).toBe('#ffffff');
    expect(fill('invisible')).toBe('none');
    act(() => useThemeStore.getState().setTheme('dark'));
    expect(contrast(fill('heading'), '#1c1c1e')).toBeGreaterThanOrEqual(4.5);
    expect(fill('light-label')).toBe('#ffffff');
  } finally { act(() => { root.unmount(); useThemeStore.getState().setTheme(previousTheme); }); host.remove(); }
});

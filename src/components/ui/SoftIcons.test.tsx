import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Icon } from '@/workspace/ui';
import { ProjectIcon } from '@/workspace/project-appearance/projectIcons';
import { FolderIcon } from './SoftIcons';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('uses the same rounded line family for workspace folders, notes and boards', () => {
  act(() => root.render(<><Icon name="folder" size={20} /><Icon name="notes" /><Icon name="kanban" /></>));
  const icons = Array.from(host.querySelectorAll('svg'));
  expect(icons).toHaveLength(3);
  for (const icon of icons) {
    expect(icon.classList.contains('lucide')).toBe(true);
    expect(icon.getAttribute('stroke-width')).toBe('1.7');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  }
  expect(icons[0].getAttribute('width')).toBe('20');
});

it('updates a legacy project glyph without changing its stored ID or color', () => {
  const appearance = { icon: 'GearIcon', color: '#a78bfa' };
  act(() => root.render(<ProjectIcon appearance={appearance} size={22} decorated />));
  const glyph = host.querySelector<HTMLElement>('[data-project-icon="GearIcon"]')!;
  expect(glyph.style.color).toBe('rgb(167, 139, 250)');
  expect(glyph.querySelector('svg')?.classList.contains('lucide')).toBe(true);
  expect(glyph.querySelector('svg')?.getAttribute('width')).toBe('22');
  expect(appearance).toEqual({ icon: 'GearIcon', color: '#a78bfa' });
});

it('forwards SVG refs, sizing and accessible names instead of hiding labelled icons', () => {
  const ref = createRef<SVGSVGElement>();
  act(() => root.render(<FolderIcon ref={ref} width={24} height={20} className="custom-glyph" aria-label="Projetos" role="img" title="Abrir projetos" color="#a78bfa" strokeWidth={2} />));
  expect(ref.current).toBe(host.querySelector('svg'));
  expect(ref.current?.getAttribute('width')).toBe('24');
  expect(ref.current?.getAttribute('height')).toBe('20');
  expect(ref.current?.getAttribute('stroke-width')).toBe('2');
  expect(ref.current?.classList.contains('custom-glyph')).toBe(true);
  expect(ref.current?.getAttribute('aria-label')).toBe('Projetos');
  expect(ref.current?.getAttribute('aria-hidden')).toBeNull();
  expect(ref.current?.querySelector('title')?.textContent).toBe('Abrir projetos');
});

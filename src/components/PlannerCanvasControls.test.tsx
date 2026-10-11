import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { en, ptBR, type Messages } from '@/i18n/messages';
import type { Lens } from '@/store';
import type { GraphLayoutMode, Orientation } from '@/graph/autoLayout';
import { PlannerCanvasControls } from './PlannerCanvasControls';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Harness({ maximized = false, orientation = 'horizontal', mobile = false, tr = en, restore = true }: {
  maximized?: boolean; orientation?: Orientation; mobile?: boolean; tr?: Messages; restore?: boolean;
}) {
  const [lens, setLens] = useState<Lens>('structure');
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>('auto');
  const [actions, setActions] = useState({ tidy: 0, zoomIn: 0, zoomOut: 0, fit: 0, restore: 0 });
  const record = (action: keyof typeof actions) => setActions((current) => ({ ...current, [action]: current[action] + 1 }));
  return <>
    <PlannerCanvasControls tr={tr} lens={lens} onLensChange={setLens} layoutMode={layoutMode} onLayoutChange={setLayoutMode}
      orientation={orientation} onTidy={() => record('tidy')} maximized={maximized} isMobile={mobile} canvasWidth={mobile ? 320 : 1200}
      onToggleMaximized={restore ? () => record('restore') : undefined}
      zoomButtons={[
        { label: tr.graph.zoomIn, glyph: '+', onClick: () => record('zoomIn') },
        { label: tr.graph.zoomOut, glyph: '−', onClick: () => record('zoomOut') },
        { label: tr.graph.fitAll, glyph: '⌖', onClick: () => record('fit') },
      ]}
      legend={<details><summary>{tr.graph.legend}</summary><p>Edge meanings</p></details>} />
    <output aria-label="Current lens">{lens}</output>
    <output aria-label="Current layout">{layoutMode}</output>
    <output aria-label="Actions">{JSON.stringify(actions)}</output>
  </>;
}
const render = (props: Parameters<typeof Harness>[0] = {}) => act(() => root.render(<Harness {...props} />));
const button = (name: string) => {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name);
  expect(found, `Button: ${name}`).toBeDefined();
  return found!;
};
const output = (name: string) => host.querySelector<HTMLOutputElement>(`output[aria-label="${name}"]`)!.textContent;

describe('planner canvas controls', () => {
  it.each([false, true])('keeps all five lenses selectable when maximized is %s and limits orientation to Structure', (maximized) => {
    render({ maximized, mobile: !maximized });
    const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${en.topBar.lensSelectAria}"]`)!;
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['structure', 'flow', 'risk', 'state', 'connections']);
    for (const lens of ['flow', 'risk', 'state', 'connections', 'structure']) {
      act(() => Simulate.change(select, { target: { value: lens } } as never));
      expect(output('Current lens')).toBe(lens);
      expect(host.querySelector(`[role="group"][aria-label="${en.graph.layoutMode}"]`) !== null).toBe(lens === 'structure');
    }
  });

  it('uses the existing desktop lens control and keeps the canvas toolbar focused on layout actions', () => {
    render();
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector(`[role="group"][aria-label="${en.graph.zoomGroup}"]`)).not.toBeNull();
    act(() => button(en.graph.layoutVertical).click());
    expect(output('Current layout')).toBe('vertical');
  });

  it('applies each orientation button immediately and reports the controlled selection', () => {
    render({ maximized: true });
    const group = host.querySelector(`[role="group"][aria-label="${en.graph.layoutMode}"]`)!;
    expect(group).not.toBeNull();
    expect(group.querySelectorAll('button')).toHaveLength(4);
    for (const [label, mode] of [[en.graph.layoutHorizontal, 'horizontal'], [en.graph.layoutVertical, 'vertical'], [en.graph.layoutManual, 'manual'], [en.graph.layoutAuto, 'auto']]) {
      act(() => button(label).click());
      expect(output('Current layout')).toBe(mode);
      expect(output('Current lens')).toBe('structure');
      expect(button(label).getAttribute('aria-pressed')).toBe('true');
      expect(Array.from(group.querySelectorAll('button')).filter((element) => element.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    }
  });

  it('shows the resolved automatic orientation without changing the selected layout mode', () => {
    render({ maximized: true });
    expect(button(en.graph.layoutAuto).title).toContain(en.graph.layoutHorizontal);
    render({ maximized: true, orientation: 'vertical' });
    expect(button(en.graph.layoutAuto).title).toContain(en.graph.layoutVertical);
    expect(output('Current layout')).toBe('auto');
  });

  it('keeps tidy, all zoom actions and restore usable in the narrow maximized controls', () => {
    render({ mobile: true });
    expect(host.querySelector(`[role="group"][aria-label="${en.graph.zoomGroup}"]`)).toBeNull();
    render({ maximized: true, mobile: true });
    for (const label of [en.graph.tidy, en.graph.zoomIn, en.graph.zoomOut, en.graph.fitAll, en.graph.restoreCanvas]) act(() => button(label).click());
    expect(JSON.parse(output('Actions')!)).toEqual({ tidy: 1, zoomIn: 1, zoomOut: 1, fit: 1, restore: 1 });
    expect(host.querySelector('details')!.open).toBe(false);
    act(() => host.querySelector('summary')!.click());
    expect(host.querySelector('details')!.open).toBe(true);
  });

  it('uses the supplied translations and omits the optional maximize action', () => {
    render({ tr: ptBR, restore: false, mobile: true });
    expect(host.querySelector(`select[aria-label="${ptBR.topBar.lensSelectAria}"]`)).not.toBeNull();
    expect(button(ptBR.graph.layoutManual).textContent).toContain(ptBR.graph.layoutManual);
    act(() => button(ptBR.graph.tidy).click());
    expect(JSON.parse(output('Actions')!).tidy).toBe(1);
    expect(host.querySelector(`[aria-label="${ptBR.graph.maximizeCanvas}"]`)).toBeNull();
  });
});

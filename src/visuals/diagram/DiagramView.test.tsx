import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { DiagramView } from './DiagramView';
import { torqueDiagram } from './fixture';
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

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasSize } from './useCanvasSize';

let width = 1000, height = 700;
let notify: () => void;
let host: HTMLDivElement, root: Root;
const disconnect = vi.fn();
const observe = vi.fn();
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const size = useCanvasSize(ref);
  return <div ref={ref} data-canvas="true"><output>{JSON.stringify(size)}</output></div>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  width = 1000; height = 700;
  disconnect.mockClear(); observe.mockClear();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.canvas ? width : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.canvas ? height : 0; });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const result = () => JSON.parse(host.querySelector('output')!.textContent!);

it('tracks the canvas rather than the window when columns open or close', () => {
  expect(observe).toHaveBeenCalledWith(host.querySelector('[data-canvas]'));
  expect(result()).toEqual({ width: 1000, height: 700, orientation: 'horizontal' });
  act(() => { width = 540; notify(); });
  expect(result()).toEqual({ width: 540, height: 700, orientation: 'vertical' });
  act(() => { width = 1100; notify(); });
  expect(result().orientation).toBe('horizontal');
  act(() => { height = 1200; notify(); });
  expect(result().orientation).toBe('vertical');
});

it('retains the last valid measurement while hidden and disconnects on unmount', () => {
  act(() => { width = 0; height = 0; notify(); });
  expect(result()).toEqual({ width: 1000, height: 700, orientation: 'horizontal' });
  act(() => root.render(null));
  expect(disconnect).toHaveBeenCalledOnce();
});

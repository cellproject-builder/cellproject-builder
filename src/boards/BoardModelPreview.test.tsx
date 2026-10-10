import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SceneV1 } from '@/visuals/types';
import { BoardModelPreview } from './BoardModelPreview';

const audit = vi.hoisted(() => ({ renderers: [] as Array<{ render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>, items: [] as Array<{ dispose: ReturnType<typeof vi.fn>; setView: ReturnType<typeof vi.fn> }>, frames: new Map<number, FrameRequestCallback>(), next: 0, observers: [] as Array<{ notify(): void; disconnect: ReturnType<typeof vi.fn> }>, hidden: false }));
vi.mock('three', () => ({ WebGLRenderer: class {
  render = vi.fn(); dispose = vi.fn(); setClearColor = vi.fn(); setPixelRatio = vi.fn(); setSize = vi.fn(); getPixelRatio = () => 1;
  constructor() { audit.renderers.push(this); }
} }));
vi.mock('@/visuals/rendering/modelItem', () => ({ modelItem: () => {
  const item = { scene: {}, camera: {}, fitAspect: vi.fn(), setView: vi.fn(), dispose: vi.fn() }; audit.items.push(item); return item;
} }));
let host: HTMLDivElement, root: Root;
const scene: SceneV1 = { version: 1, label: 'Preview', objects: [] };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  audit.renderers.length = 0; audit.items.length = 0; audit.frames.clear(); audit.observers.length = 0; audit.next = 0; audit.hidden = false;
  vi.stubGlobal('WebGL2RenderingContext', class {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { audit.frames.set(++audit.next, callback); return audit.next; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => audit.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); notify: () => void; constructor(callback: () => void) { this.notify = callback; audit.observers.push(this); } observe() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240); vi.spyOn(document, 'hidden', 'get').mockImplementation(() => audit.hidden);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function frame() { const next = audit.frames.entries().next().value; if (!next) throw new Error('Expected a scheduled frame'); audit.frames.delete(next[0]); await act(async () => next[1](performance.now())); }
async function mount() { await act(async () => root.render(<BoardModelPreview scene={scene} />)); }

it('renders once, stays idle and repaints for keyboard, Ctrl wheel and resize', async () => {
  await mount(); await frame(); expect(audit.frames.size).toBe(0); expect(audit.renderers[0].render).toHaveBeenCalledOnce();
  const canvas = host.querySelector('canvas')!;
  await act(async () => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(audit.frames.size).toBe(1); await frame(); expect(audit.items[0].setView.mock.lastCall?.[0]).toBeCloseTo(.12);
  await act(async () => canvas.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true })));
  await frame(); expect(audit.items[0].setView.mock.lastCall?.[2]).toBeGreaterThan(1); expect(audit.frames.size).toBe(0);
  audit.observers[0].notify(); expect(audit.frames.size).toBe(1); await frame();
});

it('pauses while hidden and cleans pending work and GPU resources on unmount', async () => {
  await mount(); audit.hidden = true; document.dispatchEvent(new Event('visibilitychange')); expect(audit.frames.size).toBe(0);
  audit.hidden = false; document.dispatchEvent(new Event('visibilitychange')); expect(audit.frames.size).toBe(1);
  await act(async () => root.unmount()); expect(audit.frames.size).toBe(0);
  expect(audit.items[0].dispose).toHaveBeenCalledOnce(); expect(audit.renderers[0].dispose).toHaveBeenCalledOnce(); expect(audit.observers[0].disconnect).toHaveBeenCalledOnce(); root = createRoot(host);
});

it('recreates its resources after context restoration and continues repainting on demand', async () => {
  await mount(); await frame(); const canvas = host.querySelector('canvas')!;
  await act(async () => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  expect(host.textContent).toContain('WebGL'); expect(audit.frames.size).toBe(0);
  await act(async () => canvas.dispatchEvent(new Event('webglcontextrestored')));
  expect(audit.renderers).toHaveLength(2); expect(audit.renderers[0].dispose).toHaveBeenCalledOnce(); await frame(); expect(audit.frames.size).toBe(0); expect(host.textContent).not.toContain('WebGL');
});

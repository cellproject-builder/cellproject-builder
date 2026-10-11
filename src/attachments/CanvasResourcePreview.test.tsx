import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasResourcePreview } from './CanvasResourcePreview';
import type { CanvasResource } from './canvasModel';

const mocks = vi.hoisted(() => ({ read: vi.fn(), document: vi.fn() }));
vi.mock('@/visuals/media', () => ({ readVisualMedia: mocks.read }));
vi.mock('@/cloud/runtime', () => ({ getCloudRuntime: () => null }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: mocks.document }));
let host: HTMLDivElement, root: Root;
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const image = (id = 'first'): CanvasResource => ({ id, name: `${id}.png`, kind: 'image', mediaId: `media-${id}`, mime: 'image/png', size: 3, text: null, url: null, addedAt: 1 });
const pdf = (): CanvasResource => ({ id: 'manual', name: 'Manual.pdf', kind: 'pdf', mediaId: 'manual-pdf', mime: 'application/pdf', size: 8, text: null, url: null, addedAt: 1 });
const render = async (resource: CanvasResource, expanded = true, visibilityRoot?: { readonly current: HTMLDivElement | null }) => {
  await act(async () => { root.render(<CanvasResourcePreview resource={resource} expanded={expanded} visibilityRoot={visibilityRoot} />); });
};
function observeVisibility() {
  let callback: IntersectionObserverCallback;
  const observe = vi.fn(), disconnect = vi.fn(), options = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(next: IntersectionObserverCallback, init: IntersectionObserverInit) { callback = next; options(init); }
    observe = observe; disconnect = disconnect;
  });
  return { observe, disconnect, options, change: async (isIntersecting: boolean) => {
    await act(async () => { callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver); });
  } };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.read.mockReset(); mocks.document.mockReset();
  vi.stubGlobal('IntersectionObserver', undefined);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalCreateUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateUrl); else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevokeUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeUrl); else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('canvas resource preview lifecycle', () => {
  it('reads no bytes until a canvas card becomes visible', async () => {
    const visibility = observeVisibility();
    mocks.read.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await render(image(), false, { current: host });
    expect(visibility.observe).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled();
    expect(visibility.options).toHaveBeenCalledWith(expect.objectContaining({ root: host }));
    await visibility.change(true);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('media-first');
    expect(host.querySelector('img')?.src).toBe('blob:preview');
    expect(visibility.disconnect).not.toHaveBeenCalled();
  });

  it('releases an offscreen preview after a grace period and reloads when it returns', async () => {
    vi.useFakeTimers();
    const visibility = observeVisibility();
    mocks.read.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await render(image(), false); await visibility.change(true);
    await visibility.change(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(host.querySelector('img')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(host.querySelector('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:preview');
    await visibility.change(true);
    expect(host.querySelector('img')).not.toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('keeps a preview through a short pan out and back without reading its bytes again', async () => {
    vi.useFakeTimers();
    const visibility = observeVisibility();
    mocks.read.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await render(image(), false); await visibility.change(true); await visibility.change(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await visibility.change(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(host.querySelector('img')).not.toBeNull();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('waits to read a PDF cover and tears down a pending document offscreen', async () => {
    const visibility = observeVisibility();
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
    mocks.read.mockResolvedValue(blob);
    const destroy = vi.fn(async () => {});
    mocks.document.mockReturnValue({ promise: new Promise(() => {}), destroy });
    await render(pdf(), false);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.document).not.toHaveBeenCalled();
    await visibility.change(true);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('manual-pdf');
    expect(host.querySelector('.attachment-pdf-page')).not.toBeNull();
    vi.useFakeTimers(); await visibility.change(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(host.querySelector('.attachment-pdf-page')).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('opens the expanded PDF immediately without waiting for canvas visibility', async () => {
    const visibility = observeVisibility();
    mocks.read.mockImplementation(() => new Promise(() => {}));
    await render(pdf());
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(visibility.observe).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('manual-pdf');
    expect(host.querySelector('.attachment-pdf-page')).not.toBeNull();
  });

  it('releases its temporary URL on unmount and ignores a late read from the previous resource', async () => {
    let resolve: (blob: Blob) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise<Blob>(done => { resolve = done; }));
    await render(image());
    mocks.read.mockResolvedValueOnce(new Blob(['new'], { type: 'image/png' }));
    await render(image('second'));
    await act(async () => { resolve(new Blob(['old'], { type: 'image/png' })); });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(host.querySelector('img')?.alt).toBe('second.png');
    act(() => root.render(null));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:preview');
  });

  it('clears the previous image while another file loads or its original is missing', async () => {
    mocks.read.mockResolvedValueOnce(new Blob(['first'], { type: 'image/png' }));
    await render(image()); expect(host.querySelector('img')).not.toBeNull();
    let resolve: (blob: null) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise<null>(done => { resolve = done; }));
    await render(image('second'));
    expect(host.querySelector('img')).toBeNull();
    await act(async () => { resolve(null); });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Imagem indisponível');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('keeps the readable legacy PDF text once and explains why pages are absent', async () => {
    await render({ id: 'legacy', name: 'Manual.pdf', kind: 'pdf', mediaId: null, mime: 'application/pdf', size: 200, text: 'Texto original preservado.', url: null, addedAt: 1 });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Reanexe o PDF original');
    expect(host.querySelectorAll('pre')).toHaveLength(1);
    expect(host.querySelector('pre')?.textContent).toBe('Texto original preservado.');
  });
});

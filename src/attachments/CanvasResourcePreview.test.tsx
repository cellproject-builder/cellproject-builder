import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasResourcePreview } from './CanvasResourcePreview';
import type { CanvasResource } from './canvasModel';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/visuals/media', () => ({ readVisualMedia: mocks.read }));
let host: HTMLDivElement, root: Root;
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const image = (id = 'first'): CanvasResource => ({ id, name: `${id}.png`, kind: 'image', mediaId: `media-${id}`, mime: 'image/png', size: 3, text: null, url: null, addedAt: 1 });
const render = async (resource: CanvasResource, expanded = true) => {
  await act(async () => { root.render(<CanvasResourcePreview resource={resource} expanded={expanded} />); });
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.read.mockReset();
  vi.stubGlobal('IntersectionObserver', undefined);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalCreateUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateUrl); else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevokeUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeUrl); else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('canvas resource preview lifecycle', () => {
  it('reads no bytes until a canvas card becomes visible', async () => {
    let visible: IntersectionObserverCallback | undefined;
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { visible = callback; }
      observe = observe; disconnect = disconnect;
    });
    mocks.read.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await render(image(), false);
    expect(observe).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => { visible!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('media-first');
    expect(host.querySelector('img')?.src).toBe('blob:preview');
    expect(disconnect).toHaveBeenCalled();
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

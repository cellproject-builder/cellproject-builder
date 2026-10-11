import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentPdfPage } from './AttachmentPdfPage';

const mocks = vi.hoisted(() => ({ read: vi.fn(), document: vi.fn(), owner: null as object | null }));
vi.mock('@/visuals/media', () => ({ readVisualMedia: mocks.read }));
vi.mock('@/cloud/runtime', () => ({ getCloudRuntime: () => mocks.owner }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: mocks.document }));
let host: HTMLDivElement, root: Root;
const blob = () => { const file = new Blob(['%PDF-1.7'], { type: 'application/pdf' }); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) }); return file; };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function documentTask(width = 600, height = 800, pages = 3) {
  const rendering = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = { getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale })), render: vi.fn(() => rendering), cleanup: vi.fn(() => true) };
  const doc = { numPages: pages, getPage: vi.fn(async (_page: number) => page) };
  const task = { promise: Promise.resolve(doc), destroy: vi.fn(async () => {}) };
  mocks.document.mockReturnValue(task); return { task, doc, page, rendering };
}
const render = async (props: Partial<Parameters<typeof AttachmentPdfPage>[0]> = {}) => {
  await act(async () => { root.render(<AttachmentPdfPage mediaId="manual" {...props} />); });
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.read.mockReset().mockResolvedValue(blob()); mocks.document.mockReset();
  mocks.owner = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('PDF attachment rendering', () => {
  it('renders only the requested page with scripts disabled and reports the page count', async () => {
    const { doc, page } = documentTask(), onPages = vi.fn();
    await render({ page: 2, onPages });
    expect(doc.getPage).toHaveBeenCalledExactlyOnceWith(2);
    expect(page.render).toHaveBeenCalledOnce(); expect(onPages).toHaveBeenCalledWith(3);
    expect(mocks.document).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false }));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('canvas')?.hidden).toBe(false);
  });

  it('does not parse a missing original and explains how to recover', async () => {
    mocks.read.mockResolvedValue(null); await render();
    expect(mocks.document).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Tente baixar ou importar novamente');
  });

  it('rejects overlong documents before fetching a page and releases the loading task', async () => {
    const { doc, task } = documentTask(600, 800, 101);
    await render(); expect(doc.getPage).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(task.destroy).toHaveBeenCalledOnce();
    act(() => root.render(null)); expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('destroys a rejected loading task immediately instead of retaining its worker until unmount', async () => {
    const loaded = documentTask();
    loaded.task.promise = Promise.reject(new Error('Malformed PDF'));
    await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(loaded.task.destroy).toHaveBeenCalledOnce();
    act(() => root.render(null)); expect(loaded.task.destroy).toHaveBeenCalledOnce();
  });

  it('releases each completed page resource during a 100-page reading session', async () => {
    const loaded = documentTask(600, 800, 100), retainedPages = new Set<number>();
    loaded.doc.getPage.mockImplementation(async page => {
      retainedPages.add(page);
      return { ...loaded.page, cleanup: vi.fn(() => retainedPages.delete(page)) };
    });
    for (let page = 1; page <= 100; page++) {
      await render({ page });
      expect(retainedPages.size).toBe(0);
    }
    expect(mocks.document).toHaveBeenCalledOnce();
    expect(host.querySelector('canvas')?.hidden).toBe(false);
  });

  it('releases the bitmap immediately after unmount', async () => {
    documentTask(); await render();
    const canvas = host.querySelector('canvas')!;
    expect(canvas.width * canvas.height).toBeGreaterThan(0);
    act(() => root.render(null));
    expect(canvas.width * canvas.height).toBe(0);
  });

  it('releases an old bitmap when the next page fails', async () => {
    const loaded = documentTask(); await render();
    const canvas = host.querySelector('canvas')!;
    loaded.page.getViewport.mockReturnValue({ width: Number.NaN, height: 800 });
    await render({ page: 2 });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(canvas.width * canvas.height).toBe(0);
    expect(loaded.page.cleanup).toHaveBeenCalledTimes(2);
  });

  it('cleans a page that resolves after its render was cancelled', async () => {
    const loaded = documentTask(); let resolve: (value: typeof loaded.page) => void = () => {};
    loaded.doc.getPage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render(); act(() => root.render(null));
    await act(async () => { resolve(loaded.page); });
    expect(loaded.page.render).not.toHaveBeenCalled();
    expect(loaded.page.cleanup).toHaveBeenCalledOnce();
  });

  it('destroys a thumbnail worker after rendering while retaining its completed bitmap', async () => {
    const loaded = documentTask(); await render({ thumbnail: true, width: 240 });
    expect(loaded.task.destroy).toHaveBeenCalledOnce();
    expect(loaded.page.cleanup).toHaveBeenCalledOnce();
    const canvas = host.querySelector('canvas')!;
    expect(canvas.hidden).toBe(false); expect(canvas.width).toBe(240); expect(canvas.height).toBe(320);
    act(() => root.render(null));
    expect(canvas.width * canvas.height).toBe(0);
    expect(loaded.task.destroy).toHaveBeenCalledOnce();
  });

  it('limits a burst of 100 thumbnail workers to two through rendering and destruction', async () => {
    const retainedWorkers = new Set<number>(); let maximumWorkers = 0;
    const loaded = Array.from({ length: 100 }, (_, index) => {
      const item = documentTask(), done = deferred<void>(), destroyed = deferred<void>();
      item.rendering.promise = done.promise;
      item.rendering.cancel.mockImplementation(() => done.reject(new Error('Rendering cancelled')));
      item.task.destroy.mockImplementation(async () => { await destroyed.promise; retainedWorkers.delete(index); });
      return { ...item, done, destroyed };
    });
    let started = 0;
    mocks.document.mockImplementation(() => {
      retainedWorkers.add(started); maximumWorkers = Math.max(maximumWorkers, retainedWorkers.size);
      return loaded[started++].task;
    });
    await act(async () => { root.render(<>{loaded.map((_, index) => <AttachmentPdfPage key={index} mediaId={`pdf-${index}`} width={240} thumbnail />)}</>); });
    expect(started).toBe(2); expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => { loaded[0].done.resolve(); });
    expect(started).toBe(2); // Worker destruction, not raster completion, frees the slot.
    for (let index = 0; index < loaded.length; index++) {
      await act(async () => { loaded[index].done.resolve(); loaded[index].destroyed.resolve(); });
      expect(maximumWorkers).toBeLessThanOrEqual(2);
    }
    expect(started).toBe(100); expect(retainedWorkers.size).toBe(0);
    expect(Array.from(host.querySelectorAll('canvas')).every(canvas => !canvas.hidden && canvas.width === 240 && canvas.height === 320)).toBe(true);
    expect(mocks.read.mock.calls.map(([id]) => id)).toEqual(Array.from({ length: 100 }, (_, index) => `pdf-${index}`));
  });

  it('removes offscreen thumbnails from the queue before their media or workers are loaded', async () => {
    const loaded = documentTask(), done = deferred<void>();
    loaded.rendering.promise = done.promise;
    loaded.rendering.cancel.mockImplementation(() => done.reject(new Error('Rendering cancelled')));
    await act(async () => { root.render(<>{Array.from({ length: 100 }, (_, index) => <AttachmentPdfPage key={index} mediaId={`pdf-${index}`} thumbnail />)}</>); });
    expect(mocks.document).toHaveBeenCalledTimes(2);
    await act(async () => { root.render(null); });
    expect(mocks.document).toHaveBeenCalledTimes(2); expect(mocks.read).toHaveBeenCalledTimes(2);
    documentTask(); await render({ thumbnail: true });
    expect(host.querySelector('canvas')?.hidden).toBe(false);
    expect(mocks.document).toHaveBeenCalledTimes(3);
  });

  it('does not read another account for a thumbnail queued by an earlier account', async () => {
    mocks.owner = {};
    const loaded = documentTask(), done = deferred<void>();
    loaded.rendering.promise = done.promise;
    await act(async () => { root.render(<>{Array.from({ length: 3 }, (_, index) => <AttachmentPdfPage key={index} mediaId={`pdf-${index}`} thumbnail />)}</>); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    mocks.owner = {};
    await act(async () => { done.resolve(); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.document).toHaveBeenCalledTimes(2);
    expect(Array.from(host.querySelectorAll('canvas')).every(canvas => canvas.hidden)).toBe(true);
  });

  it('coalesces 100 page and width changes while an earlier page is still loading', async () => {
    const loaded = documentTask(600, 800, 100), first = deferred<typeof loaded.page>();
    loaded.doc.getPage.mockImplementationOnce(() => first.promise);
    await render({ page: 1 });
    for (let page = 2; page <= 100; page++) await render({ page, width: page + 500 });
    expect(loaded.doc.getPage).toHaveBeenCalledExactlyOnceWith(1);
    await act(async () => { first.resolve(loaded.page); });
    expect(loaded.doc.getPage.mock.calls.map(([page]) => page)).toEqual([1, 100]);
    expect(loaded.page.render).toHaveBeenCalledOnce();
    expect(loaded.page.cleanup).toHaveBeenCalledTimes(2);
    expect(host.querySelector('canvas')?.getAttribute('aria-label')).toBe('Página do PDF 100');
    expect(host.querySelector('canvas')?.hidden).toBe(false);
  });

  it('cancels a pending render but reuses the document across page and width changes', async () => {
    const first = documentTask();
    let cancel: (reason: Error) => void = () => {};
    first.rendering.promise = new Promise<void>((_resolve, reject) => { cancel = reject; });
    first.rendering.cancel.mockImplementation(() => { cancel(new Error('Rendering cancelled')); });
    await render({ page: 1 });
    first.page.render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
    await render({ page: 2 }); await render({ page: 2, width: 1000 });
    expect(first.rendering.cancel).toHaveBeenCalledOnce(); expect(first.task.destroy).not.toHaveBeenCalled();
    expect(first.doc.getPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 2]);
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.document).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    act(() => root.render(null)); expect(first.task.destroy).toHaveBeenCalledOnce();
  });

  it('keeps a very tall PDF inside a finite raster dimension and pixel budget', async () => {
    const { page } = documentTask(100, 100_000);
    await render({ width: 1000 });
    const canvas = host.querySelector('canvas');
    // An unusual page is either rejected or reduced before a browser allocation.
    if (canvas) {
      expect(canvas.width).toBeGreaterThan(0); expect(canvas.height).toBeGreaterThan(0);
      expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(4096);
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
    } else expect(page.render).not.toHaveBeenCalled();
  });

  it('keeps fractional viewport rounding within the four-million-pixel allocation budget', async () => {
    documentTask(1000, 3000); await render({ width: 1400 });
    const canvas = host.querySelector('canvas')!;
    expect(canvas.hidden).toBe(false);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
  });

  it('rejects a non-finite page viewport before assigning canvas dimensions', async () => {
    const { page } = documentTask(Number.NaN, 800);
    await render();
    expect(page.render).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('loads once while the requested page changes before document loading finishes', async () => {
    const loaded = documentTask(); let resolve: (value: typeof loaded.doc) => void = () => {};
    loaded.task.promise = new Promise(done => { resolve = done; });
    await render({ page: 1 }); await render({ page: 3 });
    await act(async () => { resolve(loaded.doc); });
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.document).toHaveBeenCalledOnce();
    expect(loaded.doc.getPage).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('destroys the previous document when changing media and never renders its late page', async () => {
    const first = documentTask(); let resolve: (value: typeof first.page) => void = () => {};
    first.doc.getPage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render();
    const second = documentTask(); await render({ mediaId: 'other' });
    await act(async () => { resolve(first.page); });
    expect(first.task.destroy).toHaveBeenCalledOnce(); expect(first.page.render).not.toHaveBeenCalled();
    expect(second.page.render).toHaveBeenCalledOnce(); expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an open document across runtimes even when the media ID is unchanged', async () => {
    mocks.owner = {}; const first = documentTask(); await render();
    mocks.owner = {}; const second = documentTask(); await render({ page: 2 });
    expect(first.task.destroy).toHaveBeenCalledOnce(); expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(second.doc.getPage).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('does not create a worker from an original that finishes loading after unmount', async () => {
    let resolve: (value: Blob) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render(); act(() => root.render(null));
    await act(async () => { resolve(blob()); });
    expect(mocks.document).not.toHaveBeenCalled();
  });

  it('can render another page after one page fails without reloading the document', async () => {
    const loaded = documentTask(Number.NaN, 800); await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    loaded.page.getViewport.mockImplementation(({ scale }) => ({ width: 600 * scale, height: 800 * scale }));
    await render({ page: 2 });
    expect(mocks.document).toHaveBeenCalledOnce(); expect(loaded.page.render).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.querySelector('canvas')?.hidden).toBe(false);
  });
});

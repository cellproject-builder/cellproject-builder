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
function documentTask(width = 600, height = 800, pages = 3) {
  const rendering = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = { getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale })), render: vi.fn(() => rendering) };
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
    act(() => root.render(null)); expect(task.destroy).toHaveBeenCalledOnce();
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

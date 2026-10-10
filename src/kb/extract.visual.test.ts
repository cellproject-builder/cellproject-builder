import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: mocks.getDocument }));
import { extractPdfText } from './extract';

const file = { arrayBuffer: async () => new TextEncoder().encode('%PDF-').buffer } as File;
beforeEach(() => mocks.getDocument.mockReset());

describe('bounded PDF visual attachment extraction', () => {
  it('rejects PDFs above the page limit before reading pages and destroys the task', async () => {
    const destroy = vi.fn(), getPage = vi.fn();
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 101, getPage }), destroy });
    await expect(extractPdfText(file, undefined, { maxPages: 100, maxChars: 24_000 })).rejects.toThrow('visualPdfPageLimit');
    expect(getPage).not.toHaveBeenCalled(); expect(destroy).toHaveBeenCalledOnce();
  });
  it('stops extraction at the text limit and always destroys the task', async () => {
    const destroy = vi.fn(), getPage = vi.fn(async () => ({ getTextContent: async () => ({ items: [{ str: '0123456789' }] }) }));
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 5, getPage }), destroy });
    const result = await extractPdfText(file, undefined, { maxPages: 100, maxChars: 5 });
    expect(result).toEqual({ pageCount: 5, text: '01234', truncated: true });
    expect(getPage).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
  });
  it('honors cancellation before parsing a PDF', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(extractPdfText(file, undefined, { signal: controller.signal })).rejects.toThrow();
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
});

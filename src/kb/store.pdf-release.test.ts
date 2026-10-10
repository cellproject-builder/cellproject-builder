import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KBSummary } from './types';

const deps = vi.hoisted(() => ({ extract: vi.fn(), summarize: vi.fn() }));
vi.mock('@/cloud/storage', () => ({ selectedStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
vi.mock('@/ai/service', () => ({ classifyAIError: () => ({ title: 'Synthetic summary failure' }) }));
vi.mock('./extract', () => ({ extractPdfText: deps.extract, fingerprintText: (text: string) => `synthetic:${text}` }));
vi.mock('./service', () => ({ MAX_CHARS: 40_000, summarizeDocument: deps.summarize, pickRelevantDocs: vi.fn(), toContextEntries: vi.fn() }));
import { hasActiveDataIngestions } from '@/cloud/activity';
import { useKBStore } from './store';

const summary: KBSummary = { titulo: 'Synthetic PDF', dominio: 'test', tags: [], resumo: ['Synthetic local fixture.'], fatos: [], nivel: 'iniciante' };
const extracted = { text: 'Synthetic complete PDF text.', pageCount: 1 };
const pdf = () => new File(['%PDF-1.7\nsynthetic'], 'fixture.pdf', { type: 'application/pdf' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  deps.extract.mockReset().mockResolvedValue(extracted);
  deps.summarize.mockReset().mockResolvedValue(summary);
  useKBStore.getState().clearAll();
});

describe('PDF knowledge ingestion release guards', () => {
  it('passes bounded extraction and cancellation through while retaining complete text', async () => {
    const controller = new AbortController();
    const id = await useKBStore.getState().addFromPdf(pdf(), undefined, { signal: controller.signal });
    expect(deps.extract).toHaveBeenCalledWith(expect.any(File), expect.any(Function), { signal: controller.signal, maxPages: 100, maxChars: 40_001 });
    expect(useKBStore.getState().docs[id!]).toMatchObject({ extractedText: extracted.text, pageCount: 1, summary });
    expect(hasActiveDataIngestions()).toBe(false);
  });

  it('ignores an already cancelled ingestion before extraction or progress', async () => {
    const controller = new AbortController(); controller.abort(); const progress = vi.fn();
    await expect(useKBStore.getState().addFromPdf(pdf(), progress, { signal: controller.signal })).resolves.toBeNull();
    expect(deps.extract).not.toHaveBeenCalled(); expect(deps.summarize).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
    expect(hasActiveDataIngestions()).toBe(false);
  });

  it('rejects oversized PDFs before allocating bytes or calling AI', async () => {
    const file = pdf(), progress = vi.fn(); Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 });
    await expect(useKBStore.getState().addFromPdf(file, progress)).resolves.toBeNull();
    expect(deps.extract).not.toHaveBeenCalled(); expect(deps.summarize).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', errorKind: 'extract' }));
    expect(hasActiveDataIngestions()).toBe(false);
  });

  it.each([{ text: 'x'.repeat(40_001), pageCount: 1 }, { text: 'short first page', pageCount: 2, truncated: true }])('does not present a bounded PDF excerpt as a complete knowledge document', async result => {
    deps.extract.mockResolvedValue(result); const progress = vi.fn();
    await expect(useKBStore.getState().addFromPdf(pdf(), progress)).resolves.toBeNull();
    expect(deps.summarize).not.toHaveBeenCalled(); expect(useKBStore.getState().docs).toEqual({});
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', errorKind: 'extract' }));
  });

  it.each(['cancel', 'clear'] as const)('stops before AI when %s happens during extraction', async action => {
    const wait = deferred<typeof extracted>(), controller = new AbortController(), progress = vi.fn();
    deps.extract.mockReturnValue(wait.promise);
    const request = useKBStore.getState().addFromPdf(pdf(), progress, { signal: controller.signal });
    await vi.waitFor(() => expect(deps.extract).toHaveBeenCalledOnce());
    const eventsBeforeInvalidation = progress.mock.calls.length;
    if (action === 'cancel') controller.abort(); else useKBStore.getState().clearAll();
    wait.resolve(extracted);
    await expect(request).resolves.toBeNull();
    expect(deps.summarize).not.toHaveBeenCalled(); expect(useKBStore.getState().docs).toEqual({});
    expect(progress).toHaveBeenCalledTimes(eventsBeforeInvalidation); expect(hasActiveDataIngestions()).toBe(false);
  });

  it.each(['cancel', 'clear'] as const)('discards a late successful summary after %s', async action => {
    const wait = deferred<KBSummary>(), controller = new AbortController(), progress = vi.fn();
    deps.summarize.mockReturnValue(wait.promise);
    const request = useKBStore.getState().addFromPdf(pdf(), progress, { signal: controller.signal });
    await vi.waitFor(() => expect(deps.summarize).toHaveBeenCalledOnce());
    const eventsBeforeInvalidation = progress.mock.calls.length;
    if (action === 'cancel') controller.abort(); else useKBStore.getState().clearAll();
    wait.resolve(summary);
    await expect(request).resolves.toBeNull();
    expect(useKBStore.getState().docs).toEqual({}); expect(progress).toHaveBeenCalledTimes(eventsBeforeInvalidation);
    expect(hasActiveDataIngestions()).toBe(false);
  });

  it('keeps a newer successful ingestion when an older cleared summary arrives', async () => {
    const wait = deferred<KBSummary>(); deps.summarize.mockReturnValueOnce(wait.promise);
    const older = useKBStore.getState().addFromPdf(pdf());
    await vi.waitFor(() => expect(deps.summarize).toHaveBeenCalledOnce());
    useKBStore.getState().clearAll();
    deps.extract.mockResolvedValue({ text: 'New complete PDF text.', pageCount: 1 });
    const newerId = await useKBStore.getState().addFromPdf(pdf());
    wait.resolve(summary);
    await expect(older).resolves.toBeNull();
    expect(Object.keys(useKBStore.getState().docs)).toEqual([newerId]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVisualVisionImages, normalizeVisualVisionError } from './vision';
import { readVisualImage } from './media';
import type { VisualArtifact, VisualPromptInput, VisualWorkspace } from './types';

vi.mock('./media', () => ({ readVisualImage: vi.fn(async () => ({ image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })) }));
const image = (id: string, mediaId = id): VisualArtifact => ({ id, label: id, kind: 'image', x: 0, y: 0, width: 10, height: 10, mediaId, scene: null, source: null, revisions: [{ scene: null, mediaId, createdAt: 1 }], revisionIndex: 0 });
const input = (ids: string[]): VisualPromptInput => ({ text: '', analyzeImages: true, mentions: ids.map(id => ({ id, kind: 'image', label: id, detail: '', fingerprint: '' })), attachments: [] });
const workspace = (artifacts: VisualArtifact[]): VisualWorkspace => ({ version: 1, mode: 'approval', artifacts, proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } });
const options = () => ({ signal: new AbortController().signal, assertCurrent: vi.fn() });
afterEach(() => vi.clearAllMocks());

describe('bounded local image input for AI vision', () => {
  it('loads only selected image media, deduplicates IDs and includes attached images', async () => {
    const request = input(['board', 'duplicate']);
    request.attachments = [{ id: 'upload', name: 'detail.png', mime: 'image/png', byteLength: 3, mediaId: 'detail-media', text: null }, { id: 'manual', name: 'manual.txt', mime: 'text/plain', byteLength: 4, mediaId: 'manual-media', text: 'text' }];
    const result = await loadVisualVisionImages(request, workspace([image('board', 'board-media'), image('duplicate', 'board-media'), image('unselected')]), options());
    expect(result).toEqual([
      { mediaId: 'board-media', label: 'board', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      { mediaId: 'detail-media', label: 'detail.png', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
    ]);
    expect(readVisualImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readVisualImage).mock.calls.map(call => call[0])).toEqual(['board-media', 'detail-media']);
  });

  it('does not read pixels without the human opt-in', async () => {
    await expect(loadVisualVisionImages({ ...input(['board']), analyzeImages: false }, workspace([image('board')]), options())).resolves.toEqual([]);
    expect(readVisualImage).not.toHaveBeenCalled();
  });

  it('requires an available local image instead of silently continuing with metadata', async () => {
    await expect(loadVisualVisionImages(input([]), workspace([]), options())).rejects.toThrow('visualVisionImageRequired');
    await expect(loadVisualVisionImages(input(['missing']), workspace([]), options())).rejects.toThrow('visualSourceMissing');
    const request = input([]);
    request.attachments = [{ id: 'missing', name: 'missing.png', mime: 'image/png', byteLength: 3, mediaId: null, text: null }];
    await expect(loadVisualVisionImages(request, workspace([]), options())).rejects.toThrow('visualMediaMissing');
  });

  it('rejects more than eight distinct images before loading any pixels', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `image-${index}`);
    await expect(loadVisualVisionImages(input(ids), workspace(ids.map(id => image(id))), options())).rejects.toThrow('visualVisionLimit');
    expect(readVisualImage).not.toHaveBeenCalled();
  });

  it('rejects more than twenty MiB of image input and checks cancellation after each read', async () => {
    vi.mocked(readVisualImage).mockResolvedValue({ image: new Uint8Array(5 * 1024 * 1024), mediaType: 'image/png' });
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await expect(loadVisualVisionImages(input(ids), workspace(ids.map(id => image(id))), options())).rejects.toThrow('visualVisionLimit');
    const controller = new AbortController();
    vi.mocked(readVisualImage).mockImplementationOnce(async () => { controller.abort(); return { image: new Uint8Array([1]), mediaType: 'image/png' }; });
    await expect(loadVisualVisionImages(input(['a']), workspace([image('a')]), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps nested provider rejection of image input while preserving other errors', () => {
    const unsupported = new Error('No endpoints found that support image input');
    expect(normalizeVisualVisionError(new Error('No object generated', { cause: unsupported }))).toMatchObject({ message: 'visualVisionUnsupported' });
    const rateLimit = new Error('Rate limit reached');
    expect(normalizeVisualVisionError(rateLimit)).toBe(rateLimit);
    const aborted = new DOMException('Aborted', 'AbortError');
    expect(normalizeVisualVisionError(aborted)).toBe(aborted);
  });
});

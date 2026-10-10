import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { copyVisualReference, referenceFromClipboard } from './clipboard';
import type { ImageReference } from './types';

const reference: ImageReference = { id: 'ref', title: 'ESP32', description: '', imageUrl: '/api/visuals/media?sessionId=s&candidateId=ref', sourcePageUrl: 'https://example.com/esp32', width: 1, height: 1, credit: null, license: null, sessionId: 's' };
const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));
afterEach(() => vi.unstubAllGlobals());
describe('canvas image clipboard provenance', () => {
  it('preserves source only when pasted pixels match the copied image and project', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } })));
    await copyVisualReference(reference, 'plan');
    expect(write).toHaveBeenCalledOnce();
    expect(await referenceFromClipboard(new File([bytes], 'paste.png', { type: 'image/png' }), 'plan')).toEqual(reference);
    expect(await referenceFromClipboard(new File([bytes], 'paste.png', { type: 'image/png' }), 'other')).toBeNull();
    expect(await referenceFromClipboard(new File(['different pixels'], 'paste.png', { type: 'image/png' }), 'plan')).toBeNull();
  });
  it('refuses to fetch an arbitrary URL for copying', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(copyVisualReference({ ...reference, imageUrl: 'https://evil.example/image.png' }, 'plan')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

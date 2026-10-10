import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { CloudRuntime, sha256 } from './runtime';
import { captureSessionRescue } from './rescue';

it('rescues latest drafts without any authenticated request and identifies uncached originals explicitly', async () => {
  vi.stubGlobal('crypto', webcrypto);
  try {
    const missing = new TextEncoder().encode('remote original').buffer;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}, { status: 401 }));
    const runtime = new CloudRuntime({ documents: [], media: [{ id: 'original', mime: 'text/plain', name: 'original.md', sha256: await sha256(missing), size: missing.byteLength }] }, fetcher);
    await runtime.write('cellproject-graph', '{"state":{"drafts":{"n":"unsaved work"}},"version":0}');
    const count = fetcher.mock.calls.length;
    const rescue = await captureSessionRescue(runtime);
    expect(fetcher).toHaveBeenCalledTimes(count); expect(rescue.complete).toBe(false);
    expect(rescue.documents[0].value).toContain('unsaved work'); expect(rescue.missingMediaIds).toEqual(['original']);
    expect(rescue.media[0]).toMatchObject({ id: 'original', sha256: await sha256(missing) });
  } finally { vi.unstubAllGlobals(); }
});

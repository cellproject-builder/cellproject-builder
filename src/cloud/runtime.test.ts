import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CloudRuntime, CloudConflictError, configureCloud, isCloudEnabled, cloudProviderAvailable, sha256 } from './runtime';

const snapshot = () => ({ documents: [{ key: 'cellproject-workspace', value: '{"state":{"projects":{}},"version":2}', revision: 4 }], media: [] });
beforeEach(() => configureCloud(null));
it('hydrates remote envelopes without reading legacy and serializes writes against acknowledged revisions', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 5 }));
  const runtime = new CloudRuntime(snapshot(), fetcher);
  expect(runtime.get('cellproject-workspace')).toContain('projects');
  await runtime.write('cellproject-workspace', '{"state":{"projects":{"p":{"id":"p"}}},"version":2}');
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ baseRevision: 4, operationId: expect.any(String) });
  expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({ 'X-Cellproject-Request': '1' });
  expect(runtime.getSnapshot().pending).toBe(0); expect(runtime.documents()[0].revision).toBe(5);
});
it('preserves a conflict and queued drafts without silently overwriting the server', async () => {
  const fetcher = vi.fn(async () => Response.json({ error: 'revision_conflict' }, { status: 409 }));
  const runtime = new CloudRuntime(snapshot(), fetcher);
  await runtime.write('cellproject-workspace', 'local proposal');
  expect(runtime.getSnapshot().issue?.kind).toBe('conflict'); expect(runtime.get('cellproject-workspace')).toBe('local proposal');
  await runtime.write('cellproject-workspace', 'new local proposal');
  expect(fetcher).toHaveBeenCalledOnce(); expect(runtime.getSnapshot().pending).toBe(2);
  await expect(runtime.flush()).rejects.toBeInstanceOf(CloudConflictError);
});
it('retries a lost response with the same operation identity before writing later changes', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(Response.json({ revision: 5 })).mockResolvedValueOnce(Response.json({ revision: 6 }));
  const runtime = new CloudRuntime(snapshot(), fetcher);
  await runtime.write('cellproject-workspace', 'one'); await runtime.write('cellproject-workspace', 'two');
  await runtime.retry();
  expect(JSON.parse(fetcher.mock.calls[0][1].body).operationId).toBe(JSON.parse(fetcher.mock.calls[1][1].body).operationId);
  expect(JSON.parse(fetcher.mock.calls[2][1].body).baseRevision).toBe(5); expect(runtime.getSnapshot().pending).toBe(0);
});
it('coalesces unsent adjacent changes while keeping the request in flight immutable', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(Response.json({ revision: 6 }));
  const runtime = new CloudRuntime(snapshot(), fetcher);
  const first = runtime.write('cellproject-workspace', 'first');
  for (let i = 0; i < 100; i++) void runtime.write('cellproject-workspace', `position ${i}`);
  expect(runtime.getSnapshot().pending).toBe(2); expect(runtime.get('cellproject-workspace')).toBe('position 99');
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).value).toBe('first');
  finish(Response.json({ revision: 5 })); await first;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({ value: 'position 99', baseRevision: 5 });
});
it('retries the entire ambiguous request unchanged and then saves the latest coalesced draft', async () => {
  let fail!: (reason: Error) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { fail = reject; })).mockResolvedValueOnce(Response.json({ revision: 5 })).mockResolvedValueOnce(Response.json({ revision: 6 }));
  const runtime = new CloudRuntime(snapshot(), fetcher);
  const first = runtime.write('cellproject-workspace', 'first');
  for (let i = 0; i < 100; i++) void runtime.write('cellproject-workspace', `position ${i}`);
  const original = fetcher.mock.calls[0][1]!.body;
  fail(new Error('response lost')); await first;
  expect(runtime.getSnapshot()).toMatchObject({ pending: 2, issue: { kind: 'network' } });
  expect(runtime.get('cellproject-workspace')).toBe('position 99');
  await runtime.retry();
  expect(fetcher.mock.calls[1][1]!.body).toBe(original);
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toMatchObject({ value: 'position 99', baseRevision: 5 });
  expect(runtime.getSnapshot().pending).toBe(0);
});
it('sanitizes provider config, exposes capabilities without secrets and suspends writes on disposal', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 1 }));
  const runtime = new CloudRuntime({ documents: [], media: [] }, fetcher);
  configureCloud(runtime, { openrouter: true }); expect(isCloudEnabled()).toBe(true); expect(cloudProviderAvailable('openrouter')).toBe(true);
  await runtime.write('cellproject-config', JSON.stringify({ version: 4, state: { providers: { openrouter: { apiKey: 'TEST_SECRET', mainModel: 'm' } } } }));
  expect(fetcher.mock.calls[0][1]!.body).not.toContain('TEST_SECRET'); expect(runtime.get('cellproject-config')).not.toContain('apiKey');
  runtime.dispose(); await runtime.write('cellproject-workspace', 'later'); expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects malformed store envelopes and duplicate media before application hydration', () => {
  expect(() => new CloudRuntime({ documents: [{ ...snapshot().documents[0], value: '{"state":{}}' }], media: [] })).toThrow('Envelope');
  expect(() => new CloudRuntime({ documents: [{ ...snapshot().documents[0], value: '{"state":[],"version":1}' }], media: [] })).toThrow('Envelope');
  expect(() => new CloudRuntime({ documents: [], media: [{ id: 'x', mime: 'text/plain', name: 'x.txt', sha256: '0'.repeat(64), size: 1 }, { id: 'x', mime: 'text/plain', name: 'x.txt', sha256: '0'.repeat(64), size: 1 }] })).toThrow('Catálogo');
});
it('verifies uploaded and downloaded bytes and refuses content replacement under an existing media id', async () => {
  vi.stubGlobal('crypto', webcrypto);
  try {
    const bytes = new TextEncoder().encode('original').buffer, hash = await sha256(bytes);
    const fetcher = vi.fn<typeof fetch>(async path => String(path) === '/api/cloud/media' ? Response.json({ id: 'file', sha256: hash, size: bytes.byteLength }) : new Response(bytes));
    const runtime = new CloudRuntime({ documents: [], media: [] }, fetcher);
    await runtime.writeMedia({ id: 'file', mime: 'text/plain', name: 'code.txt', bytes });
    expect(new Uint8Array((await runtime.readMedia('file'))!)).toEqual(new Uint8Array(bytes));
    await expect(runtime.writeMedia({ id: 'file', mime: 'text/plain', name: 'code.txt', bytes: new TextEncoder().encode('changed').buffer })).rejects.toBeInstanceOf(CloudConflictError);
    expect(fetcher).toHaveBeenCalledOnce();
    const uncached = new CloudRuntime({ documents: [], media: runtime.media() }, vi.fn(async () => new Response('corrupt')));
    await expect(uncached.readMedia('file')).rejects.toThrow('Integridade');
    runtime.dispose(); expect(runtime.media()).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});

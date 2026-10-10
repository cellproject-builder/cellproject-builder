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

it('refreshes newer selected documents and uses their acknowledged revision without echoing remote application', async () => {
  const remote = snapshot(); remote.documents[0] = { ...remote.documents[0], value: '{"state":{"projects":{"remote":{}}},"version":2}', revision: 7 };
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => Response.json(init?.method === 'PUT' ? { revision: 8 } : remote));
  const runtime = new CloudRuntime(snapshot(), fetcher), listener = vi.fn(); runtime.subscribeRemote(listener);
  const applied = vi.fn(() => { void runtime.write('cellproject-workspace', 'echo from store'); });
  expect(await runtime.refreshRemote({ keys: ['cellproject-workspace'], apply: applied })).toHaveLength(1);
  expect(runtime.get('cellproject-workspace')).toBe(remote.documents[0].value); expect(listener).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
  await runtime.write('cellproject-workspace', 'actual later edit');
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).baseRevision).toBe(7);
});

it('defers remote refresh while a draft exists and refuses stale, malformed or changed content under the same revision', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({}, { status: 409 }));
  const runtime = new CloudRuntime(snapshot(), fetcher); await runtime.write('cellproject-workspace', 'preserved draft');
  expect(await runtime.refreshRemote()).toEqual([]); expect(fetcher).toHaveBeenCalledOnce(); expect(runtime.get('cellproject-workspace')).toBe('preserved draft');
  for (const doc of [{ ...snapshot().documents[0], revision: 3 }, { ...snapshot().documents[0], value: 'invalid', revision: 5 }, { ...snapshot().documents[0], value: '{"version":2,"state":{"changed":true}}' }]) {
    const clean = new CloudRuntime(snapshot(), vi.fn(async () => Response.json({ documents: [doc], media: [] })));
    await expect(clean.refreshRemote()).rejects.toThrow(); expect(clean.get('cellproject-workspace')).toBe(snapshot().documents[0].value);
  }
});

it('does not apply a remote fetch that raced with a local write, and shares overlapping refresh requests', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => init?.method === 'PUT' ? Response.json({ revision: 5 }) : new Promise<Response>(done => { resolve = done; }));
  const runtime = new CloudRuntime(snapshot(), fetcher), apply = vi.fn();
  const first = runtime.refreshRemote({ apply }), second = runtime.refreshRemote({ apply });
  await runtime.write('cellproject-workspace', 'local while fetching');
  resolve(Response.json({ documents: [{ ...snapshot().documents[0], revision: 6 }], media: [] }));
  expect(await first).toEqual([]); expect(await second).toEqual([]); expect(apply).not.toHaveBeenCalled();
  expect(runtime.get('cellproject-workspace')).toBe('local while fetching'); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not adopt unrelated documents, rolls back an invalid domain application, and ignores a disposed request', async () => {
  const newer = snapshot(); newer.documents[0].revision = 5;
  const remote = { ...newer, documents: [...newer.documents, { key: 'dynamic_diary-theme', value: 'light', revision: 1 }] };
  const runtime = new CloudRuntime(snapshot(), vi.fn(async () => Response.json(remote)));
  await runtime.refreshRemote({ keys: ['cellproject-workspace'] }); expect(runtime.get('dynamic_diary-theme')).toBeNull();
  const broken = new CloudRuntime(snapshot(), vi.fn(async () => Response.json(newer)));
  await expect(broken.refreshRemote({ apply: () => { throw new Error('invalid note drawing'); } })).rejects.toThrow('invalid note');
  expect(broken.documents()[0].revision).toBe(4);
  let finish!: (response: Response) => void;
  const disposed = new CloudRuntime(snapshot(), vi.fn(async () => new Promise<Response>(resolve => { finish = resolve; })));
  const apply = vi.fn(), pending = disposed.refreshRemote({ apply }); disposed.dispose(); finish(Response.json(newer));
  expect(await pending).toEqual([]); expect(apply).not.toHaveBeenCalled(); expect(disposed.documents()).toEqual([]);
});

it('never suppresses a real edit after the synchronous remote-application scope', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 5 })), runtime = new CloudRuntime(snapshot(), fetcher);
  runtime.withRemoteApply(() => { void runtime.write('cellproject-workspace', 'remote echo'); });
  expect(fetcher).not.toHaveBeenCalled();
  await runtime.write('cellproject-workspace', 'independent keyboard input'); expect(fetcher).toHaveBeenCalledOnce();
  expect(runtime.get('cellproject-workspace')).toBe('independent keyboard input');
});

it('recovers a transient read failure on the next poll without blocking local edits or retrying mutations', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('read offline')).mockResolvedValueOnce(Response.json(snapshot())).mockResolvedValueOnce(Response.json({ revision: 5 }));
  const runtime = new CloudRuntime(snapshot(), fetcher);
  await expect(runtime.refreshRemote()).rejects.toThrow('read offline'); expect(runtime.getSnapshot().issue?.key).toBe('remote-sync');
  await runtime.refreshRemote(); expect(runtime.getSnapshot().issue).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
  await runtime.write('cellproject-workspace', 'real input'); expect(fetcher).toHaveBeenCalledTimes(3);
});

function checkpointStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    read: async <T,>(slot: string) => (data.has(slot) ? structuredClone(data.get(slot)) : null) as T | null,
    write: vi.fn(async (slot: string, value: unknown) => { data.set(slot, structuredClone(value)); }),
    remove: async (slot: string) => { data.delete(slot); },
  };
}
const durableValue = (text: string) => JSON.stringify({ version: 2, state: { projects: {}, text } });
it('rehydrates an offline draft and sends its durable operation only after account verification', async () => {
  const persistence = checkpointStore(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 5 }));
  let verified = false;
  const options = { persistence, networkReady: () => verified };
  const first = new CloudRuntime(snapshot(), fetcher, undefined, undefined, options);
  await first.write('cellproject-workspace', durableValue('offline draft'));
  expect(fetcher).not.toHaveBeenCalled(); expect(first.getSnapshot()).toMatchObject({ pending: 1, localSaved: true, offline: true });
  const saved = await persistence.read<any>('runtime');
  expect(saved.queue).toHaveLength(1); first.dispose();
  const restored = new CloudRuntime(snapshot(), fetcher, undefined, undefined, { ...options, checkpoint: saved });
  expect(restored.get('cellproject-workspace')).toBe(durableValue('offline draft'));
  await restored.retry(); expect(fetcher).not.toHaveBeenCalled();
  verified = true; restored.notifyNetworkState(); await restored.retry();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).operationId).toBe(saved.queue[0].operationId);
  expect(restored.getSnapshot()).toMatchObject({ pending: 0, localSaved: true, offline: false });
});
it('keeps a draft in memory and blocks sending when its local checkpoint fails', async () => {
  const persistence = checkpointStore(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 5 }));
  persistence.write.mockRejectedValue(new Error('quota exhausted'));
  const runtime = new CloudRuntime(snapshot(), fetcher, undefined, undefined, { persistence });
  await runtime.write('cellproject-workspace', durableValue('preserved despite quota'));
  expect(runtime.get('cellproject-workspace')).toBe(durableValue('preserved despite quota'));
  expect(fetcher).not.toHaveBeenCalled(); expect(runtime.getSnapshot()).toMatchObject({ pending: 1, localSaved: false, localError: 'quota exhausted' });
  await expect(runtime.flush()).rejects.toThrow('quota');
  persistence.write.mockImplementation(async (slot, value) => { persistence.data.set(slot, structuredClone(value)); });
  await runtime.retry(); expect(fetcher).toHaveBeenCalledOnce(); expect(runtime.getSnapshot()).toMatchObject({ pending: 0, localSaved: true });
});
it('restores a conflict without retrying or discarding the queued draft', async () => {
  const persistence = checkpointStore(), fetcher = vi.fn<typeof fetch>(async () => Response.json({}, { status: 409 }));
  const runtime = new CloudRuntime(snapshot(), fetcher, undefined, undefined, { persistence });
  await runtime.write('cellproject-workspace', durableValue('conflict draft'));
  const saved = await persistence.read<any>('runtime'); runtime.dispose();
  const restored = new CloudRuntime(snapshot(), fetcher, undefined, undefined, { persistence, checkpoint: saved });
  await restored.retry(); expect(fetcher).toHaveBeenCalledOnce();
  expect(restored.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' } });
  expect(restored.get('cellproject-workspace')).toBe(durableValue('conflict draft'));
});
it('rejects malformed runtime checkpoints before selecting any stored draft', async () => {
  const persistence = checkpointStore(), runtime = new CloudRuntime(snapshot(), fetch, undefined, undefined, { persistence, networkReady: () => false });
  await runtime.write('cellproject-workspace', durableValue('valid'));
  const saved = await persistence.read<any>('runtime');
  for (const checkpoint of [{ ...saved, version: 99 }, { ...saved, queue: [...saved.queue, saved.queue[0]] }, { ...saved, drafts: [['unknown-document', 'private']] }, { ...saved, queue: [{ ...saved.queue[0], baseRevision: -1 }] }]) {
    expect(() => new CloudRuntime(snapshot(), fetch, undefined, undefined, { persistence, checkpoint })).toThrow();
  }
});

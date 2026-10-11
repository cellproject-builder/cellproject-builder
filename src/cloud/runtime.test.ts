import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CloudRuntime, CloudConflictError, CloudHttpError, cloudJson, configureCloud, isCloudEnabled, cloudProviderAvailable, sha256 } from './runtime';

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
it('polls an identical durable snapshot without reparsing documents, rewriting the checkpoint or notifying the UI', async () => {
  const remote = snapshot(), persistence = checkpointStore(), fetcher = vi.fn<typeof fetch>(async () => Response.json(remote));
  const runtime = new CloudRuntime(remote, fetcher, undefined, undefined, { persistence });
  await runtime.persistCheckpoint(); persistence.write.mockClear();
  const changed = vi.fn(), applied = vi.fn(); runtime.subscribe(changed);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    expect(await runtime.refreshRemote({ apply: applied })).toEqual([]);
    expect(await runtime.refreshRemote({ apply: applied })).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls.filter(([value]) => value === remote.documents[0].value)).toHaveLength(0);
    expect(persistence.write).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
});
it('persists an initial identical snapshot and retries a failed checkpoint before taking the idle fast path', async () => {
  const persistence = checkpointStore(), fetcher = vi.fn<typeof fetch>(async () => Response.json(snapshot()));
  const runtime = new CloudRuntime(snapshot(), fetcher, undefined, undefined, { persistence });
  persistence.write.mockRejectedValueOnce(new Error('checkpoint quota'));
  await expect(runtime.refreshRemote()).rejects.toThrow('checkpoint quota');
  expect(runtime.getSnapshot().localSaved).toBe(false);
  await runtime.retry(); expect(runtime.getSnapshot().localSaved).toBe(true);
  persistence.write.mockClear(); await runtime.refreshRemote();
  expect(persistence.write).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('durably clears a recovered transient read warning before subsequent unchanged polls become idle', async () => {
  const persistence = checkpointStore(), fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('temporarily offline')).mockImplementation(async () => Response.json(snapshot()));
  const runtime = new CloudRuntime(snapshot(), fetcher, undefined, undefined, { persistence }); await runtime.persistCheckpoint();
  await expect(runtime.refreshRemote()).rejects.toThrow('temporarily offline');
  await runtime.refreshRemote();
  expect(runtime.getSnapshot().issue).toBeNull(); expect((await persistence.read<{ issue: unknown }>('runtime'))!.issue).toBeNull();
  persistence.write.mockClear(); await runtime.refreshRemote(); expect(persistence.write).not.toHaveBeenCalled();
});
it('compares the entire media catalog and isolates it from mutable caller records', async () => {
  const original = { id: 'file', mime: 'text/plain', name: 'a.txt', projectId: 'p', createdAt: 1, sha256: '0'.repeat(64), size: 1 };
  let remote = { ...snapshot(), media: [{ ...original }] };
  const persistence = checkpointStore(), load = vi.fn(async () => remote);
  const runtime = new CloudRuntime(remote, fetch, undefined, load, { persistence });
  await runtime.persistCheckpoint();
  remote.media[0].name = 'from loader.txt'; runtime.media()[0].size = 99;
  expect(runtime.media()[0]).toEqual(original);
  for (const patch of [{ name: 'b.txt' }, { mime: 'text/markdown' }, { projectId: 'p2' }, { createdAt: 2 }, { sha256: '1'.repeat(64) }, { size: 2 }]) {
    remote = { ...remote, media: [{ ...remote.media[0], ...patch }] }; persistence.write.mockClear();
    expect(await runtime.refreshRemote()).toEqual([]);
    expect(runtime.media()).toEqual(remote.media); expect(persistence.write).toHaveBeenCalledOnce();
  }
  remote = { ...remote, media: [] }; persistence.write.mockClear(); await runtime.refreshRemote();
  expect(runtime.media()).toEqual([]); expect(persistence.write).toHaveBeenCalledOnce();
});
it('keeps auth and malformed snapshot checks active after an identical refresh', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(snapshot()));
  const runtime = new CloudRuntime(snapshot(), fetcher); await runtime.refreshRemote();
  fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
  await expect(runtime.refreshRemote()).rejects.toMatchObject({ status: 401 });
  expect(runtime.getSnapshot().issue?.kind).toBe('session');
  const duplicate = { ...snapshot(), documents: [snapshot().documents[0], snapshot().documents[0]] };
  const invalid = new CloudRuntime(snapshot(), fetch, undefined, async () => duplicate);
  await expect(invalid.refreshRemote()).rejects.toThrow('Snapshot');
});
it.each(['documents', 'media'] as const)('rejects sparse %s returned by a snapshot loader instead of skipping validation', async kind => {
  const base = { ...snapshot(), media: [{ id: 'file', mime: 'text/plain', name: 'a.txt', sha256: '0'.repeat(64), size: 1 }] };
  const sparse = { ...base, [kind]: new Array(1) };
  const runtime = new CloudRuntime(base, fetch, undefined, async () => sparse);
  await expect(runtime.refreshRemote()).rejects.toThrow();
  expect(runtime.documents()).toEqual(base.documents); expect(runtime.media()).toEqual(base.media);
});
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

const concurrencyEnvelope = (boards: Record<string, unknown> = {}, notes: Record<string, unknown> = {}) => JSON.stringify({ version: 2, state: { projects: {}, tasks: {}, comments: {}, sprints: {}, folders: {}, notes, boards, legacyImported: true } });
const concurrencyNote = (title: string) => ({ id: 'note', title, blocks: [{ id: 'text', type: 'text', text: title }], projectId: null, taskId: null, folderId: null, pinned: false, deletedAt: null, createdAt: 1, updatedAt: 2 });
const concurrencyBoard = (id: string, title: string) => ({ id, title, archived: false, createdAt: 1, updatedAt: 2, document: { version: 1, items: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } });
const concurrencySnapshot = (value: string, revision: number) => ({ documents: [{ key: 'cellproject-workspace', value, revision }], media: [] });
const documentRevisionConflict = () => Response.json({ error: 'revision_conflict' }, { status: 409 });

it('recognizes the typed revision code in the production error envelope without exposing server details', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 'revision_conflict', message: 'PRIVATE_UPSTREAM_DETAILS', requestId: 'request' } }, { status: 409 }));
  await expect(cloudJson('/api/cloud/documents/cellproject-workspace', {}, fetcher)).rejects.toMatchObject({ status: 409, code: 'revision_conflict', message: 'Conflito de revisão no servidor.' });
  const malformed = vi.fn<typeof fetch>(async () => Response.json({ error: { code: { secret: true } } }, { status: 409 }));
  await expect(cloudJson('/api/cloud/documents/cellproject-workspace', {}, malformed)).rejects.toBeInstanceOf(CloudHttpError);
});

it('rebases an independent note edit over a board edit after a definitive revision rejection', async () => {
  const base = concurrencyEnvelope({ b: concurrencyBoard('b', 'Before') }, { note: concurrencyNote('Before') });
  const local = concurrencyEnvelope({ b: concurrencyBoard('b', 'Before') }, { note: concurrencyNote('Typed on PC') });
  const remote = concurrencyEnvelope({ b: concurrencyBoard('b', 'Tablet board') }, { note: concurrencyNote('Before') });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockResolvedValueOnce(Response.json({ revision: 3 }));
  const load = vi.fn(async () => concurrencySnapshot(remote, 2));
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, load);
  await runtime.write('cellproject-workspace', local); await runtime.flush();
  const saved = JSON.parse(runtime.get('cellproject-workspace')!).state;
  expect(saved.notes.note.title).toBe('Typed on PC'); expect(saved.boards.b.title).toBe('Tablet board');
  expect(runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  const bodies = fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
  expect(bodies[1].baseRevision).toBe(2); expect(bodies[1].operationId).not.toBe(bodies[0].operationId);
});

it('retains edits queued while loading a conflicting revision and corrects the following stale store snapshot', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const firstLocal = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local 1'), b: concurrencyBoard('b', 'B') });
  const secondLocal = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local 2'), b: concurrencyBoard('b', 'B') });
  const thirdLocal = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local 3'), b: concurrencyBoard('b', 'B') });
  const remote = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'Remote') });
  let finish!: (snapshot: ReturnType<typeof concurrencySnapshot>) => void;
  const load = vi.fn(() => new Promise<ReturnType<typeof concurrencySnapshot>>(resolve => { finish = resolve; }));
  let revision = 2;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockImplementation(async () => Response.json({ revision: ++revision }));
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, load);
  const first = runtime.write('cellproject-workspace', firstLocal);
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  void runtime.write('cellproject-workspace', secondLocal);
  finish(concurrencySnapshot(remote, 2)); await first; await runtime.flush();
  expect(JSON.parse(runtime.get('cellproject-workspace')!).state.boards).toMatchObject({ a: { title: 'Local 2' }, b: { title: 'Remote' } });
  await runtime.write('cellproject-workspace', thirdLocal); await runtime.flush();
  expect(JSON.parse(runtime.get('cellproject-workspace')!).state.boards).toMatchObject({ a: { title: 'Local 3' }, b: { title: 'Remote' } });
});

it('applies a rebased canonical document on an idle refresh even when its revision was already acknowledged', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'B') });
  const remote = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'Remote') });
  let current = concurrencySnapshot(remote, 2);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockImplementation(async (_path, init) => {
    current = concurrencySnapshot(JSON.parse(String(init?.body)).value, 3); return Response.json({ revision: 3 });
  });
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, async () => current);
  await runtime.write('cellproject-workspace', local);
  const apply = vi.fn((documents: readonly { key: string; value: string }[]) => { void runtime.write(documents[0].key, documents[0].value); });
  expect(await runtime.refreshRemote({ apply })).toHaveLength(1); expect(apply).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(await runtime.refreshRemote({ apply })).toEqual([]);
});

it('keeps incompatible same-note text as a conflict and never sends a merged replacement', async () => {
  const base = concurrencyEnvelope({}, { note: concurrencyNote('Before') });
  const local = concurrencyEnvelope({}, { note: concurrencyNote('PC') });
  const remote = concurrencyEnvelope({}, { note: concurrencyNote('Tablet') });
  const fetcher = vi.fn<typeof fetch>(async () => documentRevisionConflict());
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, async () => concurrencySnapshot(remote, 2));
  await runtime.write('cellproject-workspace', local);
  expect(runtime.get('cellproject-workspace')).toBe(local); expect(runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' } });
  expect(fetcher).toHaveBeenCalledOnce(); await expect(runtime.flush()).rejects.toBeInstanceOf(CloudConflictError);
});

it('recovers a durable definitive conflict after reload and journals its new identity before retrying', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'B') });
  const remote = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'Remote') });
  const persistence = checkpointStore(), firstFetcher = vi.fn<typeof fetch>(async () => documentRevisionConflict());
  const first = new CloudRuntime(concurrencySnapshot(base, 1), firstFetcher, undefined, async () => { throw new Error('read offline'); }, { persistence });
  await first.write('cellproject-workspace', local);
  const saved = await persistence.read<any>('runtime'); first.dispose();
  const retired: string[] = [];
  const secondFetcher = vi.fn<typeof fetch>(async (_path, init) => {
    const body = JSON.parse(String(init?.body)), journal = await persistence.read<any>('runtime');
    expect(journal.queue[0].operationId).toBe(body.operationId); expect(body.operationId).not.toBe(saved.queue[0].operationId);
    return Response.json({ revision: 3 });
  });
  const restored = new CloudRuntime(concurrencySnapshot(base, 1), secondFetcher, undefined, async () => concurrencySnapshot(remote, 2), { persistence, checkpoint: saved, rejectOperation: async id => { retired.push(id); } });
  await restored.retry(); await restored.flush();
  expect(retired).toContain(saved.queue[0].operationId);
  expect(JSON.parse(restored.get('cellproject-workspace')!).state.boards).toMatchObject({ a: { title: 'Local' }, b: { title: 'Remote' } });
});

it('retries an older restored conflict with its original identity before attempting a safe merge', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'B') });
  const remote = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'Remote') });
  const first = new CloudRuntime(concurrencySnapshot(base, 1), vi.fn(async () => Response.json({}, { status: 409 })));
  await first.write('cellproject-workspace', local);
  const saved = first.checkpoint(); first.dispose();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockResolvedValueOnce(Response.json({ revision: 3 }));
  const restored = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, async () => concurrencySnapshot(remote, 2), { checkpoint: saved });
  await restored.retry(); await restored.flush();
  const bodies = fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
  expect(bodies[0]).toMatchObject({ operationId: saved.queue[0].operationId, value: local, baseRevision: 1 });
  expect(bodies[1].operationId).not.toBe(bodies[0].operationId);
  expect(JSON.parse(restored.get('cellproject-workspace')!).state.boards.b.title).toBe('Remote');
});

it('bounds repeated definitive revision rejections while retaining the latest merged draft', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'B') });
  let revision = 1;
  const fetcher = vi.fn<typeof fetch>(async () => documentRevisionConflict());
  const load = vi.fn(async () => concurrencySnapshot(concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', `Remote ${++revision}`) }), revision));
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, load);
  await runtime.write('cellproject-workspace', local);
  expect(fetcher).toHaveBeenCalledTimes(4); expect(load).toHaveBeenCalledTimes(3);
  expect(runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' } });
  expect(JSON.parse(runtime.get('cellproject-workspace')!).state.boards).toMatchObject({ a: { title: 'Local' }, b: { title: 'Remote 4' } });
});

it('never rebases an operation-identity rejection or ambiguous network failure', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local') });
  for (const failure of [Response.json({ error: 'vault_operation_conflict' }, { status: 409 }), new Error('response lost')]) {
    const load = vi.fn(async () => concurrencySnapshot(base, 2));
    const fetcher = vi.fn<typeof fetch>(async () => { if (failure instanceof Error) throw failure; return failure; });
    const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, load);
    await runtime.write('cellproject-workspace', local);
    expect(load).not.toHaveBeenCalled(); expect(runtime.get('cellproject-workspace')).toBe(local);
    expect(runtime.checkpoint().queue[0].rejected).toBeUndefined();
  }
});

it('does not send a rebased replacement until its new runtime checkpoint is durable', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'B') });
  const remote = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'Remote') });
  const persistence = checkpointStore(); let fail = true;
  persistence.write.mockImplementation(async (slot, value: any) => {
    if (fail && value.confirmed.documents[0].revision === 2) throw new Error('rebase checkpoint quota');
    persistence.data.set(slot, structuredClone(value));
  });
  const retire = vi.fn(async () => {});
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockResolvedValueOnce(Response.json({ revision: 3 }));
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, async () => concurrencySnapshot(remote, 2), { persistence, rejectOperation: retire });
  await runtime.write('cellproject-workspace', local);
  expect(fetcher).toHaveBeenCalledOnce(); expect(retire).not.toHaveBeenCalled();
  expect(runtime.getSnapshot().localError).toBe('rebase checkpoint quota');
  fail = false; await runtime.retry(); await runtime.flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(retire).toHaveBeenCalledOnce();
  expect(JSON.parse(runtime.get('cellproject-workspace')!).state.boards.b.title).toBe('Remote');
});

it('preserves a newly conflicting edit from a stale store without submitting it on retry', async () => {
  const base = concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'B') });
  const local = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'B') });
  let current = concurrencySnapshot(concurrencyEnvelope({ a: concurrencyBoard('a', 'A'), b: concurrencyBoard('b', 'Remote') }), 2);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockImplementation(async (_path, init) => {
    current = concurrencySnapshot(JSON.parse(String(init?.body)).value, 3); return Response.json({ revision: 3 });
  });
  const runtime = new CloudRuntime(concurrencySnapshot(base, 1), fetcher, undefined, async () => current);
  await runtime.write('cellproject-workspace', local);
  const incompatible = concurrencyEnvelope({ a: concurrencyBoard('a', 'Local'), b: concurrencyBoard('b', 'Overwrite from stale PC') });
  await runtime.write('cellproject-workspace', incompatible); await runtime.retry();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(runtime.getSnapshot().issue?.kind).toBe('conflict');
  expect(runtime.get('cellproject-workspace')).toBe(incompatible);
  expect(JSON.parse(current.documents[0].value).state.boards.b.title).toBe('Remote');
});

const managedPlanner = (id: string, title: string) => ({ project: { id, name: title, objective: title, rootId: 'root', nodes: { root: { id: 'root', name: title } }, edges: {}, createdAt: 1, updatedAt: 2 }, selectedNodeId: 'root', focusedParentId: 'root', lens: 'structure', viewMode: 'tutor', detailPanelOpen: true, lastTutorNodeId: null, drafts: {}, objectiveDraft: { name: title, objective: title, rules: [], expanded: {} }, pendingSuggestions: null, parkedSuggestions: {}, archivedProject: null, archivedPending: null });
const managedWorkspace = (one: ReturnType<typeof managedPlanner>, two: ReturnType<typeof managedPlanner>) => {
  const envelope = JSON.parse(concurrencyEnvelope());
  envelope.state.projects = Object.fromEntries([one, two].map((planner, index) => [`managed-${index}`, { id: `managed-${index}`, name: planner.project.name, objective: planner.project.objective, archived: false, createdAt: 1, updatedAt: 2, planner }]));
  return JSON.stringify(envelope);
};

it('allows different managed plan checkpoints only after both complete planner snapshots are preserved in the merged workspace', async () => {
  const originalOne = managedPlanner('one', 'One'), originalTwo = managedPlanner('two', 'Two');
  const remoteOne = managedPlanner('one', 'PC edit'), localTwo = managedPlanner('two', 'Tablet edit');
  const graph = (state: unknown) => JSON.stringify({ version: 6, state });
  const base = { documents: [{ key: 'cellproject-graph', value: graph(originalOne), revision: 1 }, { key: 'cellproject-workspace', value: managedWorkspace(originalOne, originalTwo), revision: 1 }], media: [] };
  const incoming = { documents: [{ key: 'cellproject-graph', value: graph(remoteOne), revision: 2 }, { key: 'cellproject-workspace', value: managedWorkspace(remoteOne, originalTwo), revision: 2 }], media: [] };
  let finish!: () => void;
  const load = vi.fn(() => new Promise<typeof incoming>(resolve => { finish = () => resolve(incoming); }));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(documentRevisionConflict()).mockImplementation(async () => Response.json({ revision: 3 }));
  const runtime = new CloudRuntime(base, fetcher, undefined, load);
  const first = runtime.write('cellproject-graph', graph(localTwo));
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  void runtime.write('cellproject-workspace', managedWorkspace(originalOne, localTwo));
  finish(); await first; await runtime.flush();
  expect(runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  expect(JSON.parse(runtime.get('cellproject-graph')!).state).toEqual(localTwo);
  const projects = JSON.parse(runtime.get('cellproject-workspace')!).state.projects;
  expect(projects['managed-0'].planner).toEqual(remoteOne); expect(projects['managed-1'].planner).toEqual(localTwo);
});

it.each(['unmanaged', 'unsubmitted draft', 'different canonical content'])('keeps differing plan checkpoints conflicted when coverage is unsafe: %s', async reason => {
  const originalOne = managedPlanner('one', 'One'), originalTwo = managedPlanner('two', 'Two');
  const remoteOne = managedPlanner('one', 'PC edit'), localTwo = managedPlanner('two', 'Tablet edit');
  const localGraph = structuredClone(localTwo);
  if (reason === 'unsubmitted draft') localGraph.objectiveDraft.objective = 'Only in graph';
  const remoteGraph = structuredClone(remoteOne);
  if (reason === 'different canonical content') remoteGraph.project.name = 'Not the canonical planner';
  const graph = (state: unknown) => JSON.stringify({ version: 6, state });
  const baseWorkspace = reason === 'unmanaged' ? concurrencyEnvelope() : managedWorkspace(originalOne, originalTwo);
  const remoteWorkspace = reason === 'unmanaged' ? concurrencyEnvelope() : managedWorkspace(remoteOne, localTwo);
  const fetcher = vi.fn<typeof fetch>(async () => documentRevisionConflict());
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-graph', value: graph(originalOne), revision: 1 }, { key: 'cellproject-workspace', value: baseWorkspace, revision: 1 }], media: [] }, fetcher, undefined, async () => ({ documents: [{ key: 'cellproject-graph', value: graph(remoteGraph), revision: 2 }, { key: 'cellproject-workspace', value: remoteWorkspace, revision: 2 }], media: [] }));
  await runtime.write('cellproject-graph', graph(localGraph));
  expect(fetcher).toHaveBeenCalledOnce(); expect(runtime.getSnapshot().issue?.kind).toBe('conflict');
  expect(runtime.get('cellproject-graph')).toBe(graph(localGraph));
});

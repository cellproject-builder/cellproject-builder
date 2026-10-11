import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { CloudRuntime, encodeBytes, sha256 } from '../runtime';
import { createVault, sessionFromDeviceKey } from './crypto';
import { activateVault, prepareVaultActivation, VaultTransport } from './transport';
import { OfflineRepository } from '../offline/repository';
beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const snapshot = { documents: [{ key: 'dynamic_diary-chat', value: '{"version":1,"state":{"private":"private chat"}}', revision: 1 }], media: [] };
function receiverSensitiveFetch(remote: typeof fetch): typeof fetch {
  // Browser fetch permits a detached call, but rejects an arbitrary object as this.
  return function (this: unknown, input, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return remote(input, init);
  } as typeof fetch;
}
async function fixture(wrap: (remote: typeof fetch) => typeof fetch = remote => remote, options = {}) {
  const vault = await createVault('owner', 'test-only exclusive secret phrase');
  let revision = 1, lose = false, loseBlob = false; const bodies: string[] = [], blobs = new Map<string, string>(), replies = new Map<string, number>();
  let head = { header: vault.header, revision, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (String(path) === '/api/cloud/config') return Response.json({ enabled: true, authenticated: true, user: { id: 'owner', email: 'synthetic@example.test' }, providers: {} });
    if (String(path).includes('/blobs/')) return new Response(blobs.get(String(path).split('/').at(-1)!)!);
    if (String(path).endsWith('/blobs')) { const data = JSON.parse(String(init!.body)); blobs.set(data.id, atob(data.base64)); if (loseBlob) { loseBlob = false; throw new Error('upload response lost'); } return Response.json({ id: data.id, sha256: data.sha256, size: atob(data.base64).length }); }
    if (init?.method === 'PUT') {
      bodies.push(String(init.body)); const body = JSON.parse(String(init.body));
      if (!replies.has(body.operationId)) { if (body.baseRevision !== revision) return Response.json({}, { status: 409 }); revision++; head = { ...head, revision, manifest: body.manifest }; replies.set(body.operationId, revision); }
      if (lose) { lose = false; throw new Error('response lost'); } return Response.json({ revision: replies.get(body.operationId) });
    }
    return Response.json(head);
  });
  const transport = await VaultTransport.open(vault.session, head, wrap(fetcher), options);
  return { vault, transport, fetcher, bodies, loseNext: () => { lose = true; }, loseUpload: () => { loseBlob = true; } };
}
it.each(['/api/cloud/config', '/api/cloud/vault', '/api/live/ink'])('forwards %s without using the transport as the native fetch receiver', async path => {
  const f = await fixture(receiverSensitiveFetch), controller = new AbortController();
  const response = await f.transport.fetch(path, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
  expect(response.ok).toBe(true);
  expect(f.fetcher.mock.calls.at(-1)).toEqual([path, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }]);
  f.transport.dispose();
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
it('restores an ambiguous encrypted commit and replays identical bytes after account verification', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const value = '{"version":1,"state":{"private":"durable lost response"}}';
  const runtime = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence });
  f.loseNext(); await runtime.write('dynamic_diary-chat', value);
  const savedTransport = await persistence.read('transport'), savedRuntime = await persistence.read('runtime');
  const key = f.vault.session.deviceKeyForStorage(); f.transport.dispose(); runtime.dispose();
  let verified = false;
  const transport = await VaultTransport.restore(sessionFromDeviceKey('owner', f.vault.header, key), savedTransport, f.fetcher, { persistence, networkReady: () => verified });
  const restored = new CloudRuntime(transport.snapshot(), transport.fetch, undefined, undefined, { persistence, checkpoint: savedRuntime, networkReady: () => verified, acknowledgeOperation: id => transport.acknowledgeOperation(id) });
  await transport.reconcileOperations(restored.checkpoint().queue.map(op => op.operationId));
  await restored.retry(); expect(f.bodies).toHaveLength(1);
  verified = true; await restored.retry();
  expect(f.bodies).toHaveLength(2); expect(f.bodies[1]).toBe(f.bodies[0]); expect(restored.get('dynamic_diary-chat')).toBe(value); expect(restored.getSnapshot().pending).toBe(0);
});
it('replays a durable receipt when the tab closes between transport ACK and runtime checkpoint', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const value = '{"version":1,"state":{"private":"ACK crash window"}}';
  persistence.write.mockImplementation(async (slot, next: any) => { if (slot === 'runtime' && next.queue.length === 0) throw new Error('tab closed before runtime ACK'); persistence.data.set(slot, structuredClone(next)); });
  const runtime = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence });
  await runtime.write('dynamic_diary-chat', value);
  const savedTransport = await persistence.read('transport'), savedRuntime = await persistence.read('runtime');
  persistence.write.mockImplementation(async (slot, next) => { persistence.data.set(slot, structuredClone(next)); });
  const key = f.vault.session.deviceKeyForStorage(); f.transport.dispose(); runtime.dispose();
  const transport = await VaultTransport.restore(sessionFromDeviceKey('owner', f.vault.header, key), savedTransport, f.fetcher, { persistence });
  const restored = new CloudRuntime(transport.snapshot(), transport.fetch, undefined, undefined, { persistence, checkpoint: savedRuntime, acknowledgeOperation: id => transport.acknowledgeOperation(id) });
  await restored.retry(); expect(f.bodies).toHaveLength(1); expect(restored.getSnapshot().pending).toBe(0); expect(restored.documents()[0].revision).toBe(2);
});
it('never sends prepared ciphertext whose local journal failed', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  persistence.write.mockRejectedValue(new Error('quota exhausted'));
  const body = JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'durable-quota' });
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body })).rejects.toThrow('quota');
  expect(f.bodies).toHaveLength(0);
});
it('does not deliver an ACK receipt until its transport checkpoint succeeds', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  let failAck = true;
  persistence.write.mockImplementation(async (slot, value: any) => { if (slot === 'transport' && value.head.revision === 2 && failAck) throw new Error('ACK quota'); persistence.data.set(slot, structuredClone(value)); });
  const body = JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'ACK-quota' });
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body })).rejects.toThrow('ACK quota');
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body })).rejects.toThrow('ACK quota');
  expect(f.bodies).toHaveLength(1);
  failAck = false;
  expect((await f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body })).ok).toBe(true);
  expect((await persistence.read<any>('transport')).head.revision).toBe(2);
});
it('reconciles an orphan receipt after runtime ACK was saved but transport cleanup failed', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  persistence.write.mockImplementation(async (slot, value: any) => { if (slot === 'transport' && value.head.revision === 2 && value.completed.length === 0) throw new Error('cleanup quota'); persistence.data.set(slot, structuredClone(value)); });
  const runtime = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence, acknowledgeOperation: id => f.transport.acknowledgeOperation(id) });
  await runtime.write('dynamic_diary-theme', 'dark');
  const savedRuntime = await persistence.read<any>('runtime'), savedTransport = await persistence.read('transport');
  expect(savedRuntime.queue).toHaveLength(0);
  const transport = await VaultTransport.restore(f.vault.session, savedTransport, f.fetcher, { persistence });
  expect(transport.hasPendingOperations()).toBe(true);
  await expect(transport.reconcileOperations([])).rejects.toThrow('cleanup quota');
  expect(transport.checkpoint().completed).toHaveLength(1);
  persistence.write.mockImplementation(async (slot, value) => { persistence.data.set(slot, structuredClone(value)); });
  await transport.reconcileOperations([]);
  expect(transport.hasPendingOperations()).toBe(false);
  expect((await persistence.read<any>('transport')).completed).toHaveLength(0);
  expect(f.bodies).toHaveLength(1);
});
it('fails closed for a restored ciphertext with no matching runtime operation', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  f.loseNext();
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'orphan-pending' }) })).rejects.toThrow();
  const saved = await persistence.read('transport'), transport = await VaultTransport.restore(f.vault.session, saved, f.fetcher, { persistence });
  await expect(transport.reconcileOperations([])).rejects.toThrow(/pendente|recuper/i);
  await expect(transport.fetch('/api/cloud/documents/dynamic_diary-sidebar-collapsed', { method: 'PUT', body: JSON.stringify({ value: 'true', baseRevision: 0, operationId: 'unrelated' }) })).rejects.toThrow(/pendente|recuper/i);
  expect(f.bodies).toHaveLength(1);
  expect(await persistence.read('transport')).toEqual(saved);
});
it('drops acknowledged upload retry bytes and receipts only after a durable runtime save', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const runtime = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence, acknowledgeOperation: id => f.transport.acknowledgeOperation(id) });
  await runtime.writeMedia({ id: 'clean-upload', mime: 'text/plain', name: 'private.txt', bytes: new TextEncoder().encode('private bytes').buffer });
  expect(f.transport.checkpoint()).toMatchObject({ uploads: [], completed: [], requests: [], pending: null });
  expect((await persistence.read<any>('runtime')).confirmed.media).toHaveLength(1);
});
it('recovers a lost media manifest ACK after reload only after account verification', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const writer = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence });
  await writer.persistCheckpoint(); f.loseNext();
  await expect(writer.writeMedia({ id: 'lost-media-ack', mime: 'text/plain', name: 'private.txt', bytes: new TextEncoder().encode('original media').buffer })).rejects.toThrow('response lost');
  const saved = await persistence.read('transport'), runtimeCheckpoint = await persistence.read('runtime');
  let verified = false;
  const transport = await VaultTransport.restore(f.vault.session, saved, f.fetcher, { persistence, networkReady: () => verified });
  await transport.reconcileOperations([]);
  const calls = f.fetcher.mock.calls.length;
  await expect(transport.recoverAuxiliaryOperations()).rejects.toThrow(/conexão|confirmada/);
  await expect(transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'unrelated' }) })).rejects.toThrow();
  expect(f.fetcher.mock.calls).toHaveLength(calls);
  verified = true;
  const ids = await transport.recoverAuxiliaryOperations();
  expect(f.bodies).toHaveLength(2); expect(f.bodies[1]).toBe(f.bodies[0]);
  const runtime = new CloudRuntime(transport.snapshot(), transport.fetch, undefined, undefined, { persistence, checkpoint: runtimeCheckpoint });
  expect(await runtime.adoptRecoveredSnapshot(transport.snapshot())).toBe(true);
  for (const id of ids) await transport.acknowledgeOperation(id);
  expect(runtime.media().map(item => item.id)).toContain('lost-media-ack');
  expect(transport.hasPendingOperations()).toBe(false);
  verified = false;
  expect(new TextDecoder().decode((await runtime.readMedia('lost-media-ack'))!)).toBe('original media');
});
it('recovers an upload interrupted before manifest preparation with the same blob and cipher bytes', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const writer = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence });
  await writer.persistCheckpoint(); f.loseUpload();
  await expect(writer.writeMedia({ id: 'lost-blob', mime: 'text/plain', name: 'private.txt', bytes: new TextEncoder().encode('original blob').buffer })).rejects.toThrow('upload response lost');
  expect(f.bodies).toHaveLength(0);
  const transport = await VaultTransport.restore(f.vault.session, await persistence.read('transport'), f.fetcher, { persistence });
  await transport.reconcileOperations([]);
  await transport.recoverAuxiliaryOperations();
  const uploads = f.fetcher.mock.calls.filter(call => String(call[0]).endsWith('/blobs'));
  expect(uploads).toHaveLength(2); expect(uploads[1][1]!.body).toBe(uploads[0][1]!.body);
  expect(transport.snapshot().media.map(item => item.id)).toContain('lost-blob');
  expect(f.bodies).toHaveLength(1);
});
it('recovers an interrupted import and preserves queued document drafts until durable adoption', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const body = JSON.stringify({ documents: [{ key: 'dynamic_diary-theme', value: 'dark' }], operationId: 'lost-import' });
  f.loseNext(); await expect(f.transport.fetch('/api/cloud/import', { method: 'POST', body })).rejects.toThrow('response lost');
  const transport = await VaultTransport.restore(f.vault.session, await persistence.read('transport'), f.fetcher, { persistence });
  const runtime = new CloudRuntime(snapshot, transport.fetch, undefined, undefined, { persistence, networkReady: () => false });
  const draft = '{"version":1,"state":{"private":"offline draft during import recovery"}}';
  await runtime.write('dynamic_diary-chat', draft);
  await transport.reconcileOperations(runtime.checkpoint().queue.map(op => op.operationId));
  const ids = await transport.recoverAuxiliaryOperations();
  const apply = vi.fn();
  expect(await runtime.adoptRecoveredSnapshot(transport.snapshot(), { isIdle: () => false, apply })).toBe(false);
  expect(runtime.get('dynamic_diary-theme')).toBeNull(); expect(apply).not.toHaveBeenCalled();
  expect(await runtime.adoptRecoveredSnapshot(transport.snapshot(), { isIdle: () => true, apply })).toBe(true);
  expect(apply).toHaveBeenCalledWith([{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }]);
  expect(runtime.get('dynamic_diary-chat')).toBe(draft); expect(runtime.getSnapshot().pending).toBe(1);
  for (const id of ids) await transport.acknowledgeOperation(id);
  expect(f.bodies[1]).toBe(f.bodies[0]); expect(f.bodies).toHaveLength(2);
  expect((await persistence.read<any>('runtime')).confirmed.documents.some((doc: any) => doc.key === 'dynamic_diary-theme')).toBe(true);
});
it('recovers media metadata after transport ACK but before its runtime checkpoint without another PUT', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const writer = new CloudRuntime(snapshot, f.transport.fetch, undefined, undefined, { persistence });
  await writer.persistCheckpoint();
  persistence.write.mockImplementation(async (slot, value: any) => { if (slot === 'runtime' && value.confirmed.media.length) throw new Error('media runtime quota'); persistence.data.set(slot, structuredClone(value)); });
  await expect(writer.writeMedia({ id: 'ACK-media', mime: 'text/plain', name: 'private.txt', bytes: new TextEncoder().encode('ACK metadata').buffer })).rejects.toThrow('media runtime quota');
  const savedTransport = await persistence.read('transport'), savedRuntime = await persistence.read('runtime');
  persistence.write.mockImplementation(async (slot, value) => { persistence.data.set(slot, structuredClone(value)); });
  const transport = await VaultTransport.restore(f.vault.session, savedTransport, f.fetcher, { persistence });
  await transport.reconcileOperations([]);
  const ids = await transport.recoverAuxiliaryOperations();
  const runtime = new CloudRuntime(transport.snapshot(), transport.fetch, undefined, undefined, { persistence, checkpoint: savedRuntime });
  await runtime.adoptRecoveredSnapshot(transport.snapshot());
  for (const id of ids) await transport.acknowledgeOperation(id);
  expect(f.bodies).toHaveLength(1); expect(runtime.media().map(item => item.id)).toContain('ACK-media');
  expect(transport.hasPendingOperations()).toBe(false);
});
it('rejects a changed auxiliary body, fingerprint or unsupported route before any recovery request', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  f.loseNext(); await expect(f.transport.fetch('/api/cloud/import', { method: 'POST', body: JSON.stringify({ documents: [{ key: 'dynamic_diary-theme', value: 'dark' }], operationId: 'descriptor-check' }) })).rejects.toThrow();
  const saved = await persistence.read<any>('transport'), calls = f.fetcher.mock.calls.length;
  const changedBody = structuredClone(saved); changedBody.auxiliary[0][1].body = changedBody.auxiliary[0][1].body.replace('dark', 'light');
  await expect(VaultTransport.restore(f.vault.session, changedBody, f.fetcher, { persistence })).rejects.toThrow(/recuperação/);
  const changedRoute = structuredClone(saved), descriptor = changedRoute.auxiliary[0][1]; descriptor.path = '/api/cloud/config';
  descriptor.fingerprint = await sha256(new TextEncoder().encode(JSON.stringify([descriptor.method, descriptor.path, descriptor.body])).buffer);
  changedRoute.requests[0][1] = descriptor.fingerprint;
  await expect(VaultTransport.restore(f.vault.session, changedRoute, f.fetcher, { persistence })).rejects.toThrow(/recuperação/);
  expect(f.fetcher.mock.calls).toHaveLength(calls);
});
it('reads previously viewed encrypted media after reload offline and refuses offline uploads', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const bytes = new TextEncoder().encode('cached private media').buffer;
  const writer = new CloudRuntime(snapshot, f.transport.fetch);
  await writer.writeMedia({ id: 'offline-media', mime: 'text/plain', name: 'private.txt', bytes });
  const first = await f.transport.fetch('/api/cloud/media/offline-media'); expect(await first.text()).toBe('cached private media');
  const saved = await persistence.read('transport'), key = f.vault.session.deviceKeyForStorage(); f.transport.dispose();
  const transport = await VaultTransport.restore(sessionFromDeviceKey('owner', f.vault.header, key), saved, f.fetcher, { persistence, networkReady: () => false });
  const calls = f.fetcher.mock.calls.length;
  expect(await (await transport.fetch('/api/cloud/media/offline-media')).text()).toBe('cached private media');
  await expect(transport.fetch('/api/cloud/media', { method: 'POST', body: '{}' })).rejects.toThrow(/conexão|conect/i);
  expect(f.fetcher.mock.calls).toHaveLength(calls);
});
it('preserves abort propagation for a receiver-sensitive passthrough request', async () => {
  const f = await fixture(receiverSensitiveFetch), controller = new AbortController();
  f.fetcher.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  }));
  const pending = f.transport.fetch('/api/cloud/config', { signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  f.transport.dispose();
});
it('resumes the same CloudRuntime with a real vault transport and saves its preserved draft', async () => {
  const f = await fixture(receiverSensitiveFetch), runtime = new CloudRuntime(snapshot, f.transport.fetch);
  const value = '{"version":1,"state":{"private":"preserved old-tab draft"}}';
  runtime.notifySessionExpired('/api/cloud/config'); await runtime.write('dynamic_diary-chat', value);
  expect(runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'session' } });
  await runtime.resumeAfterAuthentication('owner');
  expect(runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  expect(runtime.get('dynamic_diary-chat')).toBe(value);
  expect(f.transport.snapshot().documents.find(doc => doc.key === 'dynamic_diary-chat')).toMatchObject({ value, revision: 2 });
  expect(f.bodies.join()).not.toContain('preserved old-tab draft');
  runtime.dispose(); f.transport.dispose();
});
it('verifies encrypted upload readback with a receiver-sensitive native fetch', async () => {
  const f = await fixture(receiverSensitiveFetch), runtime = new CloudRuntime(snapshot, f.transport.fetch);
  const bytes = new TextEncoder().encode('synthetic encrypted media').buffer;
  await runtime.writeMedia({ id: 'native-readback', mime: 'text/plain', name: 'synthetic.txt', bytes });
  expect(f.transport.snapshot().media.find(media => media.id === 'native-readback')?.size).toBe(bytes.byteLength);
  expect(await runtime.readMedia('native-readback')).toEqual(bytes);
  runtime.dispose(); f.transport.dispose();
});
it('reads and decrypts saved media with a receiver-sensitive native fetch on a fresh runtime', async () => {
  const f = await fixture(), writer = new CloudRuntime(snapshot, f.transport.fetch);
  const bytes = new TextEncoder().encode('synthetic fresh-reader media').buffer;
  await writer.writeMedia({ id: 'native-media-get', mime: 'text/plain', name: 'synthetic.txt', bytes });
  const head = await (await f.fetcher('/api/cloud/vault')).json();
  const transport = await VaultTransport.open(f.vault.session, head, receiverSensitiveFetch(f.fetcher));
  const reader = new CloudRuntime(transport.snapshot(), transport.fetch);
  expect(await reader.readMedia('native-media-get')).toEqual(bytes);
  writer.dispose(); reader.dispose(); transport.dispose(); f.transport.dispose();
});
it('sends only ciphertext for documents and keeps exact retry bytes after an ambiguous commit', async () => {
  const f = await fixture(), runtime = new CloudRuntime(snapshot, f.transport.fetch);
  f.loseNext(); await runtime.write('dynamic_diary-chat', '{"version":1,"state":{"private":"latest secret"}}');
  expect(runtime.getSnapshot().issue?.kind).toBe('network'); await runtime.retry();
  expect(runtime.getSnapshot().pending).toBe(0); expect(f.bodies).toHaveLength(2); expect(f.bodies[0]).toBe(f.bodies[1]); expect(f.bodies.join()).not.toContain('latest secret');
});
it('retains the same encrypted blob and opaque UUID when the upload response is lost', async () => {
  const f = await fixture(), runtime = new CloudRuntime(snapshot, f.transport.fetch), bytes = new TextEncoder().encode('private file').buffer;
  const record = { id: 'file', mime: 'text/plain', name: 'secret.txt', bytes };
  f.loseUpload(); await expect(runtime.writeMedia(record)).rejects.toThrow('upload response lost');
  await runtime.writeMedia(record);
  const uploads = f.fetcher.mock.calls.filter(call => String(call[0]).endsWith('/blobs'));
  expect(uploads).toHaveLength(2); expect(uploads[0][1]!.body).toBe(uploads[1][1]!.body);
  expect(await runtime.readMedia('file')).toEqual(bytes);
});
it('keeps activation operation ID and ciphertext unchanged after an ambiguous activation', async () => {
  const vault = await createVault('owner', 'synthetic activation-only phrase'); const bodies: string[] = []; let head: unknown;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    if (init?.method === 'POST') { bodies.push(String(init.body)); const body = JSON.parse(String(init.body)); head = { header: body.header, manifest: body.manifest, revision: 1 }; if (bodies.length === 1) throw new Error('activation response lost'); return Response.json({ revision: 1 }); }
    return Response.json(head);
  });
  await expect(activateVault(vault.session, snapshot, fetcher)).rejects.toThrow('activation response lost');
  const activated = await activateVault(vault.session, snapshot, fetcher);
  expect(activated.revision).toBe(1); expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
});
it('encrypts file bytes, names, MIME and project metadata and serializes concurrent updates', async () => {
  const f = await fixture(), runtime = new CloudRuntime(snapshot, f.transport.fetch);
  const bytes = new TextEncoder().encode('private programming file').buffer;
  await Promise.all([runtime.writeMedia({ id: 'private-id', name: 'robot-private.ts', projectId: 'private-project', mime: 'text/plain', bytes }), runtime.write('dynamic_diary-theme', 'dark')]);
  expect(await runtime.readMedia('private-id')).toEqual(bytes);
  const requests = f.fetcher.mock.calls.map(call => String(call[1]?.body ?? '')).join('');
  for (const value of ['robot-private.ts', 'private-project', 'private-id', 'private programming file', 'text/plain']) expect(requests).not.toContain(value);
  expect(f.transport.snapshot().media).toHaveLength(1); expect(f.transport.snapshot().documents.find(d => d.key === 'dynamic_diary-theme')?.value).toBe('dark');
});
it('settles an ambiguous media commit before another mutation, and fails closed after lock', async () => {
  const f = await fixture(), bytes = new TextEncoder().encode('secret').buffer;
  const record = { id: 'file', mime: 'text/plain', name: 'private.txt', sha256: await sha256(bytes), base64: encodeBytes(bytes), operationId: 'media-operation' };
  f.loseNext(); await expect(f.transport.fetch('/api/cloud/media', { method: 'POST', body: JSON.stringify(record) })).rejects.toThrow('response lost');
  await f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'doc-operation' }) });
  expect(f.bodies[0]).toBe(f.bodies[1]); expect(f.transport.snapshot().media).toHaveLength(1);
  f.transport.dispose(); await expect(f.transport.fetch('/api/cloud/snapshot')).rejects.toThrow('bloqueado');
});

type ReceiptMemory = { requests: Map<string, string>; completed: Map<string, { response: string | null; bytes: number; pinned: boolean }> };
const memory = (transport: VaultTransport) => transport as unknown as ReceiptMemory;
it('keeps fingerprints rather than full autosaves and bounds confirmed response count and bytes', async () => {
  const f = await fixture();
  for (let index = 0; index < 140; index++) {
    await f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: JSON.stringify({ value: `private-autosave-${index}`, baseRevision: index, operationId: `autosave-${index}` }) });
  }
  const retained = memory(f.transport), responses = [...retained.completed.values()].filter(receipt => receipt.response !== null);
  expect([...retained.requests.values()].every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true);
  expect(JSON.stringify([...retained.requests])).not.toContain('private-autosave');
  expect(responses.length).toBeLessThanOrEqual(128);
  expect(responses.reduce((sum, receipt) => sum + receipt.bytes, 0)).toBeLessThanOrEqual(512 * 1024);
  expect(retained.completed.get('autosave-0')?.response).toBeNull();
}, 15000);
it('preserves an ambiguous large import receipt until its own retry consumes it', async () => {
  const f = await fixture(), body = JSON.stringify({ documents: [{ key: 'dynamic_diary-sidebar-collapsed', value: 'private'.repeat(80000) }], operationId: 'large-ambiguous-import' });
  f.loseNext(); await expect(f.transport.fetch('/api/cloud/import', { method: 'POST', body })).rejects.toThrow('response lost');
  for (let index = 0; index < 3; index++) await f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: JSON.stringify({ value: String(index), baseRevision: index, operationId: `after-ambiguous-${index}` }) });
  expect(f.bodies[0]).toBe(f.bodies[1]);
  const writes = f.bodies.length;
  const reply = await (await f.transport.fetch('/api/cloud/import', { method: 'POST', body })).json();
  expect(reply.documents[0].value).toBe('private'.repeat(80000)); expect(f.bodies).toHaveLength(writes);
  expect(memory(f.transport).completed.get('large-ambiguous-import')?.response).toBeNull();
  await expect(f.transport.fetch('/api/cloud/import', { method: 'POST', body })).rejects.toThrow('conflito');
  expect(f.bodies).toHaveLength(writes);
}, 15000);
it('rejects an expired oversized import replay before another encryption or commit', async () => {
  const f = await fixture(), body = JSON.stringify({ documents: [{ key: 'dynamic_diary-sidebar-collapsed', value: 'private'.repeat(80000) }], operationId: 'expired-import' });
  await f.transport.fetch('/api/cloud/import', { method: 'POST', body });
  const writes = f.bodies.length, seal = vi.spyOn(f.vault.session, 'seal');
  await expect(f.transport.fetch('/api/cloud/import', { method: 'POST', body })).rejects.toThrow('conflito');
  expect(f.bodies).toHaveLength(writes); expect(seal).not.toHaveBeenCalled();
});

it('refreshes the encrypted head before subsequent writes and never serves the cached manifest as a remote refresh', async () => {
  const f = await fixture();
  const next = { documents: [{ ...snapshot.documents[0], value: '{"version":1,"state":{"private":"tablet ink"}}', revision: 2 }], media: [] };
  const manifest = await f.vault.session.seal(JSON.stringify({ snapshot: next, files: {} }), 'manifest:2');
  f.fetcher.mockResolvedValueOnce(Response.json({ header: f.vault.header, revision: 2, manifest }));
  expect(await f.transport.refreshSnapshot()).toEqual(next);
  expect(f.fetcher.mock.calls.at(-1)?.[0]).toBe('/api/cloud/vault');
  expect(f.transport.snapshot()).toEqual(next);
  // Re-opening an older head cannot roll back the manifest or its optimistic revision.
  f.fetcher.mockResolvedValueOnce(Response.json({ header: f.vault.header, revision: 1, manifest }));
  await expect(f.transport.refreshSnapshot()).rejects.toThrow('Revisão'); expect(f.transport.snapshot()).toEqual(next);
});

it('refuses refresh during an ambiguous commit and validates ciphertext before replacing the private snapshot', async () => {
  const f = await fixture(); f.loseNext();
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'pending-before-refresh' }) })).rejects.toThrow();
  const requests = f.fetcher.mock.calls.length;
  await expect(f.transport.refreshSnapshot()).rejects.toThrow('pendente'); expect(f.fetcher).toHaveBeenCalledTimes(requests);
  expect(f.transport.snapshot()).toEqual(snapshot);
  const clean = await fixture(); clean.fetcher.mockResolvedValueOnce(Response.json({ header: clean.vault.header, revision: 2, manifest: { version: 1, iv: 'invalid', ciphertext: 'invalid' } }));
  await expect(clean.transport.refreshSnapshot()).rejects.toThrow(); expect(clean.transport.snapshot()).toEqual(snapshot);
});

it('does not decrypt and parse an unchanged canonical manifest on every polling tick', async () => {
  const f = await fixture(), open = vi.spyOn(f.vault.session, 'openText');
  expect(await f.transport.refreshSnapshot()).toEqual(snapshot); expect(open).not.toHaveBeenCalled();
  expect(await f.transport.refreshSnapshot()).toEqual(snapshot); expect(open).not.toHaveBeenCalled();
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it('does no large base64 work or encrypted checkpoint writes when polling an unchanged durable 1 MiB snapshot', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic idle polling phrase');
  const initial = { documents: [{ ...snapshot.documents[0], value: JSON.stringify({ version: 1, state: { text: 'x'.repeat(1024 * 1024) } }) }], media: [] };
  const head = { header: vault.header, revision: 1, manifest: await vault.session.seal(JSON.stringify({ snapshot: initial, files: {} }), 'manifest:1') };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(head)), persistence = new OfflineRepository(vault.session);
  const transport = await VaultTransport.open(vault.session, head, fetcher, { persistence });
  const runtime = new CloudRuntime(transport.snapshot(), transport.fetch, undefined, () => transport.refreshSnapshot(), { persistence });
  await runtime.persistCheckpoint();
  const write = vi.spyOn(persistence, 'write'), decode = vi.spyOn(globalThis, 'atob'), encode = vi.spyOn(globalThis, 'btoa');
  try {
    expect(await runtime.refreshRemote()).toEqual([]);
    expect(await runtime.refreshRemote()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect({ checkpointWrites: write.mock.calls.length, largeDecodes: decode.mock.calls.filter(([value]) => value.length > 1024).length, largeEncodes: encode.mock.calls.filter(([value]) => value.length > 1024).length }).toEqual({ checkpointWrites: 0, largeDecodes: 0, largeEncodes: 0 });
    const copy = transport.snapshot(); copy.documents[0].value = 'caller edit'; copy.documents.push({ key: 'dynamic_diary-theme', revision: 1, value: 'light' });
    expect(transport.snapshot()).toEqual(initial);
  } finally { write.mockRestore(); decode.mockRestore(); encode.mockRestore(); runtime.dispose(); transport.dispose(); vault.session.dispose(); }
}, 15000);
it.each(['extra key', 'version', 'IV', 'data', 'missing key', 'type'])('still rejects a changed or malformed same-revision envelope: %s', async change => {
  const f = await fixture(), head = f.transport.head();
  const manifest: Record<string, unknown> = { ...head.manifest };
  if (change === 'extra key') manifest.extra = true;
  if (change === 'version') manifest.v = 2;
  if (change === 'IV') manifest.iv = encodeBytes(new Uint8Array(12).buffer);
  if (change === 'data') manifest.data = encodeBytes(new Uint8Array(32).buffer);
  if (change === 'missing key') delete manifest.data;
  if (change === 'type') manifest.data = 123;
  f.fetcher.mockResolvedValueOnce(Response.json({ ...head, manifest }));
  await expect(f.transport.refreshSnapshot()).rejects.toThrow(); expect(f.transport.snapshot()).toEqual(snapshot);
});
it.each(['invalid', 'valid'])('does not trust a %s ciphertext mutation through the original caller head', async kind => {
  const f = await fixture(), head = f.transport.head(), transport = await VaultTransport.open(f.vault.session, head, f.fetcher);
  head.manifest.data = kind === 'invalid' ? 'invalid' : encodeBytes(new Uint8Array(32).buffer);
  f.fetcher.mockResolvedValueOnce(Response.json(head));
  await expect(transport.refreshSnapshot()).rejects.toThrow(); expect(transport.snapshot()).toEqual(snapshot);
});
it('captures the authenticated ciphertext and revision before an asynchronous open can yield to the caller', async () => {
  const f = await fixture(), head = f.transport.head(), open = f.vault.session.openText.bind(f.vault.session);
  let finish!: () => void;
  const delayed = vi.spyOn(f.vault.session, 'openText').mockImplementationOnce(async (...args) => {
    const text = await open(...args); await new Promise<void>(resolve => { finish = resolve; }); return text;
  });
  const opening = VaultTransport.open(f.vault.session, head, f.fetcher);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  head.manifest.data = 'invalid'; head.revision = 2; finish();
  const transport = await opening; delayed.mockRestore();
  expect(transport.head().revision).toBe(1);
  f.fetcher.mockResolvedValueOnce(Response.json({ ...head, revision: 1 }));
  await expect(transport.refreshSnapshot()).rejects.toThrow(); expect(transport.snapshot()).toEqual(snapshot);
});
it('retries a failed checkpoint for an authenticated newer head before considering it durable and checks every remote session', async () => {
  const persistence = checkpointStore(), f = await fixture(remote => remote, { persistence });
  const next = { documents: [{ ...snapshot.documents[0], revision: 2, value: '{"version":1,"state":{"private":"newer"}}' }], media: [] };
  const head = { header: f.vault.header, revision: 2, manifest: await f.vault.session.seal(JSON.stringify({ snapshot: next, files: {} }), 'manifest:2') };
  persistence.write.mockClear(); persistence.write.mockRejectedValueOnce(new Error('checkpoint quota'));
  f.fetcher.mockImplementation(async () => Response.json(head));
  await expect(f.transport.refreshSnapshot()).rejects.toThrow('checkpoint quota');
  expect(persistence.write).toHaveBeenCalledOnce();
  expect(await f.transport.refreshSnapshot()).toEqual(next); expect(persistence.write).toHaveBeenCalledTimes(2);
  await f.transport.refreshSnapshot(); expect(persistence.write).toHaveBeenCalledTimes(2);
  f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
  await expect(f.transport.refreshSnapshot()).rejects.toMatchObject({ status: 401 }); expect(f.transport.snapshot()).toEqual(next);
});
it('binds an operation fingerprint to method, route and body', async () => {
  const f = await fixture(), body = JSON.stringify({ value: 'dark', baseRevision: 0, operationId: 'bound-operation' });
  await f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body });
  expect(await (await f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body })).json()).toEqual({ revision: 1 });
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-sidebar-collapsed', { method: 'PUT', body })).rejects.toThrow('conflito');
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'DELETE', body })).rejects.toThrow('conflito');
  await expect(f.transport.fetch('/api/cloud/documents/dynamic_diary-theme', { method: 'PUT', body: body.replace('dark', 'light') })).rejects.toThrow('conflito');
  expect(f.bodies).toHaveLength(1);
  f.transport.dispose(); expect(memory(f.transport).requests.size).toBe(0); expect(memory(f.transport).completed.size).toBe(0);
});
it('refuses a restored activation with a changed head or changed snapshot before posting', async () => {
  const f = await fixture(), prepared = await prepareVaultActivation(f.vault.session, snapshot);
  const restored = sessionFromDeviceKey('owner', f.vault.header, f.vault.session.deviceKeyForStorage()), remote = vi.fn<typeof fetch>();
  await expect(activateVault(restored, snapshot, remote, { ...prepared, head: { ...prepared.head, header: { ...prepared.head.header, id: crypto.randomUUID() } } })).rejects.toThrow();
  await expect(activateVault(restored, { ...snapshot, documents: [{ ...snapshot.documents[0], revision: 2 }] }, remote, prepared)).rejects.toThrow('mudou');
  expect(remote).not.toHaveBeenCalled(); restored.dispose(); f.vault.session.dispose();
});
it('never posts a cached activation after the session is locked', async () => {
  const f = await fixture(), remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ revision: 1 }));
  await prepareVaultActivation(f.vault.session, snapshot);
  f.vault.session.dispose();
  await expect(activateVault(f.vault.session, snapshot, remote)).rejects.toThrow('bloqueado');
  expect(remote).not.toHaveBeenCalled();
});

import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { CloudRuntime, encodeBytes, sha256 } from '../runtime';
import { createVault, sessionFromDeviceKey } from './crypto';
import { activateVault, prepareVaultActivation, VaultTransport } from './transport';
beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const snapshot = { documents: [{ key: 'dynamic_diary-chat', value: '{"version":1,"state":{"private":"private chat"}}', revision: 1 }], media: [] };
async function fixture() {
  const vault = await createVault('owner', 'test-only exclusive secret phrase');
  let revision = 1, lose = false, loseBlob = false; const bodies: string[] = [], blobs = new Map<string, string>(), replies = new Map<string, number>();
  let head = { header: vault.header, revision, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (String(path).includes('/blobs/')) return new Response(blobs.get(String(path).split('/').at(-1)!)!);
    if (String(path).endsWith('/blobs')) { const data = JSON.parse(String(init!.body)); blobs.set(data.id, atob(data.base64)); if (loseBlob) { loseBlob = false; throw new Error('upload response lost'); } return Response.json({ id: data.id, sha256: data.sha256, size: atob(data.base64).length }); }
    if (init?.method === 'PUT') {
      bodies.push(String(init.body)); const body = JSON.parse(String(init.body));
      if (!replies.has(body.operationId)) { if (body.baseRevision !== revision) return Response.json({}, { status: 409 }); revision++; head = { ...head, revision, manifest: body.manifest }; replies.set(body.operationId, revision); }
      if (lose) { lose = false; throw new Error('response lost'); } return Response.json({ revision: replies.get(body.operationId) });
    }
    return Response.json(head);
  });
  const transport = await VaultTransport.open(vault.session, head, fetcher);
  return { vault, transport, fetcher, bodies, loseNext: () => { lose = true; }, loseUpload: () => { loseBlob = true; } };
}
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

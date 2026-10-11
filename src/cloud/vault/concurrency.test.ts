import { webcrypto } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { CloudRuntime, encodeBytes, sha256, type CloudSnapshot } from '../runtime';
import { createVault, sessionFromDeviceKey } from './crypto';
import { VaultTransport, type VaultHead } from './transport';
import { createBoardDocument } from '@/boards/model';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const envelope = (state: unknown) => JSON.stringify({ version: 2, state });
const board = (title: string) => ({ id: 'b', title, archived: false, createdAt: 1, updatedAt: 2, document: createBoardDocument() });
const initial: CloudSnapshot = { documents: [{ key: 'cellproject-workspace', value: envelope({ notes: {}, boards: {} }), revision: 1 }], media: [] };
function journal() {
  const data = new Map<string, unknown>();
  return { data, read: async <T,>(key: string) => structuredClone(data.get(key) ?? null) as T | null, write: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }), remove: async (key: string) => { data.delete(key); } };
}
async function clients(snapshot: CloudSnapshot = initial) {
  const vault = await createVault('synthetic-owner', 'synthetic test password');
  const key = vault.session.deviceKeyForStorage();
  let head: VaultHead = { header: vault.header, revision: 1, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const requests: string[] = [], receipts = new Map<string, { body: string; revision: number }>();
  const blobs = new Map<string, ArrayBuffer>();
  let lose = false, wrongHeader = false;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    const path = String(_path);
    if (path.endsWith('/blobs') && init?.method === 'POST') { const data = JSON.parse(String(init.body)), bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0)).buffer; blobs.set(data.id, bytes); return Response.json({ id: data.id, sha256: data.sha256, size: bytes.byteLength }); }
    if (path.includes('/blobs/')) return new Response(blobs.get(path.split('/').at(-1)!)!);
    if (init?.method !== 'PUT') return Response.json(wrongHeader ? { ...head, header: { ...head.header, id: crypto.randomUUID() } } : head);
    const body = String(init.body), request = JSON.parse(body); requests.push(body);
    const prior = receipts.get(request.operationId);
    if (prior && prior.body !== body) return Response.json({ error: { code: 'vault_operation_conflict', message: 'Operation conflict', requestId: 'synthetic' } }, { status: 409 });
    if (!prior) {
      if (request.baseRevision !== head.revision) return Response.json({ error: { code: 'vault_revision_conflict', message: 'Revision conflict', requestId: 'synthetic' } }, { status: 409 });
      head = { ...head, revision: head.revision + 1, manifest: request.manifest };
      receipts.set(request.operationId, { body, revision: head.revision });
    }
    if (lose) { lose = false; throw new Error('reply lost'); }
    return Response.json({ revision: receipts.get(request.operationId)!.revision });
  });
  const open = (store?: ReturnType<typeof journal>) => VaultTransport.open(sessionFromDeviceKey('synthetic-owner', vault.header, key), head, fetcher, { persistence: store });
  const left = await open(), rightStore = journal(), right = await open(rightStore);
  const put = (transport: VaultTransport, name: string, value: string, baseRevision: number, operationId: string) => transport.fetch(`/api/cloud/documents/${name}`, { method: 'PUT', body: JSON.stringify({ value, baseRevision, operationId }) });
  return { vault, key, left, right, rightStore, fetcher, requests, put, open, head: () => head, loseNext: () => { lose = true; }, wrongHeader: () => { wrongHeader = true; } };
}

it('rebases different document keys across two encrypted clients without replacing remote content', async () => {
  const f = await clients();
  await f.put(f.left, 'cellproject-workspace', envelope({ notes: { n: { id: 'n', title: 'PC note' } }, boards: {} }), 1, 'left-note');
  const result = await f.put(f.right, 'dynamic_diary-theme', 'dark', 0, 'right-theme');
  expect(result.ok).toBe(true);
  const fresh = await f.open();
  expect(fresh.snapshot().documents.find(d => d.key === 'cellproject-workspace')!.value).toContain('PC note');
  expect(fresh.snapshot().documents.find(d => d.key === 'dynamic_diary-theme')!.value).toBe('dark');
  expect(JSON.parse(f.requests[1]).operationId).not.toBe(JSON.parse(f.requests[2]).operationId);
  expect(f.requests.join('')).not.toContain('PC note');
});

it('makes a definitive same-document rejection refreshable for the runtime merge', async () => {
  const f = await clients();
  await f.put(f.left, 'cellproject-workspace', envelope({ notes: { n: { id: 'n', title: 'PC note' } }, boards: {} }), 1, 'left-note');
  await expect(f.put(f.right, 'cellproject-workspace', envelope({ notes: {}, boards: { b: board('Tablet') } }), 1, 'right-board')).rejects.toMatchObject({ status: 409, code: 'revision_conflict' });
  expect(f.right.checkpoint().pending).toBeNull();
  expect((await f.right.refreshSnapshot()).documents[0].value).toContain('PC note');
});

it('replays an ambiguous rebased encrypted commit identically after restore', async () => {
  const f = await clients();
  await f.put(f.left, 'cellproject-workspace', envelope({ notes: { n: { id: 'n' } }, boards: {} }), 1, 'left-note');
  f.loseNext();
  await expect(f.put(f.right, 'dynamic_diary-theme', 'dark', 0, 'right-theme')).rejects.toThrow('reply lost');
  const saved = f.right.checkpoint(), original = f.requests.at(-1);
  expect(saved.pending).not.toBeNull();
  const restored = await VaultTransport.restore(sessionFromDeviceKey('synthetic-owner', f.vault.header, f.key), saved, f.fetcher, { persistence: f.rightStore });
  await restored.reconcileOperations(['right-theme']);
  const response = await f.put(restored, 'dynamic_diary-theme', 'dark', 0, 'right-theme');
  expect(response.ok).toBe(true); expect(f.requests.at(-1)).toBe(original);
  expect(f.head().revision).toBe(3);
});

it('rejects a changed vault identity before resealing a conflicting write', async () => {
  const f = await clients();
  await f.put(f.left, 'cellproject-workspace', envelope({ notes: { n: { id: 'n' } }, boards: {} }), 1, 'left-note');
  f.wrongHeader();
  await expect(f.put(f.right, 'dynamic_diary-theme', 'dark', 0, 'right-theme')).rejects.toThrow();
  expect(f.requests).toHaveLength(2); expect(f.right.checkpoint().pending).not.toBeNull();
});

it('merges independent workspace edits in two runtimes and preserves the following edit from a stale editor', async () => {
  const f = await clients();
  const left = new CloudRuntime(initial, f.left.fetch, undefined, () => f.left.refreshSnapshot());
  const right = new CloudRuntime(initial, f.right.fetch, undefined, () => f.right.refreshSnapshot());
  await left.write('cellproject-workspace', envelope({ notes: { n: { id: 'n', title: 'PC note' } }, boards: {} }));
  await right.write('cellproject-workspace', envelope({ notes: {}, boards: { b: board('Tablet board') } }));
  expect(right.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  await right.write('cellproject-workspace', envelope({ notes: {}, boards: { b: board('Tablet edit 2') } }));
  const fresh = await f.open(), state = JSON.parse(fresh.snapshot().documents[0].value).state;
  expect(state.notes.n.title).toBe('PC note'); expect(state.boards.b.title).toBe('Tablet edit 2');
});

it('keeps both simultaneous strokes on the same board and each device viewport', async () => {
  const value = { notes: {}, boards: { b: board('Shared board') } };
  const start = { documents: [{ key: 'cellproject-workspace', value: envelope(value), revision: 1 }], media: [] };
  const f = await clients(start);
  const left = new CloudRuntime(start, f.left.fetch, undefined, () => f.left.refreshSnapshot());
  const right = new CloudRuntime(start, f.right.fetch, undefined, () => f.right.refreshSnapshot());
  const local = structuredClone(value), remote = structuredClone(value);
  const stroke = (id: string) => ({ id, kind: 'drawing' as const, x: 0, y: 0, width: 10, height: 10, points: [{ x: 1, y: 1, pressure: .7 }], color: '#ffffff', widthStroke: 2 });
  local.boards.b.document.items.push(stroke('left')); local.boards.b.updatedAt = 3; local.boards.b.document.viewport.x = 10;
  remote.boards.b.document.items.push(stroke('right')); remote.boards.b.updatedAt = 4; remote.boards.b.document.viewport.x = 20;
  await left.write('cellproject-workspace', envelope(local)); await right.write('cellproject-workspace', envelope(remote));
  expect(right.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  const fresh = await f.open(), merged = JSON.parse(fresh.snapshot().documents[0].value).state.boards.b;
  expect(merged.document.items.map((item: { id: string }) => item.id).sort()).toEqual(['left', 'right']);
  expect(merged.document.viewport.x).toBe(20); expect(merged.updatedAt).toBe(4);
});

it('keeps the local draft when two devices change the same note text incompatibly', async () => {
  const value = { notes: { n: { id: 'n', title: 'Original' } }, boards: {} };
  const start = { documents: [{ key: 'cellproject-workspace', value: envelope(value), revision: 1 }], media: [] };
  const f = await clients(start);
  const left = new CloudRuntime(start, f.left.fetch, undefined, () => f.left.refreshSnapshot());
  const right = new CloudRuntime(start, f.right.fetch, undefined, () => f.right.refreshSnapshot());
  await left.write('cellproject-workspace', envelope({ ...value, notes: { n: { id: 'n', title: 'PC version' } } }));
  await right.write('cellproject-workspace', envelope({ ...value, notes: { n: { id: 'n', title: 'Tablet version' } } }));
  expect(right.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' } });
  expect(right.get('cellproject-workspace')).toContain('Tablet version');
  expect((await f.open()).snapshot().documents[0].value).toContain('PC version');
});

it('never sends a rebased ciphertext before its new durable checkpoint succeeds', async () => {
  const f = await clients();
  await f.put(f.left, 'cellproject-workspace', envelope({ notes: { n: { id: 'n' } }, boards: {} }), 1, 'left-note');
  f.rightStore.write.mockImplementation(async (key, value: any) => { if (key === 'transport' && value.head.revision === 2) throw new Error('quota'); f.rightStore.data.set(key, structuredClone(value)); });
  await expect(f.put(f.right, 'dynamic_diary-theme', 'dark', 0, 'right-theme')).rejects.toThrow('quota');
  expect(f.requests).toHaveLength(2); expect(f.head().revision).toBe(2);
});

it('keeps rejection proofs when durable orphan cleanup fails', async () => {
  const f = await clients();
  await f.put(f.left, 'cellproject-workspace', envelope({ notes: { n: { id: 'n' } }, boards: {} }), 1, 'left-note');
  await expect(f.put(f.right, 'cellproject-workspace', envelope({ notes: {}, boards: { b: board('Tablet') } }), 1, 'right-board')).rejects.toMatchObject({ status: 409 });
  const write = f.rightStore.write.getMockImplementation()!;
  f.rightStore.write.mockRejectedValueOnce(new Error('cleanup quota'));
  await expect(f.right.reconcileOperations([])).rejects.toThrow('cleanup quota');
  expect(f.right.checkpoint().rejected).toEqual(['right-board']);
  f.rightStore.write.mockImplementation(write);
  await f.right.discardRejectedOperation('right-board');
  expect(f.right.checkpoint().requests).toEqual([]);
});

it('recovers an identical media registration already committed by another device without an invalid checkpoint', async () => {
  const f = await clients(), bytes = new TextEncoder().encode('synthetic attachment').buffer;
  const media = JSON.stringify({ id: 'shared-media', name: 'test.txt', mime: 'text/plain', size: bytes.byteLength, base64: encodeBytes(bytes), sha256: await sha256(bytes), operationId: 'right-media' });
  await f.left.fetch('/api/cloud/media', { method: 'POST', body: media.replace('right-media', 'left-media') });
  await expect(f.right.fetch('/api/cloud/media', { method: 'POST', body: media })).rejects.toMatchObject({ status: 409 });
  await f.right.fetch('/api/cloud/media', { method: 'POST', body: media });
  expect(f.right.checkpoint().rejected).toBeUndefined();
  await f.right.acknowledgeOperation('right-media');
  const restored = await VaultTransport.restore(sessionFromDeviceKey('synthetic-owner', f.vault.header, f.key), f.right.checkpoint(), f.fetcher, { persistence: f.rightStore });
  await restored.reconcileOperations([]);
  expect(restored.snapshot().media.map(item => item.id)).toEqual(['shared-media']);
  expect(restored.hasPendingOperations()).toBe(false);
});

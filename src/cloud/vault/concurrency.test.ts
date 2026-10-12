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

it('orders explicit task status commands by encrypted CAS while preserving prose and retiring both durable queues despite clock skew', async () => {
  const value = {
    projects: { project: { id: 'project', name: 'Synthetic workflow', objective: '', archived: false, createdAt: 1, updatedAt: 1 } },
    tasks: { task: { id: 'task', projectId: 'project', title: 'Shared synthetic task', description: 'Original prose', status: 'todo', priority: 'medium', dueDate: '', sprintId: null, createdAt: 1, updatedAt: 1 } },
    comments: {}, sprints: {}, notes: {} as Record<string, unknown>, folders: {}, boards: {}, legacyImported: true,
  };
  const start = { documents: [{ key: 'cellproject-workspace', value: envelope(value), revision: 1 }], media: [] };
  const f = await clients(start), leftStore = journal(), leftVault = await f.open(leftStore);
  const left = new CloudRuntime(start, leftVault.fetch, undefined, () => leftVault.refreshSnapshot(), {
    persistence: leftStore,
    rejectOperation: id => leftVault.discardRejectedOperation(id),
    acknowledgeOperation: id => leftVault.acknowledgeOperation(id),
  });
  const right = new CloudRuntime(start, f.right.fetch, undefined, () => f.right.refreshSnapshot(), {
    persistence: f.rightStore,
    rejectOperation: id => f.right.discardRejectedOperation(id),
    acknowledgeOperation: id => f.right.acknowledgeOperation(id),
  });
  const pc = structuredClone(value), tablet = structuredClone(value);
  let pcClock = 4_000_000_000, tabletClock = 10;
  const remoteProse = 'Remote description written on the PC must remain intact.';
  const canonical = async () => {
    const fresh = await f.open();
    try { return JSON.parse(fresh.snapshot().documents[0].value).state; }
    finally { fresh.dispose(); }
  };
  try {
    pc.tasks.task = { ...pc.tasks.task, status: 'doing', description: remoteProse, updatedAt: pcClock++ };
    await left.write('cellproject-workspace', envelope(pc)); await left.flush();
    tablet.notes.note = { id: 'note', title: 'Independent tablet note' };
    await right.write('cellproject-workspace', envelope(tablet)); await right.flush();
    expect(tablet.tasks.task).toMatchObject({ status: 'todo', description: 'Original prose' });
    expect(JSON.parse(right.get('cellproject-workspace')!).state.tasks.task).toMatchObject({ status: 'doing', description: remoteProse });

    tablet.tasks.task = { ...tablet.tasks.task, status: 'review', updatedAt: tabletClock++ };
    await right.write('cellproject-workspace', envelope(tablet)); await right.flush();
    expect((await canonical()).tasks.task).toMatchObject({ status: 'review', description: remoteProse });
    // A stale whole-document save without a new status command cannot replay `doing`.
    pc.tasks.task = { ...pc.tasks.task, priority: 'high', updatedAt: pcClock++ };
    await left.write('cellproject-workspace', envelope(pc)); await left.flush();
    expect((await canonical()).tasks.task).toMatchObject({ status: 'review', priority: 'high', description: remoteProse });

    for (const [pcStatus, tabletStatus] of [['done', 'todo'], ['doing', 'review']]) {
      pc.tasks.task = { ...pc.tasks.task, status: pcStatus, updatedAt: pcClock++ };
      await left.write('cellproject-workspace', envelope(pc)); await left.flush();
      expect((await canonical()).tasks.task).toMatchObject({ status: pcStatus, priority: 'high', description: remoteProse });
      tablet.tasks.task = { ...tablet.tasks.task, status: tabletStatus, updatedAt: tabletClock++ };
      await right.write('cellproject-workspace', envelope(tablet)); await right.flush();
      const saved = await canonical();
      expect(saved.tasks.task).toMatchObject({ status: tabletStatus, priority: 'high', description: remoteProse });
      expect(saved.tasks.task.updatedAt).toBeGreaterThan(tablet.tasks.task.updatedAt);
      expect(saved.notes.note.title).toBe('Independent tablet note');
    }
    for (const [runtime, transport, store] of [[left, leftVault, leftStore], [right, f.right, f.rightStore]] as const) {
      expect(runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null, localSaved: true });
      expect(store.data.get('runtime')).toMatchObject({ queue: [], drafts: [], issue: null });
      expect(transport.checkpoint()).toMatchObject({ pending: null, requests: [], completed: [] });
      expect(transport.checkpoint().rejected ?? []).toEqual([]);
    }
    expect(f.requests.join('')).not.toContain(remoteProse);
    expect(f.requests.join('')).not.toContain('Shared synthetic task');
    expect(f.requests.join('')).not.toContain('Independent tablet note');
    const restored = await VaultTransport.restore(sessionFromDeviceKey('synthetic-owner', f.vault.header, f.key), f.right.checkpoint(), f.fetcher, { persistence: f.rightStore });
    try {
      await restored.reconcileOperations([]);
      expect(restored.hasPendingOperations()).toBe(false);
      expect(JSON.parse(restored.snapshot().documents[0].value).state.tasks.task).toMatchObject({ status: 'review', description: remoteProse });
    } finally { restored.dispose(); }
  } finally {
    left.dispose(); right.dispose(); leftVault.dispose(); f.left.dispose(); f.right.dispose();
  }
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

it('preserves both incompatible note versions through encrypted conflict resolution and retires durable operations', async () => {
  const value = { notes: { n: { id: 'n', title: 'Original' } }, boards: {} };
  const start = { documents: [{ key: 'cellproject-workspace', value: envelope(value), revision: 1 }], media: [] };
  const f = await clients(start);
  const left = new CloudRuntime(start, f.left.fetch, undefined, () => f.left.refreshSnapshot());
  const right = new CloudRuntime(start, f.right.fetch, undefined, () => f.right.refreshSnapshot(), {
    persistence: f.rightStore,
    rejectOperation: id => f.right.discardRejectedOperation(id),
    acknowledgeOperation: id => f.right.acknowledgeOperation(id),
  });
  await left.write('cellproject-workspace', envelope({ ...value, notes: { n: { id: 'n', title: 'PC version' } } }));
  await right.write('cellproject-workspace', envelope({ ...value, notes: { n: { id: 'n', title: 'Tablet version' } } }));
  const rejectedId = right.checkpoint().queue[0].operationId;
  expect(right.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' }, localSaved: true });
  expect(f.right.checkpoint().rejected).toContain(rejectedId);

  expect(await right.resolveConflictCopies()).toBe(1);
  const fresh = await f.open(), notes = JSON.parse(fresh.snapshot().documents[0].value).state.notes;
  expect(notes.n).toEqual({ id: 'n', title: 'PC version' });
  const copy = Object.values(notes).find((note: any) => note.id !== 'n');
  expect(copy).toEqual({ id: expect.any(String), title: 'Tablet version (cópia deste aparelho)' });
  expect(right.getSnapshot()).toMatchObject({ pending: 0, issue: null, localSaved: true });
  expect(right.checkpoint().queue).toEqual([]);
  expect(f.rightStore.data.get('runtime')).toMatchObject({ queue: [], drafts: [], issue: null });
  expect(f.right.checkpoint()).toMatchObject({ pending: null, requests: [], completed: [] });
  expect(f.right.checkpoint().rejected ?? []).toEqual([]);
  expect(f.requests.join('')).not.toContain('PC version');
  expect(f.requests.join('')).not.toContain('Tablet version');

  const restored = await VaultTransport.restore(sessionFromDeviceKey('synthetic-owner', f.vault.header, f.key), f.right.checkpoint(), f.fetcher, { persistence: f.rightStore });
  await restored.reconcileOperations([]);
  expect(restored.hasPendingOperations()).toBe(false);
  expect(JSON.parse(restored.snapshot().documents[0].value).state.notes).toEqual(notes);
  left.dispose(); right.dispose(); fresh.dispose(); restored.dispose(); f.left.dispose(); f.right.dispose();
});

it.each([false, true])('synchronizes independent note strokes across different measured device heights (previous ink: %s)', async existing => {
  const empty = { version: 1, width: 1200, height: 900, strokes: [] };
  const value = { notes: { n: { id: 'n', title: 'Shared note', ...(existing ? { ink: empty } : {}) } }, boards: {} };
  const start = { documents: [{ key: 'cellproject-workspace', value: envelope(value), revision: 1 }], media: [] };
  const f = await clients(start);
  const left = new CloudRuntime(start, f.left.fetch, undefined, () => f.left.refreshSnapshot());
  const right = new CloudRuntime(start, f.right.fetch, undefined, () => f.right.refreshSnapshot());
  const stroke = (id: string, y: number) => ({ id, color: '#000000', width: 3, points: [{ x: 10, y }] });
  await left.write('cellproject-workspace', envelope({ ...value, notes: { n: { ...value.notes.n, ink: { ...empty, height: 1200, strokes: [stroke('pc', 1100)] } } } }));
  await right.write('cellproject-workspace', envelope({ ...value, notes: { n: { ...value.notes.n, ink: { ...empty, height: 1700, strokes: [stroke('tablet', 1600)] } } } }));
  expect(right.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  const fresh = await f.open(), note = JSON.parse(fresh.snapshot().documents[0].value).state.notes.n;
  expect(note.title).toBe('Shared note');
  expect(note.ink).toEqual({ version: 1, width: 1200, height: 1700, strokes: [stroke('pc', 1100), stroke('tablet', 1600)] });
  expect(f.requests.join('')).not.toContain('Shared note');
  left.dispose(); right.dispose(); fresh.dispose(); f.left.dispose(); f.right.dispose();
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

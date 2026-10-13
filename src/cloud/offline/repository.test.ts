import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVault, sessionFromDeviceKey, type VaultHeader, type VaultSession } from '../vault/crypto';
import { OFFLINE_DATABASE, OfflineRepository, acquireOfflineLease, authorizeOffline, readOfflineAuthorization, revokeOfflineAuthorization } from './repository';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function rawRecords(storeName = 'records'): Promise<Array<[IDBValidKey, Record<string, unknown>]>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(storeName, 'readonly'), store = transaction.objectStore(storeName);
      const keys = store.getAllKeys(), values = store.getAll();
      transaction.oncomplete = () => { db.close(); resolve(keys.result.map((key, index) => [key, values.result[index]])); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}
async function putRaw(key: IDBValidKey, value: unknown, storeName = 'records') {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}
const recordKey = (session: VaultSession, slot: string) => JSON.stringify([session.ownerId, session.header.id, slot]);

it.each([false, true])('decodes a large v3 workspace body once for each encrypted offline readback (native %s)', async native => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline large body phrase'), repository = new OfflineRepository(vault.session);
  const value = { version: 3, state: { notes: { large: { content: 'x'.repeat(3_500_000) } } } };
  const original = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, writable: true, value: native
    ? original?.value ?? ((body: string) => new Uint8Array(Buffer.from(body, 'base64'))) : undefined });
  const fallbackDecode = vi.spyOn(globalThis, 'atob');
  const decode = native ? vi.spyOn(Uint8Array as typeof Uint8Array & { fromBase64(body: string): Uint8Array }, 'fromBase64') : fallbackDecode;
  try {
    await repository.write('runtime', value);
    expect(decode.mock.calls.filter(([body]) => body.length > 1_000_000).length).toBe(1);
    if (native) expect(fallbackDecode).not.toHaveBeenCalled();
    decode.mockClear();
    expect(await repository.read('runtime')).toEqual(value);
    expect(decode.mock.calls.filter(([body]) => body.length > 1_000_000).length).toBe(1);
    if (native) expect(fallbackDecode).not.toHaveBeenCalled();
  } finally {
    decode.mockRestore(); if (native) fallbackDecode.mockRestore(); vault.session.dispose();
    if (original) Object.defineProperty(Uint8Array, 'fromBase64', original); else Reflect.deleteProperty(Uint8Array, 'fromBase64');
  }
}, 15000);

it('reopens encrypted JSON in a new repository without persisting the private content', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline repository phrase');
  const repository = new OfflineRepository(vault.session), value = { note: 'PRIVATE OFFLINE NOTE', queue: [{ operationId: 'pending-1', value: 'PRIVATE DRAFT' }] };
  expect(await repository.read('runtime')).toBeNull();
  await repository.write('runtime', value);
  const reopened = new OfflineRepository(vault.session);
  expect(await reopened.read('runtime')).toEqual(value);
  const record = (await rawRecords()).find(([key]) => key === recordKey(vault.session, 'runtime'))!;
  expect(record).toBeDefined(); expect(JSON.stringify(record)).not.toContain('PRIVATE OFFLINE NOTE'); expect(JSON.stringify(record)).not.toContain('PRIVATE DRAFT');
  await reopened.remove('runtime'); expect(await repository.read('runtime')).toBeNull();
  vault.session.dispose();
});

it.each(['slot', 'owner', 'vault'] as const)('rejects ciphertext transplanted to a different %s even with the same AES handle', async kind => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline context phrase');
  const source = new OfflineRepository(vault.session); await source.write('source', { text: 'preserve me' });
  const targetSession = sessionFromDeviceKey(kind === 'owner' ? crypto.randomUUID() : vault.session.ownerId,
    kind === 'vault' ? { ...vault.header, id: crypto.randomUUID() } : vault.header, vault.session.deviceKeyForStorage());
  const targetSlot = kind === 'slot' ? 'target' : 'source', target = new OfflineRepository(targetSession);
  if (kind !== 'slot') expect(await target.read(targetSlot)).toBeNull();
  await target.write(targetSlot, { text: 'target value' });
  const records = await rawRecords(), sourceRecord = records.find(([key]) => key === recordKey(vault.session, 'source'))![1];
  const targetRecord = records.find(([key]) => key === recordKey(targetSession, targetSlot))![1];
  await putRaw(recordKey(targetSession, targetSlot), { ...targetRecord, cipher: sourceRecord.cipher });
  await expect(target.read(targetSlot)).rejects.toThrow();
  expect(await source.read('source')).toEqual({ text: 'preserve me' });
  vault.session.dispose(); targetSession.dispose();
});

it.each(['ownerId', 'vaultId', 'slot', 'fingerprint'] as const)('fails closed on corrupted %s metadata without removing the stored record', async field => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline metadata phrase'), repository = new OfflineRepository(vault.session);
  await repository.write('runtime', { text: 'private' });
  const key = recordKey(vault.session, 'runtime'), stored = (await rawRecords()).find(([id]) => id === key)![1];
  await putRaw(key, { ...stored, [field]: 'wrong binding' });
  await expect(repository.read('runtime')).rejects.toThrow();
  expect((await rawRecords()).find(([id]) => id === key)![1][field]).toBe('wrong binding');
  vault.session.dispose();
});

it('rejects a different complete header and tampered ciphertext', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline header phrase'), repository = new OfflineRepository(vault.session);
  await repository.write('runtime', { text: 'preserve me' });
  const changedHeader = { ...vault.header, password: { ...vault.header.password, iv: 'AAAAAAAAAAAAAAAA' } };
  const changedSession = sessionFromDeviceKey(vault.session.ownerId, changedHeader, vault.session.deviceKeyForStorage());
  await expect(new OfflineRepository(changedSession).read('runtime')).rejects.toThrow();
  const key = recordKey(vault.session, 'runtime'), stored = (await rawRecords()).find(([id]) => id === key)![1];
  await putRaw(key, { ...stored, cipher: { ...(stored.cipher as object), iv: 'AAAAAAAAAAAAAAAA' } });
  await expect(repository.read('runtime')).rejects.toThrow();
  vault.session.dispose(); changedSession.dispose();
});

it('rejects every malformed cipher before decryption and preserves the original offline record', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline invalid cipher phrase'), repository = new OfflineRepository(vault.session);
  await repository.write('runtime', { text: 'preserved' });
  const key = recordKey(vault.session, 'runtime'), stored = (await rawRecords()).find(([id]) => id === key)![1];
  const cipher = stored.cipher as Record<string, unknown>, decrypt = vi.spyOn(crypto.subtle, 'decrypt');
  try {
    for (const invalid of [null, {}, { ...cipher, v: 2 }, { ...cipher, extra: true }, { ...cipher, iv: 'AAAA' }, { ...cipher, data: 'AAAA' }]) {
      await putRaw(key, { ...stored, cipher: invalid });
      await expect(repository.read('runtime')).rejects.toThrow('Envelope criptografado inválido');
    }
    expect(decrypt).not.toHaveBeenCalled();
    await putRaw(key, stored); expect(await repository.read('runtime')).toEqual({ text: 'preserved' });
    vault.session.dispose(); await expect(repository.read('runtime')).rejects.toThrow('bloqueado');
  } finally { decrypt.mockRestore(); vault.session.dispose(); }
});

it('authenticates the complete header fingerprint even if outer metadata is rewritten', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline authenticated-header phrase'), repository = new OfflineRepository(vault.session);
  await repository.write('runtime', { text: 'original header only' });
  const changedSession = sessionFromDeviceKey(vault.session.ownerId,
    { ...vault.header, password: { ...vault.header.password, iv: 'AAAAAAAAAAAAAAAA' } }, vault.session.deviceKeyForStorage());
  const changed = new OfflineRepository(changedSession); await changed.write('other', { text: 'different header' });
  const records = await rawRecords(), key = recordKey(vault.session, 'runtime');
  const original = records.find(([id]) => id === key)![1], other = records.find(([id]) => id === recordKey(changedSession, 'other'))![1];
  await putRaw(key, { ...original, fingerprint: other.fingerprint });
  await expect(changed.read('runtime')).rejects.toThrow();
  vault.session.dispose(); changedSession.dispose();
});

it('does not acknowledge a corrupted readback or a quota failure and preserves the previous slot', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline quota phrase'), repository = new OfflineRepository(vault.session);
  await repository.write('runtime', { text: 'previous' });
  const put = IDBObjectStore.prototype.put;
  const quota = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'records') throw new DOMException('synthetic quota', 'QuotaExceededError');
    return put.call(this, value, key);
  });
  await expect(repository.write('runtime', { text: 'unsaved' })).rejects.toThrow(/armazenamento|espaço/);
  quota.mockRestore(); expect(await repository.read('runtime')).toEqual({ text: 'previous' });
  const corrupt = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    return put.call(this, this.name === 'records' ? { ...value, cipher: { ...value.cipher, iv: 'AAAAAAAAAAAAAAAA' } } : value, key);
  });
  await expect(repository.write('another', { text: 'do not acknowledge' })).rejects.toThrow();
  corrupt.mockRestore(); expect(await repository.read('runtime')).toEqual({ text: 'previous' }); vault.session.dispose();
});

it('settles only after pending and queued mutations finish and consumes failed mutation errors', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline shutdown barrier phrase'), repository = new OfflineRepository(vault.session);
  let resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; }), seal = vault.session.seal.bind(vault.session);
  const pendingSeal = vi.spyOn(vault.session, 'seal').mockImplementationOnce(async (...args) => { await paused; return seal(...args); });
  const writing = repository.write('runtime', { text: 'committed before releasing ownership' });
  const removing = repository.remove('runtime');
  await vi.waitFor(() => expect(pendingSeal).toHaveBeenCalledOnce());
  let finished = false;
  const barrier = repository.settled().then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  resume(); await writing; await removing; await barrier;
  expect(finished).toBe(true); expect(await repository.read('runtime')).toBeNull();
  vi.spyOn(vault.session, 'seal').mockRejectedValueOnce(new Error('synthetic encryption failure'));
  await expect(repository.write('runtime', { text: 'failed' })).rejects.toThrow('synthetic encryption failure');
  await expect(repository.settled()).resolves.toBeUndefined();
  vault.session.dispose();
});

it('records metadata-only authorization and revokes it without deleting encrypted pending work', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline authorization phrase'), repository = new OfflineRepository(vault.session);
  await revokeOfflineAuthorization(); expect(await readOfflineAuthorization()).toBeNull();
  await repository.write('runtime', { queue: ['PRIVATE PENDING WORK'] });
  const authorization = { version: 1 as const, ownerId: vault.session.ownerId, email: 'owner@example.test', header: vault.header, providers: { openai: true }, liveInkAvailable: true };
  await authorizeOffline(authorization); expect(await readOfflineAuthorization()).toEqual(authorization);
  expect(JSON.stringify(await rawRecords('authorization'))).not.toContain('PRIVATE PENDING WORK');
  await revokeOfflineAuthorization(); expect(await readOfflineAuthorization()).toBeNull();
  expect(await repository.read('runtime')).toEqual({ queue: ['PRIVATE PENDING WORK'] }); vault.session.dispose();
});

it('rejects invalid authorization headers, extra credential fields and corrupted authorization metadata', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic offline authorization validation phrase');
  const authorization = { version: 1 as const, ownerId: vault.session.ownerId, email: 'owner@example.test', header: vault.header };
  await expect(authorizeOffline({ ...authorization, header: { ...vault.header, kdf: { ...vault.header.kdf, iterations: 1 } } as unknown as VaultHeader })).rejects.toThrow();
  await expect(authorizeOffline({ ...authorization, password: 'MUST NEVER STORE' } as typeof authorization)).rejects.toThrow();
  await expect(authorizeOffline({ ...authorization, providers: { openai: true, apiKey: 'MUST NEVER STORE' } } as typeof authorization)).rejects.toThrow();
  await authorizeOffline(authorization);
  const [key, stored] = (await rawRecords('authorization'))[0]; await putRaw(key, { ...stored, version: 9 }, 'authorization');
  await expect(readOfflineAuthorization()).rejects.toThrow();
  await revokeOfflineAuthorization(); vault.session.dispose();
});

it('holds one nonblocking Web Lock per owner and vault until an idempotent release', async () => {
  const held = new Set<string>();
  const request = vi.fn(async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (options.ifAvailable !== true || options.mode !== 'exclusive') throw new Error('A blocking/shared request is not allowed');
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' }); } finally { held.delete(name); }
  });
  vi.stubGlobal('navigator', { locks: { request } });
  const release = await acquireOfflineLease('owner', 'vault'); expect(release).not.toBeNull();
  expect(await acquireOfflineLease('owner', 'vault')).toBeNull();
  const anotherOwner = await acquireOfflineLease('another', 'vault'), anotherVault = await acquireOfflineLease('owner', 'another');
  expect(anotherOwner).not.toBeNull(); expect(anotherVault).not.toBeNull();
  release!(); release!(); await Promise.resolve();
  const reacquired = await acquireOfflineLease('owner', 'vault'); expect(reacquired).not.toBeNull();
  reacquired!(); anotherOwner!(); anotherVault!();
});

it('declines offline ownership when Web Locks are unsupported or rejected', async () => {
  vi.stubGlobal('navigator', {}); await expect(acquireOfflineLease('owner', 'vault')).rejects.toThrow(/armazenamento offline/);
  vi.stubGlobal('navigator', { locks: { request: async () => { throw new DOMException('denied', 'SecurityError'); } } });
  await expect(acquireOfflineLease('owner', 'vault')).rejects.toThrow(/armazenamento offline/);
});

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVault, sessionFromDeviceKey, type CipherEnvelope } from './crypto';
import { rememberDeviceVault, readDeviceVault, readDeviceRecovery, readPreparedDeviceVault, downloadDeviceRecovery } from './deviceKeys';
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('persists a non-extractable handle and encrypted recovery, scoped to account and exact header', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic device-vault phrase');
  await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  const restored = await readDeviceVault(vault.session.ownerId, vault.header);
  expect(restored).not.toBeNull(); expect(restored!.deviceKeyForStorage().extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', restored!.deviceKeyForStorage())).rejects.toThrow();
  expect(await readDeviceRecovery(restored!)).toBe(vault.recoveryKey);
  expect(await readDeviceVault('another-account', vault.header)).toBeNull();
  await expect(readDeviceVault(vault.session.ownerId, { ...vault.header, password: { ...vault.header.password, iv: 'AAAAAAAAAAAAAAAA' } })).rejects.toThrow();
  vault.session.dispose(); expect(await restored!.openText(await restored!.seal('persisted', 'test'), 'test')).toBe('persisted'); restored!.dispose();
});
it('fails closed when the browser cannot store a key', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic blocked-storage phrase');
  const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('IDB disabled'); });
  try { await expect(rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey })).rejects.toThrow('navegador'); }
  finally { open.mockRestore(); }
  expect(await vault.session.openText(await vault.session.seal('still open', 'test'), 'test')).toBe('still open'); vault.session.dispose();
});
it('retains the same encrypted activation preparation across a browser-session restart', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic pending-storage phrase');
  const head = { header: vault.header, revision: 1, manifest: await vault.session.seal('{"snapshot":{"documents":[],"media":[]},"files":{}}', 'manifest:1') };
  const activation = { body: JSON.stringify({ header: vault.header, manifest: head.manifest, expectedDocuments: [], operationId: crypto.randomUUID() }), head, snapshotFingerprint: 'a'.repeat(64) };
  await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey, activation }); vault.session.dispose();
  const prepared = await readPreparedDeviceVault(vault.session.ownerId);
  expect(prepared!.activation).toEqual(activation); expect(await readDeviceRecovery(prepared!.session)).toBe(vault.recoveryKey);
  prepared!.session.dispose();
});
it('remembers a legacy unlocked key without inventing a replacement recovery credential', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic legacy-storage phrase');
  await rememberDeviceVault(vault.session);
  expect(await readDeviceRecovery(vault.session)).toBeNull();
  expect((await readDeviceVault(vault.session.ownerId, vault.header))!.header).toEqual(vault.header);
  vault.session.dispose();
});
it('refuses an activation key whose persisted probe fails the required readback', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic readback-storage phrase'), put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    return put.call(this, value?.version === 1 ? { ...value, probe: { ...value.probe, iv: 'AAAAAAAAAAAAAAAA' } } : value, key);
  });
  await expect(rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey })).rejects.toThrow('chave deste navegador'); vault.session.dispose();
});
it('does not download recovery if the session locks while decrypted recovery is awaiting delivery', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic recovery-download phrase'); await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; }), original = vault.session.openText.bind(vault.session);
  vi.spyOn(vault.session, 'openText').mockImplementation(async (envelope, purpose) => { const value = await original(envelope, purpose); entered(); await waiting; return value; });
  const create = vi.fn(); vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const download = downloadDeviceRecovery(vault.session); await started; vault.session.dispose(); release();
  await expect(download).rejects.toThrow('bloqueado'); expect(create).not.toHaveBeenCalled();
});
it.each(['account', 'vault'] as const)('rejects recovery ciphertext copied from another %s even with the same AES key', async kind => {
  const source = await createVault(crypto.randomUUID(), 'synthetic context-binding phrase');
  // Reuse the same non-extractable handle deliberately: a different key would
  // fail independently and would not prove owner/vault associated-data binding.
  const target = sessionFromDeviceKey(kind === 'account' ? crypto.randomUUID() : source.session.ownerId,
    kind === 'vault' ? { ...source.header, id: crypto.randomUUID() } : source.header, source.session.deviceKeyForStorage());
  const put = IDBObjectStore.prototype.put; let copied: CipherEnvelope | null = null;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value?.version === 1) {
      if (value.ownerId === source.session.ownerId && value.vaultId === source.header.id) copied = value.recovery;
      else value = { ...value, recovery: copied };
    }
    return put.call(this, value, key);
  });
  try {
    await rememberDeviceVault(source.session, { recoveryKey: source.recoveryKey });
    expect(copied).not.toBeNull();
    await expect(rememberDeviceVault(target, { recoveryKey: source.recoveryKey })).rejects.toThrow();
    const restored = await readDeviceVault(target.ownerId, target.header);
    expect(restored).not.toBeNull();
    await expect(readDeviceRecovery(restored!)).rejects.toThrow();
    restored!.dispose();
  } finally { source.session.dispose(); target.dispose(); }
});

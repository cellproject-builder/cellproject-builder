import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { backupBlob, captureLegacyBackup, readBackup } from '../migration';
import { createVault } from './crypto';
import { configureVault, decryptExport, encryptedExport } from './privacy';
beforeAll(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => configureVault(null, false));
it('exports encrypted global backups by default and imports them only in the original unlocked vault', async () => {
  const vault = await createVault('owner', 'test-only secret backup phrase'); configureVault(vault.session);
  const backup = await captureLegacyBackup({ getDocument: async key => key === 'dynamic_diary-chat' ? '{"version":1,"state":{"message":"very private backup chat"}}' : null, getPreference: () => null, getMedia: async () => [] });
  const blob = await backupBlob(backup);
  const bytes = await new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob); });
  expect(new TextDecoder().decode(bytes)).not.toContain('very private backup chat');
  expect(new TextDecoder().decode(bytes)).toContain('dynamic-diary-encrypted-export');
  expect((await readBackup(blob)).documents).toEqual(backup.documents);
  configureVault(null); await expect(readBackup(blob)).rejects.toThrow('cofre original');
});
it('never falls back to a plaintext ZIP when locking during an asynchronous backup capture', async () => {
  const vault = await createVault('owner', 'test-only secret backup phrase'); configureVault(vault.session);
  let release!: () => void; const deferred = new Promise<void>(resolve => { release = resolve; });
  const pending = captureLegacyBackup({ getDocument: async () => { await deferred; return null; }, getPreference: () => null, getMedia: async () => [] }).then(backupBlob);
  vault.session.dispose(); configureVault(null); release();
  await expect(pending).rejects.toThrow('bloqueado');
});
it('authenticates the unique export package so chunks from another backup cannot be spliced', async () => {
  const vault = await createVault('owner', 'test-only secret backup phrase'); configureVault(vault.session);
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1).buffer;
  const read = (blob: Blob) => new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob); });
  const a = JSON.parse(new TextDecoder().decode(await read(await encryptedExport(bytes, 'backup'))));
  const b = JSON.parse(new TextDecoder().decode(await read(await encryptedExport(bytes, 'backup'))));
  expect(a.chunks).toHaveLength(2); a.chunks[1] = b.chunks[1];
  await expect(decryptExport(new TextEncoder().encode(JSON.stringify(a)).buffer, 'backup')).rejects.toThrow();
}, 20000);


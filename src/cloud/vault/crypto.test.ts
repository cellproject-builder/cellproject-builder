import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createVault, unlockVault, recoverVault, validateHeader, type CipherEnvelope } from './crypto';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const owner = '00000000-0000-4000-8000-000000000001';
const secret = 'test-only phrase never used by a real account';
describe('client-only encrypted vault', () => {
  it('encrypts content with fresh nonces and only unlocks with the separate secret', async () => {
    const created = await createVault(owner, secret);
    const a = await created.session.seal('private project title', 'manifest:1');
    const b = await created.session.seal('private project title', 'manifest:1');
    expect(JSON.stringify(a)).not.toContain('private project title'); expect(a.iv).not.toBe(b.iv);
    expect(JSON.stringify(created.header)).not.toContain(secret);
    const opened = await unlockVault(owner, created.header, secret);
    expect(await opened.openText(a, 'manifest:1')).toBe('private project title');
    await expect(unlockVault(owner, created.header, 'another unrelated phrase')).rejects.toThrow('desbloquear');
  });
  it('authenticates account, vault, purpose, revision and ciphertext', async () => {
    const created = await createVault(owner, secret);
    const data = await created.session.seal('private', 'manifest:1');
    await expect(created.session.openText(data, 'manifest:2')).rejects.toThrow();
    await expect(unlockVault('different-owner', created.header, secret)).rejects.toThrow();
    const corrupted = { ...data, data: data.data.slice(0, -4) + 'AAAA' } as CipherEnvelope;
    await expect(created.session.openText(corrupted, 'manifest:1')).rejects.toThrow();
  });
  it('recovers using a random recovery key without any login password or backend secret', async () => {
    const created = await createVault(owner, secret);
    expect(created.recoveryKey.replaceAll('-', '')).toMatch(/^[0-9a-f]{64}$/);
    const data = await created.session.seal('document', 'backup');
    const recovered = await recoverVault(owner, created.header, created.recoveryKey);
    expect(await recovered.openText(data, 'backup')).toBe('document');
    await expect(recoverVault(owner, created.header, '0'.repeat(64))).rejects.toThrow('desbloquear');
  });
  it('rejects unbounded or downgraded parameters and fails closed after locking', async () => {
    const created = await createVault(owner, secret);
    expect(() => validateHeader({ ...created.header, kdf: { ...created.header.kdf, iterations: 1 } })).toThrow();
    expect(() => validateHeader({ ...created.header, untrusted: 'plaintext' })).toThrow();
    created.session.dispose(); await expect(created.session.seal('data', 'backup')).rejects.toThrow('bloqueado');
    await expect(createVault(owner, 'short')).rejects.toThrow('12');
  });
});

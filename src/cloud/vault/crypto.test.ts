import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { b64, unb64, createVault, unlockVault, recoverVault, validateCipher, validateHeader, MAX_CIPHER_BYTES, type CipherEnvelope } from './crypto';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const owner = '00000000-0000-4000-8000-000000000001';
const secret = 'test-only phrase never used by a real account';

describe('canonical binary envelopes', () => {
  it('preserves every byte value across an encoding chunk boundary', () => {
    const bytes = new Uint8Array(8193);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(unb64(b64(bytes), bytes.length)).toEqual(bytes);
    expect(unb64('/w==', 1)).toEqual(new Uint8Array([255]));
    expect(unb64('', 0)).toEqual(new Uint8Array());
  });
  it('rejects noncanonical padding, invalid alphabet and decoded bytes above the limit', () => {
    for (const value of ['/x==', 'Zh==', 'Zg=', 'Zg', ' Zg==', 'Zg==\n', '_w==', 'AA=A', 'é===']) {
      expect(() => unb64(value)).toThrow('Envelope criptografado inválido');
    }
    expect(unb64('AAAA', 3)).toEqual(new Uint8Array(3));
    expect(() => unb64('AAAA', 2)).toThrow('Envelope criptografado inválido');
    expect(() => unb64('AA==', 0)).toThrow('Envelope criptografado inválido');
  });
  it('preserves the validated envelope identity and exact cipher byte limits', () => {
    const envelope: CipherEnvelope = { v: 1, iv: b64(new Uint8Array(12)), data: b64(new Uint8Array(16)) };
    expect(validateCipher(envelope, 16)).toBe(envelope);
    expect(() => validateCipher(envelope, 15)).toThrow('Envelope criptografado inválido');
    expect(() => validateCipher({ ...envelope, data: b64(new Uint8Array(17)) }, 16)).toThrow('Envelope criptografado inválido');
    expect(() => validateCipher({ ...envelope, data: b64(new Uint8Array(15)) }, 16)).toThrow('Envelope criptografado inválido');
    expect(() => validateCipher({ ...envelope, data: envelope.data.slice(0, -3) + 'B==' }, 16)).toThrow('Envelope criptografado inválido');
  });
});
describe('client-only encrypted vault', () => {
  it('decodes and canonically validates a cipher body once when opening it', async () => {
    const created = await createVault(owner, secret), text = 'synthetic content '.repeat(8193);
    const envelope = await created.session.seal(text, 'decode-once');
    const decode = vi.spyOn(globalThis, 'atob');
    try {
      expect(await created.session.openText(envelope, 'decode-once')).toBe(text);
      expect(decode.mock.calls.filter(([value]) => value === envelope.data).length).toBe(1);
    } finally { decode.mockRestore(); created.session.dispose(); }
  });
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
    const sealed = await created.session.seal('data', 'backup'), decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    try {
      await expect(created.session.openText({ ...sealed, untrusted: true } as CipherEnvelope, 'backup')).rejects.toThrow('Envelope criptografado inválido');
      await expect(created.session.openText({ ...sealed, data: 'A'.repeat(Math.ceil(MAX_CIPHER_BYTES / 3) * 4 + 4) }, 'backup')).rejects.toThrow('Envelope criptografado inválido');
      expect(decrypt).not.toHaveBeenCalled();
    } finally { decrypt.mockRestore(); }
    created.session.dispose(); await expect(created.session.seal('data', 'backup')).rejects.toThrow('bloqueado');
    await expect(created.session.openText(sealed, 'backup')).rejects.toThrow('bloqueado');
    await expect(createVault(owner, 'short')).rejects.toThrow('12');
  });
});

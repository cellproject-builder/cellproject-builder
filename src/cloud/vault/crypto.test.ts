import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { b64, unb64, createVault, unlockVault, recoverVault, validateCipher, validateHeader, MAX_CIPHER_BYTES, type CipherEnvelope } from './crypto';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
const owner = '00000000-0000-4000-8000-000000000001';
const secret = 'test-only phrase never used by a real account';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function withBase64API<T>(native: boolean, run: (encode: ReturnType<typeof vi.fn>, decode: ReturnType<typeof vi.fn>) => T): T {
  const encoded = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
  const decoded = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  const encode = vi.fn(function (this: Uint8Array) { return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64'); });
  const decode = vi.fn((value: string) => new Uint8Array(Buffer.from(value, 'base64')));
  Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: native ? encode : undefined });
  Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: native ? decode : undefined });
  const restore = () => {
    if (encoded) Object.defineProperty(Uint8Array.prototype, 'toBase64', encoded); else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
    if (decoded) Object.defineProperty(Uint8Array, 'fromBase64', decoded); else Reflect.deleteProperty(Uint8Array, 'fromBase64');
  };
  try {
    const result = run(encode, decode);
    if (result instanceof Promise) return result.finally(restore) as T;
    restore(); return result;
  } catch (error) { restore(); throw error; }
}

describe('canonical binary envelopes', () => {
  it('decodes a canonical body without allocating an encoded copy to validate it', () => {
    withBase64API(false, () => {
      const encode = vi.spyOn(globalThis, 'btoa');
      try { expect(unb64('AAECAwQF', 6)).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5])); expect(encode).not.toHaveBeenCalled(); }
      finally { encode.mockRestore(); }
    });
  });
  it('rejects noncanonical aliases and exact decoded byte overflows before decoding', () => {
    withBase64API(false, () => {
      const decode = vi.spyOn(globalThis, 'atob');
      try {
        for (const [value, limit] of [['/x==', 1], ['AAB=', 2], ['AAAA', 2], ['AA==', 0], ['AA=A', 3], ['AA==\n', 1], ['====', 3]] as const) {
          expect(() => unb64(value, limit)).toThrow('Envelope criptografado inválido');
        }
        expect(decode).not.toHaveBeenCalled();
      } finally { decode.mockRestore(); }
    });
  });
  it('uses the native byte APIs with strict decoding and preserves typed array view bounds', () => {
    withBase64API(true, (encode, decode) => {
      const legacyEncode = vi.spyOn(globalThis, 'btoa'), legacyDecode = vi.spyOn(globalThis, 'atob');
      try {
        expect(b64(new Uint8Array([99, 0, 1, 2, 99]).subarray(1, 4))).toBe('AAEC');
        expect(unb64('/w==', 1)).toEqual(new Uint8Array([255]));
        expect(encode).toHaveBeenCalledOnce();
        expect(decode).toHaveBeenCalledWith('/w==', { alphabet: 'base64', lastChunkHandling: 'strict' });
        expect(legacyEncode).not.toHaveBeenCalled(); expect(legacyDecode).not.toHaveBeenCalled();
        decode.mockClear();
        for (const value of [' Zg==', 'Zg==\n', 'Zg', '_w==', '/x==', 'AAB=']) expect(() => unb64(value)).toThrow('Envelope criptografado inválido');
        expect(decode).not.toHaveBeenCalled();
      } finally { legacyEncode.mockRestore(); legacyDecode.mockRestore(); }
    });
  });
  it.each([false, true])('matches the previous canonical format across all one-byte padding aliases (native %s)', native => {
    withBase64API(native, () => {
      const candidates = ['', 'AAAA', 'AAA=', 'AA==', 'AA=A', '=AAA', 'A===', '====', 'AAA', 'AAAA=', 'AA==AA==', 'AAAA\n', 'AAAA\r', 'AAAA\t', 'AAAA ', 'AAAA\u00a0', 'AAAA\0', 'AAAAé', 'AA-_'];
      for (let first = 0; first < 64; first++) for (let last = 0; last < 64; last++) candidates.push(alphabet[first] + alphabet[last] + '==');
      for (const prefix of ['AA', 'AZ', 'az', '09', '+/', '/+']) for (const last of alphabet) candidates.push(prefix + last + '=');
      for (const value of candidates) {
        let expected: Uint8Array | undefined;
        try { const raw = atob(value); if (btoa(raw) === value) expected = Uint8Array.from(raw, char => char.charCodeAt(0)); } catch { /* previous decoder rejects */ }
        if (expected) expect(unb64(value, expected.length)).toEqual(expected);
        else expect(() => unb64(value)).toThrow('Envelope criptografado inválido');
      }
    });
  });
  it.each([false, true])('preserves canonical bytes, padding, and exact limits around encoding chunks (native %s)', native => {
    withBase64API(native, () => {
      for (const length of [0, 1, 2, 3, 8189, 8190, 8191, 8192, 8193, 16379, 16380, 16381, 32769]) {
        const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 255) % 256), expected = Buffer.from(bytes).toString('base64');
        expect(b64(bytes)).toBe(expected); expect(b64(bytes.buffer)).toBe(expected);
        expect(unb64(expected, length)).toEqual(bytes);
        if (length) expect(() => unb64(expected, length - 1)).toThrow('Envelope criptografado inválido');
      }
    });
  });
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
  it.each([false, true])('decodes and canonically validates a cipher body once when opening it (native %s)', native => withBase64API(native, async (_encode, nativeDecode) => {
    const created = await createVault(owner, secret), text = 'synthetic content '.repeat(8193);
    const envelope = await created.session.seal(text, 'decode-once');
    const fallbackDecode = vi.spyOn(globalThis, 'atob'), decode = native ? nativeDecode : fallbackDecode;
    nativeDecode.mockClear();
    try {
      expect(await created.session.openText(envelope, 'decode-once')).toBe(text);
      expect(decode.mock.calls.filter(([value]) => value === envelope.data).length).toBe(1);
      expect((native ? fallbackDecode : nativeDecode).mock.calls.filter(([value]) => value === envelope.data).length).toBe(0);
    } finally { fallbackDecode.mockRestore(); created.session.dispose(); }
  }));
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

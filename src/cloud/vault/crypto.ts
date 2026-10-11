/** WebCrypto envelope encryption. Raw keys and recovery secrets never go to an API. */
export interface CipherEnvelope { v: 1; iv: string; data: string }
export interface VaultHeader {
  format: 'dynamic-diary-vault'; version: 1; id: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 600000; salt: string };
  password: CipherEnvelope; recovery: CipherEnvelope;
}
export const MAX_CIPHER_BYTES = 96 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
type NativeBase64Array = Uint8Array & { toBase64?: () => string };
type NativeBase64Constructor = Uint8ArrayConstructor & { fromBase64?: (value: string, options: { alphabet: 'base64'; lastChunkHandling: 'strict' }) => Uint8Array<ArrayBuffer> };
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
}
export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), native = (data as NativeBase64Array).toBase64;
  if (typeof native === 'function') return native.call(data);
  // A multiple of three keeps padding in the final chunk and bounds binary-string copies.
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 8190) chunks.push(btoa(String.fromCharCode(...data.subarray(i, i + 8190))));
  return chunks.join('');
}
export function unb64(value: string, limit = MAX_CIPHER_BYTES): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || value.length % 4) throw new Error('Envelope criptografado inválido.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const length = value.length / 4 * 3 - padding;
  // Canonical base64 has terminal padding only and zero unused bits in its last sextet.
  // Check this before either decoder: the native strict mode still permits whitespace.
  if (length > limit || /[^A-Za-z0-9+/=]/.test(value) || value.indexOf('=') !== (padding ? value.length - padding : -1)
    || (padding && (base64Alphabet.indexOf(value[value.length - padding - 1]) & (padding === 2 ? 15 : 3)))) throw new Error('Envelope criptografado inválido.');
  const native = (Uint8Array as NativeBase64Constructor).fromBase64;
  if (typeof native === 'function') {
    const bytes = native.call(Uint8Array, value, { alphabet: 'base64', lastChunkHandling: 'strict' });
    if (bytes.length !== length) throw new Error('Envelope criptografado inválido.');
    return bytes;
  }
  const binary = atob(value);
  if (binary.length !== length) throw new Error('Envelope criptografado inválido.');
  // Avoid an iterable-sized intermediate array when decoding large media/backups.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function parseCipher(value: unknown, max = MAX_CIPHER_BYTES): { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> } {
  if (!exact(value, ['v', 'iv', 'data']) || value.v !== 1 || typeof value.iv !== 'string' || typeof value.data !== 'string') throw new Error('Envelope criptografado inválido.');
  const iv = unb64(value.iv, 12);
  if (iv.length !== 12) throw new Error('Envelope criptografado inválido.');
  const data = unb64(value.data, max);
  if (data.length < 16) throw new Error('Envelope criptografado inválido.');
  return { iv, data };
}
export function validateCipher(value: unknown, max = MAX_CIPHER_BYTES): CipherEnvelope {
  parseCipher(value, max);
  return value as unknown as CipherEnvelope;
}
export function validateHeader(value: unknown): VaultHeader {
  if (!exact(value, ['format', 'version', 'id', 'kdf', 'password', 'recovery']) || value.format !== 'dynamic-diary-vault' || value.version !== 1 || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || !exact(value.kdf, ['name', 'hash', 'iterations', 'salt']) || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== 600000 || typeof value.kdf.salt !== 'string' || unb64(value.kdf.salt, 16).length !== 16) throw new Error('Configuração do cofre inválida.');
  for (const wrapped of [value.password, value.recovery]) if (unb64(validateCipher(wrapped, 48).data, 48).length !== 48) throw new Error('Chave protegida inválida.');
  return value as unknown as VaultHeader;
}
const aad = (owner: string, id: string, purpose: string) => encoder.encode(JSON.stringify(['dynamic-diary-vault', 1, owner, id, purpose]));
function phrase(secret: string) { if (typeof secret !== 'string' || [...secret].length < 12 || encoder.encode(secret).length > 1024) throw new Error('Use uma frase exclusiva de pelo menos 12 caracteres (máximo de 1.024 bytes).'); }
async function passwordKey(secret: string, salt: string): Promise<CryptoKey> {
  phrase(secret);
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt, 16), iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, associated: Uint8Array<ArrayBuffer>): Promise<CipherEnvelope> {
  if (bytes.length > MAX_CIPHER_BYTES - 16) throw new Error('Conteúdo excede o limite do cofre.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { v: 1, iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associated, tagLength: 128 }, key, bytes)) };
}
async function decrypt(key: CryptoKey, envelope: CipherEnvelope, associated: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const { iv, data } = parseCipher(envelope);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: associated, tagLength: 128 }, key, data));
}
export class VaultSession {
  constructor(readonly ownerId: string, readonly header: VaultHeader, private key: CryptoKey | null) {}
  private available() { if (!this.key) throw new Error('Cofre bloqueado.'); return this.key; }
  async seal(value: string | ArrayBuffer, purpose: string) {
    const envelope = await encrypt(this.available(), typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value), aad(this.ownerId, this.header.id, purpose)); this.available(); return envelope;
  }
  async openBytes(envelope: CipherEnvelope, purpose: string): Promise<ArrayBuffer> {
    const value = await decrypt(this.available(), envelope, aad(this.ownerId, this.header.id, purpose)); this.available(); return value.buffer;
  }
  async openText(envelope: CipherEnvelope, purpose: string) { return decoder.decode(await this.openBytes(envelope, purpose)); }
  /** Structured-clone this non-extractable handle into IndexedDB; never export raw key bytes. */
  deviceKeyForStorage() { return validateDeviceKey(this.available()); }
  dispose() { this.key = null; }
}
function validateDeviceKey(key: CryptoKey) {
  if (!key || key.type !== 'secret' || key.extractable !== false || key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256 || [...key.usages].sort().join(',') !== 'decrypt,encrypt') throw new Error('Chave deste navegador inválida.');
  return key;
}
export function sessionFromDeviceKey(ownerId: string, header: VaultHeader, key: CryptoKey) {
  if (!ownerId) throw new Error('Conta inválida.');
  return new VaultSession(ownerId, validateHeader(header), validateDeviceKey(key));
}
export async function createVault(ownerId: string, secret: string): Promise<{ header: VaultHeader; session: VaultSession; recoveryKey: string }> {
  phrase(secret); if (!ownerId) throw new Error('Conta inválida.');
  const raw = crypto.getRandomValues(new Uint8Array(32)), recovery = crypto.getRandomValues(new Uint8Array(32));
  try {
    const header: VaultHeader = { format: 'dynamic-diary-vault', version: 1, id: crypto.randomUUID(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: b64(crypto.getRandomValues(new Uint8Array(16))) }, password: null!, recovery: null! };
    const recoveryKey = Array.from(recovery, b => b.toString(16).padStart(2, '0')).join('').match(/.{8}/g)!.join('-');
    const [kek, recoveryKek] = await Promise.all([passwordKey(secret, header.kdf.salt), crypto.subtle.importKey('raw', recovery, 'AES-GCM', false, ['encrypt', 'decrypt'])]);
    header.password = await encrypt(kek, raw, aad(ownerId, header.id, 'password-wrap'));
    header.recovery = await encrypt(recoveryKek, raw, aad(ownerId, header.id, 'recovery-wrap'));
    return { header, recoveryKey, session: new VaultSession(ownerId, header, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])) };
  } finally { raw.fill(0); recovery.fill(0); }
}
async function unwrap(owner: string, header: VaultHeader, key: CryptoKey, purpose: 'password' | 'recovery') {
  const raw = await decrypt(key, header[purpose], aad(owner, header.id, `${purpose}-wrap`));
  try { if (raw.length !== 32) throw new Error('Chave inválida.'); return new VaultSession(owner, header, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])); }
  finally { raw.fill(0); }
}
export async function unlockVault(owner: string, value: unknown, secret: string) {
  const header = validateHeader(value);
  try { return await unwrap(owner, header, await passwordKey(secret, header.kdf.salt), 'password'); } catch { throw new Error('Não foi possível desbloquear o cofre. Confira sua frase.'); }
}
export async function recoverVault(owner: string, value: unknown, recovery: string) {
  const header = validateHeader(value); const normalized = recovery.replaceAll('-', '').trim();
  if (!/^[a-f0-9]{64}$/i.test(normalized)) throw new Error('Não foi possível desbloquear o cofre. Confira a chave de recuperação.');
  const raw = Uint8Array.from(normalized.match(/../g)!, hex => parseInt(hex, 16));
  try { return await unwrap(owner, header, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']), 'recovery'); } catch { throw new Error('Não foi possível desbloquear o cofre. Confira a chave de recuperação.'); } finally { raw.fill(0); }
}

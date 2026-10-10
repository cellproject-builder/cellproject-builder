/** WebCrypto envelope encryption. Raw keys and recovery secrets never go to an API. */
export interface CipherEnvelope { v: 1; iv: string; data: string }
export interface VaultHeader {
  format: 'dynamic-diary-vault'; version: 1; id: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 600000; salt: string };
  password: CipherEnvelope; recovery: CipherEnvelope;
}
export const MAX_CIPHER_BYTES = 96 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
}
export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let value = '';
  for (let i = 0; i < data.length; i += 8192) value += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(value);
}
export function unb64(value: string, limit = MAX_CIPHER_BYTES): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Envelope criptografado inválido.');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length > limit || b64(bytes) !== value) throw new Error('Envelope criptografado inválido.'); return bytes;
}
export function validateCipher(value: unknown, max = MAX_CIPHER_BYTES): CipherEnvelope {
  if (!exact(value, ['v', 'iv', 'data']) || value.v !== 1 || typeof value.iv !== 'string' || typeof value.data !== 'string' || unb64(value.iv, 12).length !== 12 || unb64(value.data, max).length < 16) throw new Error('Envelope criptografado inválido.');
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
  validateCipher(envelope);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv, 12), additionalData: associated, tagLength: 128 }, key, unb64(envelope.data)));
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

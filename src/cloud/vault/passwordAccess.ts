import { cloudJson, mutationHeaders } from '../runtime';
import { b64, unb64, validateCipher, recoverVault, type CipherEnvelope, type VaultHeader, type VaultSession } from './crypto';
import { readDeviceRecovery } from './deviceKeys';

/** An additive wrapper: the canonical vault header and all data keys remain unchanged. */
export interface PasswordAccess {
  format: 'dynamic-diary-password-access'; version: 1; ownerId: string; vaultId: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 600000; salt: string };
  cipher: CipherEnvelope;
}
export type PasswordAccessHead = { access: null } | { access: PasswordAccess; revision: number };
export interface PreparedPasswordAccess { access: PasswordAccess; baseRevision: number; operationId: string; expectedOwnerId: string }
const sameAccess = (a: PasswordAccess, b: PasswordAccess) => JSON.stringify([a.format, a.version, a.ownerId, a.vaultId, a.kdf.name, a.kdf.hash, a.kdf.iterations, a.kdf.salt, a.cipher.v, a.cipher.iv, a.cipher.data]) === JSON.stringify([b.format, b.version, b.ownerId, b.vaultId, b.kdf.name, b.kdf.hash, b.kdf.iterations, b.kdf.salt, b.cipher.v, b.cipher.iv, b.cipher.data]);
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const aad = (owner: string, vault: string) => encoder.encode(JSON.stringify(['dynamic-diary-password-access', 1, owner, vault]));
export function validatePasswordAccess(value: unknown, owner: string, vault: string): PasswordAccess {
  if (!exact(value, ['format', 'version', 'ownerId', 'vaultId', 'kdf', 'cipher']) || value.format !== 'dynamic-diary-password-access' || value.version !== 1 || value.ownerId !== owner || value.vaultId !== vault || !exact(value.kdf, ['name', 'hash', 'iterations', 'salt']) || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== 600000 || typeof value.kdf.salt !== 'string' || unb64(value.kdf.salt, 16).length !== 16) throw new Error('Proteção da senha inválida.');
  validateCipher(value.cipher, 256);
  return value as unknown as PasswordAccess;
}
async function key(password: string, salt: string) {
  const bytes = encoder.encode(password);
  try {
    if ([...password].length < 10 || bytes.length > 72) throw new Error('Use sua senha de login, com pelo menos 10 caracteres e no máximo 72 bytes.');
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: unb64(salt, 16) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}
export async function sealPasswordAccess(session: VaultSession, recovery: string, password: string): Promise<PasswordAccess> {
  // Authenticate the recovery before publishing a new way to open existing data.
  const check = await recoverVault(session.ownerId, session.header, recovery);
  try {
    const probe = await session.seal('password-access-check', 'password-access-check');
    if (await check.openText(probe, 'password-access-check') !== 'password-access-check') throw new Error('A chave não corresponde aos seus dados.');
  } finally { check.dispose(); }
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))), iv = crypto.getRandomValues(new Uint8Array(12)), bytes = encoder.encode(recovery);
  try {
    const cipher = { v: 1 as const, iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(session.ownerId, session.header.id), tagLength: 128 }, await key(password, salt), bytes)) };
    // Reject disposal during the asynchronous KDF/encryption, before returning a wrapper.
    session.deviceKeyForStorage();
    return { format: 'dynamic-diary-password-access', version: 1, ownerId: session.ownerId, vaultId: session.header.id, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, cipher };
  } finally { bytes.fill(0); }
}
export async function openPasswordAccess(owner: string, header: VaultHeader, value: unknown, password: string): Promise<{ session: VaultSession; recovery: string }> {
  const access = validatePasswordAccess(value, owner, header.id);
  let bytes: Uint8Array | undefined;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(access.cipher.iv, 12), additionalData: aad(owner, header.id), tagLength: 128 }, await key(password, access.kdf.salt), unb64(access.cipher.data, 256)));
    const recovery = decoder.decode(bytes);
    return { session: await recoverVault(owner, header, recovery), recovery };
  } catch { throw new Error('A senha não abriu seus dados. Use um aparelho já autorizado para atualizar o acesso.'); }
  finally { bytes?.fill(0); }
}
export async function readPasswordAccess(owner: string, header: VaultHeader, fetcher: typeof fetch = fetch): Promise<PasswordAccessHead> {
  const value = await cloudJson<PasswordAccessHead>('/api/cloud/vault/password-access', {}, fetcher);
  if (exact(value, ['access']) && value.access === null) return value as PasswordAccessHead;
  if (!exact(value, ['access', 'revision']) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) throw new Error('Proteção da senha inválida.');
  validatePasswordAccess(value.access, owner, header.id);
  return value as PasswordAccessHead;
}
export async function preparePasswordAccess(session: VaultSession, password: string, fetcher: typeof fetch = fetch, current?: PasswordAccessHead): Promise<PreparedPasswordAccess | null> {
  const head = current ?? await readPasswordAccess(session.ownerId, session.header, fetcher);
  if (head.access) {
    try { const opened = await openPasswordAccess(session.ownerId, session.header, head.access, password); opened.session.dispose(); return null; } catch { /* A verified new password may replace its previous wrapper using the trusted device. */ }
  }
  const recovery = await readDeviceRecovery(session);
  if (!recovery) throw new Error('Este aparelho usa uma proteção antiga. Seus dados foram preservados; a migração deste acesso precisa ser concluída antes de vincular a senha.');
  const access = await sealPasswordAccess(session, recovery, password);
  const roundtrip = await openPasswordAccess(session.ownerId, session.header, access, password); roundtrip.session.dispose();
  session.deviceKeyForStorage();
  return { access, baseRevision: head.access ? head.revision : 0, operationId: crypto.randomUUID(), expectedOwnerId: session.ownerId };
}
export async function commitPasswordAccess(prepared: PreparedPasswordAccess | null, fetcher: typeof fetch = fetch) {
  if (!prepared) return;
  const result = await cloudJson<{ revision: number }>('/api/cloud/vault/password-access', { method: 'PUT', headers: mutationHeaders, body: JSON.stringify(prepared) }, fetcher);
  if (result.revision !== prepared.baseRevision + 1) throw new Error('A proteção da senha não foi confirmada.');
  const confirmed = await readPasswordAccess(prepared.expectedOwnerId, { id: prepared.access.vaultId } as VaultHeader, fetcher);
  if (!confirmed.access || confirmed.revision < result.revision || !sameAccess(confirmed.access, prepared.access)) throw new Error('A proteção da senha mudou. Seus dados e a chave deste aparelho foram preservados.');
}

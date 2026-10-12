import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { CloudError, invalid } from './cloudUtils.mjs';
import { DOCUMENT_KEYS, documentValue, mediaMetadata, operationId } from './cloudValidation.mjs';
import { validateVaultCipher, validateVaultHeader } from './vaultRepository.mjs';

const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const text = value => Buffer.from(JSON.stringify(value), 'utf8');
const fail = () => new CloudError(400, 'external_capsule_invalid', 'Invalid delegated vault capsule.');
const RECEIPT_LIMIT = 2 * 1024 * 1024;
function binding(value) {
  if (!exact(value, ['ownerId', 'vaultId', 'credentialId']) || ![value.ownerId, value.vaultId, value.credentialId].every(uuid)) throw fail();
  return value;
}
function rawKey(value) { if (!(value instanceof Uint8Array) || value.length !== 32) throw fail(); return Buffer.from(value); }
function serverKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw fail();
  const key = Buffer.from(value, 'base64'); if (key.length !== 32 || key.toString('base64') !== value) throw fail(); return key;
}
function seal(key, bytes, aad, limit = 96 * 1024 * 1024) {
  if (bytes.length + 16 > limit) throw invalid('Encrypted content exceeds the vault limit.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64'), data: data.toString('base64') };
}
function open(key, value, aad, limit = 96 * 1024 * 1024) {
  validateVaultCipher(value, limit);
  const data = Buffer.from(value.data, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(aad); decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
}
const delegationAad = value => { const b = binding(value); return text(['cellproject-external-delegation', 1, b.ownerId, b.vaultId, b.credentialId]); };
const vaultAad = (ownerId, vaultId, purpose) => { if (!uuid(ownerId) || !uuid(vaultId)) throw fail(); return text(['dynamic-diary-vault', 1, ownerId, vaultId, purpose]); };
const receiptAad = (value, id) => { const b = binding(value); operationId(id); return text(['cellproject-external-receipt', 1, b.ownerId, b.vaultId, b.credentialId, id]); };

/** This ephemeral RSA key authenticates browser enrollment; persisted capabilities use the separately configured AES key. */
export async function createEnrollmentKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
  let privateKey = pair.privateKey;
  const keyId = randomUUID(), publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    keyId, publicKey,
    async unwrapEnrollment(capsule, value) {
      const b = binding(value);
      try {
        if (!privateKey || !exact(capsule, ['v', 'keyId', 'data']) || capsule.v !== 1 || capsule.keyId !== keyId || typeof capsule.data !== 'string') throw fail();
        const data = Buffer.from(capsule.data, 'base64'); if (data.length !== 384 || data.toString('base64') !== capsule.data) throw fail();
        const selected = privateKey, label = text(['cellproject-external-enrollment', 1, b.ownerId, b.vaultId, b.credentialId, keyId]);
        const raw = Buffer.from(await webcrypto.subtle.decrypt({ name: 'RSA-OAEP', label }, selected, data));
        if (!privateKey || selected !== privateKey || raw.length !== 32) { raw.fill(0); throw fail(); }
        return raw;
      } catch { throw fail(); }
    },
    close() { privateKey = null; },
  };
}

export function sealDelegatedKey(raw, value, encryptionKey) {
  const key = serverKey(encryptionKey), bytes = rawKey(raw);
  try { return seal(key, bytes, delegationAad(value), 48); } finally { key.fill(0); bytes.fill(0); }
}
export function openDelegatedKey(capsule, value, encryptionKey) {
  const key = serverKey(encryptionKey); let bytes;
  try { bytes = open(key, capsule, delegationAad(value), 48); if (bytes.length !== 32) throw fail(); return bytes; }
  catch { bytes?.fill(0); throw fail(); } finally { key.fill(0); }
}

export function validateExternalManifest(value) {
  if (!exact(value, ['snapshot', 'files']) || !exact(value.snapshot, ['documents', 'media']) || !Array.isArray(value.snapshot.documents) || value.snapshot.documents.length > DOCUMENT_KEYS.size || !Array.isArray(value.snapshot.media) || value.snapshot.media.length > 100_000 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw invalid('Invalid encrypted vault manifest.');
  const documents = new Set(), media = new Set();
  for (const doc of value.snapshot.documents) {
    if (!exact(doc, ['key', 'value', 'revision']) || documents.has(doc.key) || !Number.isSafeInteger(doc.revision) || doc.revision < 1) throw invalid('Invalid vault document.');
    documentValue(doc.key, doc.value); documents.add(doc.key);
  }
  for (const item of value.snapshot.media) {
    const metadata = mediaMetadata(item);
    if (media.has(metadata.id) || !Object.hasOwn(value.files, metadata.id)) throw invalid('Invalid private media catalog.');
    const file = value.files[metadata.id];
    if (!exact(file, ['blobId', 'sha256', 'size']) || !uuid(file.blobId) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 15 * 1024 * 1024) throw invalid('Invalid private media catalog.');
    media.add(metadata.id);
  }
  if (Object.keys(value.files).length !== media.size) throw invalid('Invalid private media catalog.');
  return value;
}
export function openVaultManifest(raw, ownerId, head) {
  if (!exact(head, ['header', 'revision', 'manifest']) || !Number.isSafeInteger(head.revision) || head.revision < 1) throw invalid('Invalid vault head.');
  const header = validateVaultHeader(head.header), key = rawKey(raw); let bytes;
  try { bytes = open(key, head.manifest, vaultAad(ownerId, header.id, `manifest:${head.revision}`)); return validateExternalManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  finally { key.fill(0); bytes?.fill(0); }
}
export function sealVaultManifest(raw, ownerId, vaultId, revision, manifest) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw invalid('Invalid vault revision.');
  validateExternalManifest(manifest); const key = rawKey(raw), bytes = text(manifest);
  try { return seal(key, bytes, vaultAad(ownerId, vaultId, `manifest:${revision}`)); } finally { key.fill(0); bytes.fill(0); }
}
export function sealPrivateMedia(raw, ownerId, vaultId, blobId, value) {
  if (!uuid(blobId) || !(value instanceof Uint8Array || value instanceof ArrayBuffer)) throw invalid('Invalid private media.');
  const key = rawKey(raw), bytes = value instanceof ArrayBuffer ? Buffer.from(new Uint8Array(value)) : Buffer.from(value);
  try { return seal(key, bytes, vaultAad(ownerId, vaultId, `media:${blobId}`), 10 * 1024 * 1024 + 16); } finally { key.fill(0); bytes.fill(0); }
}
export function openPrivateMedia(raw, ownerId, vaultId, blobId, envelope) {
  if (!uuid(blobId)) throw invalid('Invalid private media ID.');
  const key = rawKey(raw);
  try { return open(key, envelope, vaultAad(ownerId, vaultId, `media:${blobId}`), 10 * 1024 * 1024 + 16); } finally { key.fill(0); }
}
export const sealVaultMedia = sealPrivateMedia, openVaultMedia = openPrivateMedia;
export function sealReceipt(raw, value, id, receipt) {
  const key = rawKey(raw), bytes = text(receipt);
  try { return seal(key, bytes, receiptAad(value, id), RECEIPT_LIMIT); } finally { key.fill(0); bytes.fill(0); }
}
export function openReceipt(raw, value, id, receipt) {
  const key = rawKey(raw); let bytes;
  try { bytes = open(key, receipt, receiptAad(value, id), RECEIPT_LIMIT); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  finally { key.fill(0); bytes?.fill(0); }
}
function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 80 || value === undefined || typeof value === 'function' || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'number' && !Number.isFinite(value)) throw invalid('Invalid action fingerprint input.');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw invalid('Invalid action fingerprint input.'); seen.add(value);
  try {
    if (Array.isArray(value)) return '[' + value.map(item => canonical(item, seen, depth + 1)).join(',') + ']';
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw invalid('Invalid action fingerprint input.');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], seen, depth + 1)).join(',') + '}';
  } finally { seen.delete(value); }
}
export function fingerprintExternalRequest(value, encryptionKey) {
  const key = serverKey(encryptionKey);
  try { return createHmac('sha256', key).update('cellproject-external-request:v1\0').update(canonical(value)).digest('hex'); } finally { key.fill(0); }
}

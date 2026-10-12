import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomBytes } from 'node:crypto';

const module = await import('./externalVault.mjs').catch(() => ({}));
const ownerId = '11111111-1111-4111-8111-111111111111', vaultId = '22222222-2222-4222-8222-222222222222', credentialId = '33333333-3333-4333-8333-333333333333';
const binding = { ownerId, vaultId, credentialId }, serverKey = Buffer.alloc(32, 9).toString('base64');
const manifest = { snapshot: { documents: [{ key: 'cellproject-workspace', value: '{"state":{"projects":{}},"version":2}', revision: 1 }], media: [] }, files: {} };
const placeholder = { v: 1, iv: Buffer.alloc(12).toString('base64'), data: Buffer.alloc(48).toString('base64') };
const header = { format: 'dynamic-diary-vault', version: 1, id: vaultId, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16).toString('base64') }, password: placeholder, recovery: placeholder };

test('browser enrollment RSA capsule authenticates owner, vault, credential and server key identity', async () => {
  assert.equal(typeof module.createEnrollmentKeys, 'function');
  const keys = await module.createEnrollmentKeys(), raw = randomBytes(32);
  try {
    const publicKey = await webcrypto.subtle.importKey('jwk', keys.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const label = Buffer.from(JSON.stringify(['cellproject-external-enrollment', 1, ownerId, vaultId, credentialId, keys.keyId]));
    const data = Buffer.from(await webcrypto.subtle.encrypt({ name: 'RSA-OAEP', label }, publicKey, raw)).toString('base64');
    const capsule = { v: 1, keyId: keys.keyId, data };
    assert.deepEqual(await keys.unwrapEnrollment(capsule, binding), raw);
    for (const changed of [{ ...binding, ownerId: credentialId }, { ...binding, vaultId: credentialId }, { ...binding, credentialId: vaultId }]) await assert.rejects(keys.unwrapEnrollment(capsule, changed), /delegat|capsul|enroll/i);
    await assert.rejects(keys.unwrapEnrollment({ ...capsule, keyId: vaultId }, binding));
    keys.close();
    await assert.rejects(keys.unwrapEnrollment(capsule, binding));
  } finally { keys.close(); raw.fill(0); }
});

test('delegated keys are sealed at rest with per-credential binding and reject tamper or wrong server key', () => {
  assert.equal(typeof module.sealDelegatedKey, 'function');
  const raw = randomBytes(32), sealed = module.sealDelegatedKey(raw, binding, serverKey);
  assert.deepEqual(module.openDelegatedKey(sealed, binding, serverKey), raw);
  assert.notDeepEqual(module.sealDelegatedKey(raw, binding, serverKey), sealed);
  assert.throws(() => module.openDelegatedKey(sealed, { ...binding, credentialId: vaultId }, serverKey));
  assert.throws(() => module.openDelegatedKey(sealed, binding, Buffer.alloc(32, 4).toString('base64')));
  const damaged = Buffer.from(sealed.data, 'base64'); damaged[0] ^= 1;
  assert.throws(() => module.openDelegatedKey({ ...sealed, data: damaged.toString('base64') }, binding, serverKey));
  assert.throws(() => module.sealDelegatedKey(Buffer.alloc(31), binding, serverKey));
  assert.throws(() => module.openDelegatedKey({ ...sealed, secret: 'plaintext' }, binding, serverKey));
});

test('server vault manifests interoperate with browser AES-GCM AAD and validate catalog integrity', async () => {
  assert.equal(typeof module.openVaultManifest, 'function');
  const raw = randomBytes(32), key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const iv = randomBytes(12), additionalData = Buffer.from(JSON.stringify(['dynamic-diary-vault', 1, ownerId, vaultId, 'manifest:7']));
  const browser = { v: 1, iv: iv.toString('base64'), data: Buffer.from(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, Buffer.from(JSON.stringify(manifest)))).toString('base64') };
  assert.deepEqual(module.openVaultManifest(raw, ownerId, { header, revision: 7, manifest: browser }), manifest);
  const server = module.sealVaultManifest(raw, ownerId, vaultId, 8, manifest);
  assert.equal(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(server.iv, 'base64'), additionalData: Buffer.from(JSON.stringify(['dynamic-diary-vault', 1, ownerId, vaultId, 'manifest:8'])) }, key, Buffer.from(server.data, 'base64'))).toString(), JSON.stringify(manifest));
  assert.throws(() => module.openVaultManifest(raw, ownerId, { header, revision: 8, manifest: browser }));
  assert.throws(() => module.sealVaultManifest(raw, ownerId, vaultId, 8, { ...manifest, files: { orphan: { blobId: credentialId, sha256: 'a'.repeat(64), size: 40 } } }));
  assert.throws(() => module.sealVaultManifest(raw, ownerId, vaultId, 8, { snapshot: { ...manifest.snapshot, documents: [...manifest.snapshot.documents, manifest.snapshot.documents[0]] }, files: {} }));
});

test('logical receipts are ciphertext bound to credential and operation and request fingerprints are keyed canonical JSON', () => {
  assert.equal(typeof module.sealReceipt, 'function');
  const raw = randomBytes(32), value = { result: { text: 'PRIVATE_RESULT' }, revision: 2 };
  const sealed = module.sealReceipt(raw, binding, 'operation-1', value);
  assert.deepEqual(module.openReceipt(raw, binding, 'operation-1', sealed), value);
  assert.doesNotMatch(JSON.stringify(sealed), /PRIVATE_RESULT/);
  assert.throws(() => module.openReceipt(raw, binding, 'operation-2', sealed));
  assert.throws(() => module.openReceipt(raw, { ...binding, credentialId: vaultId }, 'operation-1', sealed));
  const first = module.fingerprintExternalRequest({ operation: 'set', args: { b: 2, a: 1 } }, serverKey);
  assert.equal(first, module.fingerprintExternalRequest({ args: { a: 1, b: 2 }, operation: 'set' }, serverKey));
  assert.notEqual(first, module.fingerprintExternalRequest({ operation: 'set', args: { b: 3, a: 1 } }, serverKey));
  assert.notEqual(first, module.fingerprintExternalRequest({ operation: 'set', args: { b: 2, a: 1 } }, Buffer.alloc(32, 4).toString('base64')));
  assert.throws(() => module.fingerprintExternalRequest({ invalid: undefined }, serverKey));
});

test('private media decrypts with the existing browser blob AAD and refuses cross-blob transplantation', async () => {
  assert.equal(typeof module.sealPrivateMedia, 'function');
  const raw = randomBytes(32), bytes = Buffer.from('PRIVATE_ATTACHMENT'), blobId = credentialId;
  const envelope = module.sealPrivateMedia(raw, ownerId, vaultId, blobId, bytes);
  assert.deepEqual(module.openPrivateMedia(raw, ownerId, vaultId, blobId, envelope), bytes);
  const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const browser = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64'), additionalData: Buffer.from(JSON.stringify(['dynamic-diary-vault', 1, ownerId, vaultId, `media:${blobId}`])) }, key, Buffer.from(envelope.data, 'base64'));
  assert.deepEqual(Buffer.from(browser), bytes);
  assert.throws(() => module.openPrivateMedia(raw, ownerId, vaultId, vaultId, envelope));
  assert.throws(() => module.sealPrivateMedia(raw, ownerId, vaultId, blobId, Buffer.alloc(10 * 1024 * 1024 + 1)));
});

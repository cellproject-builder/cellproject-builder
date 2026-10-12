import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { hash } from './cloudValidation.mjs';

const module = await import('./externalMedia.mjs').catch(() => ({}));
const ownerId = '11111111-1111-4111-8111-111111111111', vaultId = '22222222-2222-4222-8222-222222222222';
const credential = { id: '33333333-3333-4333-8333-333333333333', ownerId, vaultId, projects: '*', permissions: ['read', 'write'] };
const original = Buffer.from('PRIVATE_ORIGINAL_MEDIA_BYTES with accent á and binary\0tail');
const initial = () => ({ snapshot: { documents: [{ key: 'cellproject-workspace', revision: 1, value: '{"state":{"projects":{"p1":{},"p2":{}}},"version":2}' }], media: [] }, files: {} });
const putInput = (id = 'media1', bytes = original) => ({ id, name: 'original.txt', mime: 'text/plain', base64: bytes.toString('base64'), sha256: hash(bytes), createdAt: 123 });

function fixture() {
  assert.equal(typeof module.executeExternalMedia, 'function');
  const blobs = new Map(), writes = [], reads = [], rawKey = Buffer.alloc(32, 91);
  const repository = {
    async writeBlob(_credential, input) { writes.push(input); blobs.set(input.id, Buffer.from(input.base64, 'base64')); return { id: input.id }; },
    async readBlob(_credential, input) { reads.push(input); if (!blobs.has(input.id)) throw Error('PRIVATE_STORAGE_DETAIL'); return Buffer.from(blobs.get(input.id)); },
  };
  const invoke = (manifest, kind, name, input = {}, projectId = name.startsWith('personal_media.') ? null : 'p1', grant = credential) => module.executeExternalMedia({ repository, credential: grant, manifest, rawKey, operation: { kind, name, input }, projectId });
  return { repository, blobs, writes, reads, rawKey, invoke };
}

test('original media roundtrips through browser-compatible encrypted bytes without mutating unrelated manifest state', async () => {
  const f = fixture(), before = initial(), saved = structuredClone(before);
  const uploaded = await f.invoke(before, 'action', 'media.put', putInput());
  assert.deepEqual(before, saved); assert.deepEqual(uploaded.manifest.snapshot.documents, before.snapshot.documents);
  assert.deepEqual(uploaded.result.metadata, { id: 'media1', name: 'original.txt', mime: 'text/plain', projectId: 'p1', createdAt: 123, size: original.length, sha256: hash(original) });
  const file = uploaded.manifest.files.media1, sent = f.writes[0], encrypted = f.blobs.get(file.blobId);
  assert.match(file.blobId, /^[a-f0-9-]{36}$/); assert.equal(file.sha256, hash(encrypted)); assert.equal(file.size, encrypted.length);
  assert.equal(sent.id, file.blobId); assert.equal(sent.projectId, 'p1'); assert.equal(sent.accountOperation, false);
  assert.equal(sent.sha256, file.sha256); assert.doesNotMatch(encrypted.toString(), /PRIVATE_ORIGINAL_MEDIA_BYTES/);
  const cipher = JSON.parse(encrypted), key = await webcrypto.subtle.importKey('raw', f.rawKey, 'AES-GCM', false, ['decrypt']);
  const decrypted = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(cipher.iv, 'base64'), additionalData: Buffer.from(JSON.stringify(['dynamic-diary-vault', 1, ownerId, vaultId, `media:${file.blobId}`])) }, key, Buffer.from(cipher.data, 'base64'));
  assert.deepEqual(Buffer.from(decrypted), original);
  const read = await f.invoke(uploaded.manifest, 'query', 'media.read', { id: 'media1' });
  assert.deepEqual(read.result.metadata, uploaded.result.metadata); assert.equal(read.result.base64, original.toString('base64'));
  assert.deepEqual(read.manifest, uploaded.manifest); assert.equal(f.reads[0].id, file.blobId);
});

test('media reads, replacements and deletes cannot cross project ownership or credential grants', async () => {
  const f = fixture(), first = await f.invoke(initial(), 'action', 'media.put', putInput());
  for (const [kind, name, input] of [['query', 'media.read', { id: 'media1' }], ['action', 'media.put', putInput()], ['action', 'media.delete', { id: 'media1' }]]) {
    await assert.rejects(f.invoke(first.manifest, kind, name, input, 'p2'), error => error.status === 403 || error.status === 404);
  }
  await assert.rejects(f.invoke(first.manifest, 'query', 'media.read', { id: 'media1' }, 'p1', { ...credential, projects: ['p2'] }), error => error.status === 403);
  await assert.rejects(f.invoke(first.manifest, 'action', 'media.put', putInput('new'), 'p1', { ...credential, permissions: ['read'] }), error => error.status === 403);
  assert.equal(f.writes.length, 1); assert.equal(f.reads.length, 0);
  const replaced = await f.invoke(first.manifest, 'action', 'media.put', putInput('media1', Buffer.from('replacement')));
  assert.notEqual(replaced.manifest.files.media1.blobId, first.manifest.files.media1.blobId);
  assert.equal(replaced.manifest.snapshot.media.length, 1); assert.equal(first.manifest.snapshot.media[0].sha256, hash(original));
});

test('paginated media lists isolate each project and personal assets', async () => {
  const f = fixture(); let manifest = initial();
  for (const [id, projectId, prefix] of [['a', 'p1', 'media'], ['b', 'p1', 'media'], ['c', 'p2', 'media'], ['personal', undefined, 'personal_media']]) {
    manifest = (await f.invoke(manifest, 'action', `${prefix}.put`, putInput(id), projectId)).manifest;
  }
  const first = await f.invoke(manifest, 'query', 'media.list', { offset: 0, limit: 1 });
  assert.deepEqual(first.result, { items: [manifest.snapshot.media[0]], total: 2, offset: 0, nextOffset: 1 });
  const next = await f.invoke(manifest, 'query', 'media.list', { offset: 1, limit: 1 });
  assert.deepEqual(next.result.items.map(item => item.id), ['b']); assert.equal(next.result.nextOffset, null);
  const personal = await f.invoke(manifest, 'query', 'personal_media.list', {}, undefined);
  assert.deepEqual(personal.result.items.map(item => item.id), ['personal']);
  const personalRead = await f.invoke(manifest, 'query', 'personal_media.read', { id: 'personal' }, undefined);
  assert.equal(personalRead.result.base64, original.toString('base64'));
  assert.equal(f.reads.at(-1).projectId, null); assert.equal(f.reads.at(-1).accountOperation, true);
  await assert.rejects(f.invoke(manifest, 'query', 'personal_media.read', { id: 'a' }, undefined), error => error.status === 403 || error.status === 404);
  await assert.rejects(f.invoke(manifest, 'query', 'personal_media.list', {}, undefined, { ...credential, projects: ['p1'] }), error => error.status === 403);
});

test('invalid hash, noncanonical base64, unsupported mime, identity extras and image size reject before storage', async () => {
  const f = fixture(), before = initial();
  const largeImage = Buffer.alloc(5 * 1024 * 1024 + 1);
  for (const input of [
    { ...putInput(), sha256: 'a'.repeat(64) }, { ...putInput(), base64: 'YQ' },
    { ...putInput(), mime: 'image/svg+xml' }, { ...putInput(), projectId: 'p2' },
    { ...putInput(), url: 'https://evil.test/private' }, { ...putInput(), size: 1 },
    { ...putInput('image', largeImage), mime: 'image/png' },
  ]) await assert.rejects(f.invoke(before, 'action', 'media.put', input), error => error.status === 400);
  assert.equal(f.writes.length, 0); assert.deepEqual(before, initial());
});

test('ciphertext damage, descriptor mismatch and decrypted hash mismatch never return original bytes', async () => {
  const f = fixture(), uploaded = await f.invoke(initial(), 'action', 'media.put', putInput());
  const descriptor = uploaded.manifest.files.media1, encrypted = Buffer.from(f.blobs.get(descriptor.blobId));
  f.blobs.set(descriptor.blobId, Buffer.from('{}'));
  await assert.rejects(f.invoke(uploaded.manifest, 'query', 'media.read', { id: 'media1' }), error => error.code === 'media_corrupt');
  f.blobs.set(descriptor.blobId, encrypted);
  const wrongSize = structuredClone(uploaded.manifest); wrongSize.files.media1.size++;
  await assert.rejects(f.invoke(wrongSize, 'query', 'media.read', { id: 'media1' }), error => error.code === 'media_corrupt');
  const wrongPlainHash = structuredClone(uploaded.manifest); wrongPlainHash.snapshot.media[0].sha256 = 'a'.repeat(64);
  await assert.rejects(f.invoke(wrongPlainHash, 'query', 'media.read', { id: 'media1' }), error => error.code === 'media_corrupt');
  const cipher = JSON.parse(encrypted); const bytes = Buffer.from(cipher.data, 'base64'); bytes[0] ^= 1; cipher.data = bytes.toString('base64');
  const damaged = Buffer.from(JSON.stringify(cipher)), wrongTag = structuredClone(uploaded.manifest);
  f.blobs.set(descriptor.blobId, damaged); wrongTag.files.media1 = { ...descriptor, size: damaged.length, sha256: hash(damaged) };
  await assert.rejects(f.invoke(wrongTag, 'query', 'media.read', { id: 'media1' }), error => error.code === 'media_corrupt' && !error.message.includes('PRIVATE'));
});

test('delete refuses document references and preserves other media and immutable blob bytes', async () => {
  const f = fixture(); let manifest = (await f.invoke(initial(), 'action', 'media.put', putInput('target'))).manifest;
  manifest = (await f.invoke(manifest, 'action', 'media.put', putInput('keep'), 'p2')).manifest;
  const linked = structuredClone(manifest); linked.snapshot.documents[0].value = '{"state":{"projects":{"p1":{},"p2":{}},"note":{"mediaId":"target"}},"version":2}';
  await assert.rejects(f.invoke(linked, 'action', 'media.delete', { id: 'target' }), error => error.status === 409 && error.code === 'media_referenced');
  const saved = structuredClone(manifest), result = await f.invoke(manifest, 'action', 'media.delete', { id: 'target' });
  assert.equal(result.result.deleted, true); assert.deepEqual(manifest, saved);
  assert.deepEqual(result.manifest.snapshot.media.map(item => item.id), ['keep']);
  assert.deepEqual(result.manifest.files, { keep: manifest.files.keep });
  assert.deepEqual(result.manifest.snapshot.documents, manifest.snapshot.documents);
  assert.equal(f.blobs.size, 2);
});

test('failed immutable upload leaves manifest unchanged and sanitizes storage exceptions', async () => {
  const f = fixture(), before = initial(), saved = structuredClone(before);
  f.repository.writeBlob = async () => { throw Error('PRIVATE_STORAGE_DETAIL'); };
  await assert.rejects(f.invoke(before, 'action', 'media.put', putInput()), error => error.status === 502 && !error.message.includes('PRIVATE_STORAGE_DETAIL'));
  assert.deepEqual(before, saved);
});

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from './cloudValidation.mjs';
import { buildExternalWorker } from '../scripts/build-external-worker.mjs';

let module;
before(async () => { await buildExternalWorker(); module = await import('./externalBackup.mjs').catch(() => ({})); });
const credential = { id: '33333333-3333-4333-8333-333333333333', ownerId: '11111111-1111-4111-8111-111111111111', vaultId: '22222222-2222-4222-8222-222222222222', projects: '*', permissions: ['read', 'write'] };
const initial = () => ({ snapshot: { documents: [], media: [] }, files: {} });
function fixture() {
  const rawKey = Buffer.alloc(32, 39), blobs = new Map(), writes = [], reads = [];
  const repository = { async writeBlob(_credential, input) { writes.push(input); blobs.set(input.id, Buffer.from(input.base64, 'base64')); }, async readBlob(_credential, input) { reads.push(input); if (!blobs.has(input.id)) throw Error('PRIVATE_BUCKET_DETAIL'); return Buffer.from(blobs.get(input.id)); } };
  const call = (manifest, name, input = {}, grant = credential, projectId) => { assert.equal(typeof module.executeExternalBackup, 'function'); return module.executeExternalBackup({ repository, credential: grant, manifest, rawKey, projectId, operation: { kind: ['backup.media.stage', 'backup.document.stage', 'backup.import'].includes(name) ? 'action' : 'query', name, input } }); };
  return { rawKey, blobs, writes, reads, call };
}
const put = (id = 'original', bytes = Buffer.from('private original')) => ({ id, name: 'Original.txt', mime: 'text/plain', projectId: 'planner:legacy-plan', createdAt: 5, sha256: hash(bytes), base64: bytes.toString('base64') });

test('backup operations are explicit account-only strict capabilities', async () => {
  const f = fixture(); assert.equal(module.externalBackupCatalog.length, 6);
  for (const item of module.externalBackupCatalog) { assert.equal(item.scope, 'account'); assert.equal(item.projectRequired, false); assert.equal(item.inputSchema.additionalProperties, false); }
  for (const name of ['backup.manifest', 'backup.media.stage', 'backup.import']) await assert.rejects(f.call(initial(), name, {}, { ...credential, projects: ['p1'] }), error => error.status === 403);
  await assert.rejects(f.call(initial(), 'backup.manifest', {}, credential, 'p1'), error => error.status === 400);
});

test('staging encrypts originals but publishes no media, and final import preserves unrelated data', async () => {
  const f = fixture(), manifest = initial(), staged = await f.call(manifest, 'backup.media.stage', put());
  assert.deepEqual(staged.manifest, manifest); assert.equal(staged.manifest.snapshot.media.length, 0);
  assert.doesNotMatch(f.blobs.get(staged.result.descriptor.blobId).toString(), /private original/);
  assert.equal(f.writes[0].accountOperation, true); assert.equal(f.writes[0].projectId, null);
  const documents = [{ key: 'dynamic_diary-theme', value: 'light' }], media = [staged.result];
  const header = await module.createExternalBackupHeader(documents, media.map(item => item.metadata), 5);
  const imported = await f.call(manifest, 'backup.import', { ...header, documents, media });
  assert.equal(imported.manifest.snapshot.media[0].projectId, 'planner:legacy-plan'); assert.equal(imported.manifest.snapshot.documents[0].revision, 1);
  const read = await f.call(imported.manifest, 'backup.media.read', { id: 'original' }); assert.equal(read.result.base64, put().base64);
  const again = await f.call(imported.manifest, 'backup.import', { ...header, documents, media }); assert.deepEqual(again.manifest, imported.manifest);
  const different = [{ key: 'dynamic_diary-theme', value: 'dark' }], differentHeader = await module.createExternalBackupHeader(different, media.map(item => item.metadata), 5);
  await assert.rejects(f.call(imported.manifest, 'backup.import', { ...differentHeader, documents: different, media }), error => error.status === 409);
});

test('manifest and document chunks allow bounded export with deterministic archive hash', async () => {
  const f = fixture(), manifest = initial(); manifest.snapshot.documents.push({ key: 'dynamic_diary-theme', value: 'a'.repeat(100), revision: 7 });
  const info = await f.call(manifest, 'backup.manifest'); assert.equal(info.result.documents[0].length, 100); assert.equal(info.result.documents[0].sha256, hash(Buffer.from('a'.repeat(100))));
  const chunk = await f.call(manifest, 'backup.document', { key: 'dynamic_diary-theme', offset: 10, limit: 20 }); assert.deepEqual(chunk.result, { key: 'dynamic_diary-theme', value: 'a'.repeat(20), offset: 10, total: 100, nextOffset: 30, sha256: hash(Buffer.from('a'.repeat(100))) });
  await assert.rejects(f.call(manifest, 'backup.document', { key: 'unknown' }), error => error.status === 400);
});

test('import verifies shared notebook validation, manifest hash and provider credential exclusion atomically', async () => {
  const f = fixture();
  const bad = [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state: { projects: {}, tasks: {}, sprints: {}, folders: {}, notes: { n: { canvas: { version: 99 } } } } }) }];
  const header = await module.createExternalBackupHeader(bad, [], 5);
  await assert.rejects(f.call(initial(), 'backup.import', { ...header, documents: bad, media: [] }), error => error.status === 400);
  const credentialDoc = [{ key: 'cellproject-config', value: '{"version":1,"state":{"providers":{"openai":{"apiKey":"private"}}}}' }];
  const credentialsHeader = await module.createExternalBackupHeader(credentialDoc, [], 5);
  await assert.rejects(f.call(initial(), 'backup.import', { ...credentialsHeader, documents: credentialDoc, media: [] }), error => error.status === 400);
  await assert.rejects(f.call(initial(), 'backup.import', { ...header, manifestHash: '0'.repeat(64), documents: [], media: [] }), error => error.status === 400);
  assert.equal(f.writes.length, 0);
});

test('corrupted staged bytes, forged descriptors and unsupported originals never publish', async () => {
  const f = fixture(), staged = await f.call(initial(), 'backup.media.stage', put()), header = await module.createExternalBackupHeader([], [staged.result.metadata], 5);
  f.blobs.set(staged.result.descriptor.blobId, Buffer.from('{}'));
  await assert.rejects(f.call(initial(), 'backup.import', { ...header, documents: [], media: [staged.result] }), error => error.code === 'backup_media_corrupt');
  await assert.rejects(f.call(initial(), 'backup.media.stage', { ...put(), mime: 'image/svg+xml' }), error => error.status === 400);
  await assert.rejects(f.call(initial(), 'backup.media.stage', { ...put(), sha256: '0'.repeat(64) }), error => error.status === 400);
  assert.equal(f.writes.length, 1);
});

test('backup interoperates with browser property order and every allowed original-media ID', async () => {
  const f = fixture(), staged = await f.call(initial(), 'backup.media.stage', put('original:v1.txt'));
  const old = staged.result.metadata;
  const metadata = { mime: old.mime, name: old.name, id: old.id, createdAt: old.createdAt, projectId: old.projectId, size: old.size, sha256: old.sha256 };
  const documents = [{ value: 'light', key: 'dynamic_diary-theme' }], header = await module.createExternalBackupHeader(documents, [metadata], 5);
  const imported = await f.call(initial(), 'backup.import', { ...header, documents, media: [{ metadata, descriptor: staged.result.descriptor }] });
  const read = await f.call(imported.manifest, 'backup.media.read', { id: metadata.id }); assert.equal(read.result.metadata.id, 'original:v1.txt');
  for (const id of ['.', '..', '../traversal']) await assert.rejects(f.call(initial(), 'backup.media.stage', put(id)), error => error.status === 400);
});

async function stageDocument(f, key, value, chunkSize = 8 * 1024 * 1024, grant = credential) {
  const bytes = Buffer.from(value), parts = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const part = bytes.subarray(offset, offset + chunkSize);
    const staged = await f.call(initial(), 'backup.document.stage', { key, base64: part.toString('base64'), sha256: hash(part) }, grant);
    assert.deepEqual(staged.manifest, initial()); assert.equal(staged.result.key, key);
    const { descriptor, sha256, size } = staged.result; parts.push({ descriptor, sha256, size });
    assert.doesNotMatch(f.blobs.get(descriptor.blobId).toString(), /large private document/);
  }
  return { key, parts, sha256: hash(bytes), size: bytes.length };
}

test('four encrypted document chunks import a full 32 MiB UI document without publishing staged parts', async () => {
  const f = fixture(), base = JSON.stringify({ version: 1, state: { text: 'large private document' } });
  const value = base.replace('large private document', 'x'.repeat(32 * 1024 * 1024 - Buffer.byteLength(base) + 'large private document'.length));
  assert.equal(Buffer.byteLength(value), 32 * 1024 * 1024);
  const document = await stageDocument(f, 'cellproject-kb', value); assert.equal(document.parts.length, 4);
  const header = await module.createExternalBackupHeader([{ key: document.key, value }], [], 5);
  const manifest = initial(); manifest.snapshot.documents.push({ key: 'dynamic_diary-theme', value: 'dark', revision: 8 });
  const out = await f.call(manifest, 'backup.import', { ...header, documents: [document], media: [] });
  assert.equal(out.manifest.snapshot.documents.find(item => item.key === document.key).value, value);
  assert.equal(out.manifest.snapshot.documents.find(item => item.key === document.key).revision, 1);
  assert.deepEqual(out.manifest.snapshot.documents[0], manifest.snapshot.documents[0]);
  assert.equal(out.manifest.snapshot.media.length, 0); assert.deepEqual(out.manifest.files, {});
  assert.ok(JSON.stringify({ ...header, documents: [document], media: [] }).length < 4096);
});

test('document chunk import validates order, full hash, UTF-8, owner binding and duplicate keys before publishing', async () => {
  const f = fixture(), value = JSON.stringify({ version: 1, state: { text: '測試😀 measured torque' } });
  const bytes = Buffer.from(value), split = bytes.indexOf(Buffer.from('😀')) + 1, parts = [];
  for (const part of [bytes.subarray(0, split), bytes.subarray(split)]) {
    const staged = await f.call(initial(), 'backup.document.stage', { key: 'cellproject-kb', base64: part.toString('base64'), sha256: hash(part) });
    const { descriptor, sha256, size } = staged.result; parts.push({ descriptor, sha256, size });
  }
  const document = { key: 'cellproject-kb', parts, sha256: hash(bytes), size: bytes.length }, header = await module.createExternalBackupHeader([{ key: document.key, value }], [], 5);
  const request = documents => ({ ...header, documents, media: [] });
  assert.equal((await f.call(initial(), 'backup.import', request([document]))).manifest.snapshot.documents[0].value, value);
  for (const bad of [{ ...document, parts: [...parts].reverse() }, { ...document, sha256: '0'.repeat(64) }, { ...document, parts: [parts[0], parts[0]], size: parts[0].size * 2 }]) await assert.rejects(f.call(initial(), 'backup.import', request([bad])), error => error.code === 'backup_document_corrupt');
  const beforeReads = f.reads.length;
  await assert.rejects(f.call(initial(), 'backup.import', request([document, document])), error => error.status === 400); assert.equal(f.reads.length, beforeReads);
  const foreign = await stageDocument(f, document.key, value, 8 * 1024 * 1024, { ...credential, ownerId: '44444444-4444-4444-8444-444444444444' });
  await assert.rejects(f.call(initial(), 'backup.import', request([foreign])), error => error.code === 'backup_document_corrupt');
  const invalid = Buffer.from([0xc3, 0x28]), staged = await f.call(initial(), 'backup.document.stage', { key: 'dynamic_diary-theme', base64: invalid.toString('base64'), sha256: hash(invalid) });
  await assert.rejects(f.call(initial(), 'backup.import', request([{ key: staged.result.key, parts: [{ descriptor: staged.result.descriptor, sha256: staged.result.sha256, size: staged.result.size }], sha256: hash(invalid), size: invalid.length }])), error => error.code === 'backup_document_corrupt');
  f.blobs.set(parts[0].descriptor.blobId, Buffer.from('{}'));
  await assert.rejects(f.call(initial(), 'backup.import', request([document])), error => error.code === 'backup_document_corrupt');
  assert.deepEqual(initial(), { snapshot: { documents: [], media: [] }, files: {} });
});

test('document staging and projected manifest budgets reject oversized or malformed input without reading blobs', async () => {
  const f = fixture(), bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 65);
  for (const input of [{ key: 'cellproject-kb', base64: bytes.toString('base64'), sha256: hash(bytes) }, { key: 'cellproject-kb', base64: 'YQ==', sha256: '0'.repeat(64) }, { key: 'unknown', base64: 'YQ==', sha256: hash(Buffer.from('a')) }]) await assert.rejects(f.call(initial(), 'backup.document.stage', input), error => error.status === 400);
  assert.equal(f.writes.length, 0);
  const descriptor = { blobId: '55555555-5555-4555-8555-555555555555', sha256: 'a'.repeat(64), size: 8 * 1024 * 1024 + 1000 }, part = { descriptor, sha256: 'a'.repeat(64), size: 8 * 1024 * 1024 };
  const document = key => ({ key, parts: [part, part, part, part], sha256: 'a'.repeat(64), size: 32 * 1024 * 1024 });
  const header = await module.createExternalBackupHeader([], [], 5);
  await assert.rejects(f.call(initial(), 'backup.import', { ...header, documents: ['cellproject-workspace', 'cellproject-graph', 'cellproject-kb'].map(document), media: [] }), error => error.status === 413);
  await assert.rejects(f.call(initial(), 'backup.import', { ...header, documents: [{ ...document('cellproject-kb'), size: 32 * 1024 * 1024 + 1 }], media: [] }), error => error.status === 400);
  assert.equal(f.reads.length, 0);
});

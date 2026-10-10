import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudRepository } from './cloudRepository.mjs';

const config = { supabaseUrl: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'public', bucket: 'cellproject-media' };
const session = { user: { id: '11111111-1111-4111-8111-111111111111' }, accessToken: 'SERVER_ONLY_TOKEN' };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('snapshot preserves exact strings and revisions, all remote calls carry user JWT rather than administrative key', async () => {
  const data = { documents: [{ key: 'cellproject-workspace', value: '{ "state": {}, "version": 2 }', revision: 7 }], media: [] };
  const repository = createCloudRepository({ config, fetchImpl: async (url, init) => { assert.ok(url.endsWith('/rpc/cellproject_snapshot')); assert.equal(init.headers.authorization, 'Bearer SERVER_ONLY_TOKEN'); assert.equal(init.headers.apikey, 'public'); return response(data); } });
  assert.deepEqual(await repository.snapshot(session), data);
});

test('writes forward CAS/idempotency parameters, return conflicts without retry or leaking remote error details', async () => {
  let calls = 0;
  const repository = createCloudRepository({ config, fetchImpl: async (_url, init) => { calls++; assert.deepEqual(JSON.parse(init.body), { p_key: 'cellproject-graph', p_value: '{"state":{},"version":6}', p_base_revision: 3, p_operation_id: 'op-1' }); return response({ code: 'P0001', message: 'CELLPROJECT_CONFLICT SENTINEL_SECRET' }, 400); } });
  await assert.rejects(repository.writeDocument(session, 'cellproject-graph', { value: '{"state":{},"version":6}', baseRevision: 3, operationId: 'op-1' }), error => error.status === 409 && !error.message.includes('SENTINEL_SECRET'));
  assert.equal(calls, 1);
});

test('SQL quota failures become explicit storage limits rather than generic upstream errors', async () => {
  for (const message of ['Media quota exceeded', 'Project media quota exceeded']) {
    const repository = createCloudRepository({ config, fetchImpl: async () => response({ code: 'P0001', message }, 400) });
    await assert.rejects(repository.writeDocument(session, 'cellproject-graph', { value: '{"state":{},"version":6}', baseRevision: 0, operationId: 'op-1' }), error => error.status === 413 && error.code === 'cloud_limit');
  }
});

test('immutable media uploads compute hash/path and preserve IDs; readback verifies bytes before publishing the catalog', async () => {
  const bytes = Buffer.from('reference bytes'); const sha256 = createHash('sha256').update(bytes).digest('hex'); const calls = [];
  const metadata = { id: 'Original.Media-1', mime: 'text/plain', name: '../original.txt', projectId: 'project-1', createdAt: 4, sha256, operationId: 'upload-1', base64: bytes.toString('base64') };
  const repository = createCloudRepository({ config, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/rpc/cellproject_write_media')) { const payload = JSON.parse(init.body); assert.equal(payload.p_metadata.id, metadata.id); assert.equal(payload.p_metadata.name, metadata.name); assert.equal(payload.p_metadata.size, bytes.length); assert.equal(payload.p_operation_id, 'upload-1'); assert.match(payload.p_metadata.path, new RegExp(`^${session.user.id}/[a-f0-9]{64}/${sha256}$`)); return response({ id: metadata.id, sha256, size: bytes.length }); }
    if (init.method === 'POST') { assert.equal(init.headers['x-upsert'], 'false'); assert.deepEqual(Buffer.from(init.body), bytes); return response({}); }
    return new Response(bytes, { headers: { 'content-type': 'text/plain' } });
  } });
  assert.deepEqual(await repository.writeMedia(session, metadata), { id: metadata.id, sha256, size: bytes.length });
  assert.equal(calls.length, 3); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[1].init.method, 'GET'); assert.ok(calls[2].url.endsWith('/cellproject_write_media'));
  await assert.rejects(repository.writeMedia(session, { ...metadata, sha256: '0'.repeat(64) }), error => error.status === 400);
  assert.equal(calls.length, 3);
});

test('failed readback never publishes media; duplicate bytes retry readback rather than overwrite; GET path comes from owned catalog', async () => {
  const bytes = Buffer.from('real bytes'); const sha256 = createHash('sha256').update(bytes).digest('hex'); let published = 0;
  const metadata = { id: 'm1', mime: 'text/plain', name: 'file.txt', sha256, size: bytes.length, path: `${session.user.id}/${createHash('sha256').update('m1').digest('hex')}/${sha256}` };
  const repository = createCloudRepository({ config, fetchImpl: async (url, init) => {
    if (url.includes('cellproject_media?')) return response([metadata]);
    if (url.endsWith('/cellproject_write_media')) { published++; return response({}); }
    if (init.method === 'POST') return response({ message: 'already exists', statusCode: '409' }, 409);
    return new Response('corrupt bytes');
  } });
  await assert.rejects(repository.writeMedia(session, { ...metadata, base64: bytes.toString('base64'), operationId: 'upload-1' }), error => error.status === 502);
  assert.equal(published, 0);
  await assert.rejects(repository.readMedia(session, metadata.id), error => error.status === 502);
});

test('import is one atomic RPC and rejects duplicate/unknown keys, credential material and malformed envelopes before network', async () => {
  let calls = 0; const repository = createCloudRepository({ config, fetchImpl: async (_url, init) => { calls++; const body = JSON.parse(init.body); assert.equal(body.p_manifest_hash, 'a'.repeat(64)); return response({ documents: [{ key: 'cellproject-workspace', revision: 1 }] }); } });
  const data = { documents: [{ key: 'cellproject-workspace', value: '{"state":{},"version":2}' }], manifestHash: 'a'.repeat(64), operationId: 'migration-1' };
  assert.deepEqual(await repository.importDocuments(session, data), { documents: [{ key: 'cellproject-workspace', revision: 1 }] }); assert.equal(calls, 1);
  for (const documents of [[data.documents[0], data.documents[0]], [{ key: '../unknown', value: '{}' }], [{ key: 'cellproject-config', value: '{"state":{"providers":{"openrouter":{"apiKey":"SENTINEL_SECRET"}}},"version":4}' }], [{ key: 'cellproject-workspace', value: '{"state":{}}' }]]) await assert.rejects(repository.importDocuments(session, { ...data, documents }), error => error.status === 400);
  assert.equal(calls, 1);
});

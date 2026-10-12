import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { createExternalApi } from './externalApi.mjs';
import { openVaultManifest, sealDelegatedKey, sealVaultManifest } from './externalVault.mjs';
import { CloudError, sendError } from './cloudUtils.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111', vaultId = '22222222-2222-4222-8222-222222222222';
const cipher = { v: 1, iv: Buffer.alloc(12).toString('base64'), data: Buffer.alloc(48).toString('base64') };
const header = { format: 'dynamic-diary-vault', version: 1, id: vaultId, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16).toString('base64') }, password: cipher, recovery: cipher };
const catalog = [{ name: 'task.create', kind: 'action', permission: 'write', scope: 'project', projectRequired: true }, { name: 'project', kind: 'query', permission: 'read', scope: 'project', projectRequired: true }];

async function setup(fn) {
  const raw = randomBytes(32), encryptionKey = randomBytes(32).toString('base64'), token = 'cp_' + randomBytes(32).toString('base64url');
  const credential = { id: randomUUID(), ownerId, vaultId, projects: ['p1'], permissions: ['read', 'write'] };
  const binding = { ownerId, vaultId, credentialId: credential.id };
  credential.sealedKey = sealDelegatedKey(raw, binding, encryptionKey);
  let revision = 1, live = true, workers = 0, written = 0;
  const manifest = { snapshot: { documents: [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state: { projects: { p1: { id: 'p1' }, p2: { id: 'p2', name: 'PRIVATE_OTHER_PROJECT' } }, tasks: {} } }), revision: 1 }], media: [] }, files: {} };
  let encrypted = sealVaultManifest(raw, ownerId, vaultId, revision, manifest);
  let duringWorker = async () => {};
  const valid = () => { if (!live) throw new CloudError(403, 'external_forbidden', 'External access refused.'); };
  const scope = input => { if (input.projectId !== 'p1' || input.accountOperation) throw new CloudError(403, 'external_forbidden', 'External access refused.'); };
  const receipts = new Map();
  const repository = {
    authenticate: async digest => { valid(); assert.equal(digest, createHash('sha256').update(token).digest('hex')); return credential; },
    snapshot: async () => { valid(); return { header, revision, manifest: encrypted }; },
    replay: async (_c, input) => { valid(); scope(input); const receipt = receipts.get(input.operationId); if (receipt && receipt.fingerprint !== input.fingerprint) throw new CloudError(409, 'external_operation_conflict', 'Operation conflict.'); return receipt ?? null; },
    commit: async (_c, input) => {
      valid(); scope(input);
      const old = receipts.get(input.operationId); if (old) { if (old.fingerprint !== input.fingerprint) throw new CloudError(409, 'external_operation_conflict', 'Operation conflict.'); return { ...old, replayed: true }; }
      if (input.baseRevision !== revision) throw new CloudError(409, 'external_revision_conflict', 'Revision conflict.');
      revision++; encrypted = input.manifest; written++;
      const receipt = { fingerprint: input.fingerprint, revision, receipt: input.receipt }; receipts.set(input.operationId, receipt);
      return { revision, receipt: input.receipt, replayed: false };
    },
  };
  let origin;
  const config = { enabled: true, vaultEnabled: true, externalApiEnabled: true, externalApiKey: 'server-only', externalEncryptionKey: encryptionKey, get origin() { return origin; } };
  const api = createExternalApi({ config, repository, getCatalog: async () => catalog, runOperation: async request => {
    workers++; await duringWorker();
    const snapshot = structuredClone(request.snapshot), doc = snapshot.documents[0], data = JSON.parse(doc.value);
    data.state.tasks[request.operation.input.id ?? 't1'] = { id: request.operation.input.id ?? 't1', projectId: request.projectId, title: 'PRIVATE_ACTION_RESULT' };
    doc.value = JSON.stringify(data); return { result: { title: 'PRIVATE_ACTION_RESULT' }, snapshot };
  } });
  const server = createServer((req, res) => api.handle(req, res, req.url).catch(error => sendError(res, error)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const action = input => fetch(origin + '/api/v1/actions', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = { name: 'task.create', projectId: 'p1', operationId: randomUUID(), baseRevision: 1, input: {} };
  try { await fn({ api, repository, config, action, body, credential, raw, origin, setWorker: fn => { duringWorker = fn; }, revoke: () => { live = false; }, advance: () => { revision++; }, counts: () => ({ workers, written }), current: () => openVaultManifest(raw, ownerId, { header, revision, manifest: encrypted }) }); }
  finally { api.close(); await new Promise(resolve => server.close(resolve)); raw.fill(0); }
}

test('revocation during domain execution prevents the encrypted commit and disclosure of its result', async () => setup(async ({ action, body, setWorker, revoke, counts }) => {
  setWorker(async () => revoke());
  const response = await action(body); assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /PRIVATE_ACTION_RESULT|PRIVATE_OTHER_PROJECT/);
  assert.deepEqual(counts(), { workers: 1, written: 0 });
}));

test('a concurrent browser revision prevents a stale external result from committing', async () => setup(async ({ action, body, setWorker, advance, counts }) => {
  setWorker(async () => advance());
  const response = await action(body); assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /PRIVATE_ACTION_RESULT|PRIVATE_OTHER_PROJECT/);
  assert.deepEqual(counts(), { workers: 1, written: 0 });
}));

test('simultaneous identical logical requests have one durable commit and one replay result', async () => setup(async ({ action, body, setWorker, counts }) => {
  let entered = 0, release; const both = new Promise(resolve => { release = resolve; });
  setWorker(async () => { if (++entered === 2) release(); await both; });
  const responses = await Promise.all([action(body), action(body)]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.equal(counts().written, 1);
}));

test('enrollment retry keeps the original token and delegated capsule despite a lost registration response', async () => setup(async ({ api, credential, raw, config }) => {
  const session = { user: { id: ownerId }, accessToken: 'HUMAN_JWT' };
  const remoteHead = { header, revision: 1, manifest: sealVaultManifest(raw, ownerId, vaultId, 1, { snapshot: { documents: [{ key: 'cellproject-workspace', value: '{"state":{"projects":{"p1":{"id":"p1"}}},"version":2}', revision: 1 }], media: [] }, files: {} }) };
  let original, count = 0;
  const repo = { enrollment: async (_session, value) => { count++; if (!original) original = value; assert.equal(value.tokenHash, original.tokenHash); assert.equal(value.id, original.id); return { id: value.id }; } };
  const management = createExternalApi({ config, repository: repo, vaultRepository: { get: async () => remoteHead }, getCatalog: async () => [] });
  const server = createServer((req, res) => management.manage(req, res, session, req.url).catch(error => sendError(res, error)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const enrollment = await (await fetch(origin + '/api/integrations/external/enrollment')).json();
    const publicKey = await webcrypto.subtle.importKey('jwk', enrollment.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const label = Buffer.from(JSON.stringify(['cellproject-external-enrollment', 1, ownerId, vaultId, credential.id, enrollment.keyId]));
    const input = { id: credential.id, name: 'Runtime', tokenHash: 'a'.repeat(64), tokenPrefix: 'cp_abcdefgh', projects: ['p1'], permissions: ['read'], expiresAt: new Date(Date.now() + 86400000).toISOString(), vaultId };
    for (let attempt = 0; attempt < 2; attempt++) {
      const capsule = { v: 1, keyId: enrollment.keyId, data: Buffer.from(await webcrypto.subtle.encrypt({ name: 'RSA-OAEP', label }, publicKey, raw)).toString('base64') };
      const response = await fetch(origin + '/api/integrations/external/credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, capsule }) });
      assert.equal(response.status, 201); await response.body.cancel();
    }
    assert.equal(count, 2);
    assert.equal(original.sealedKey.v, 1);
    assert.doesNotMatch(JSON.stringify(original), /HUMAN_JWT/);
  } finally { management.close(); await new Promise(resolve => server.close(resolve)); }
}));

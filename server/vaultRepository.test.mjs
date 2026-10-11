import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVaultHeader, validateVaultCipher, createVaultRepository } from './vaultRepository.mjs';
const cipher = { v: 1, iv: Buffer.alloc(12).toString('base64'), data: Buffer.alloc(48).toString('base64') };
const header = { format: 'dynamic-diary-vault', version: 1, id: '00000000-0000-4000-8000-000000000001', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16).toString('base64') }, password: cipher, recovery: cipher };
const session = { user: { id: 'owner' }, accessToken: 'test-only-token' };
test('revision contention is distinct from operation identity conflicts', async () => {
  for (const [message, code] of [['Revision conflict', 'vault_revision_conflict'], ['Operation conflict', 'vault_operation_conflict']]) {
    const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'test-public' }, fetchImpl: async () => Response.json({ message, code: 'P0001' }, { status: 400 }) });
    await assert.rejects(repo.write(session, { manifest: cipher, baseRevision: 1, operationId: 'test-conflict' }), error => error.status === 409 && error.code === code);
  }
});
test('vault wire contracts reject plaintext extras, downgraded KDF and invalid ciphertext', () => {
  assert.deepEqual(validateVaultHeader(header), header);
  assert.throws(() => validateVaultHeader({ ...header, secret: 'plaintext' }));
  assert.throws(() => validateVaultHeader({ ...header, kdf: { ...header.kdf, iterations: 1 } }));
  assert.throws(() => validateVaultCipher({ ...cipher, title: 'private' }));
  assert.throws(() => validateVaultCipher({ ...cipher, iv: 'not-valid' }));
});
test('activation and CAS pass opaque ciphertext to authenticated RPC only', async () => {
  const calls = [];
  const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'test-only-public' }, fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json({ revision: 1 }); } });
  await repo.activate(session, { header, manifest: cipher, expectedDocuments: [{ key: 'dynamic_diary-chat', revision: 2 }], operationId: 'activation-1' });
  assert.equal(calls[0].url, 'https://test.supabase.co/rest/v1/rpc/dynamic_diary_activate_vault');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-only-token');
  const data = JSON.parse(calls[0].init.body); assert.deepEqual(data.p_header, header); assert.deepEqual(data.p_manifest, cipher);
  await assert.rejects(repo.activate(session, { header, manifest: cipher, expectedDocuments: [{ key: 'unknown', revision: 1 }], operationId: 'activation-2' }));
});
test('an ambiguous immutable Storage upload retries safely by reading back exactly the same ciphertext', async () => {
  const data = Buffer.from(JSON.stringify(cipher)), digest = (await import('node:crypto')).createHash('sha256').update(data).digest('hex');
  const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public' }, fetchImpl: async (url, init) => {
    if (url.includes('/rpc/dynamic_diary_vault_snapshot')) return Response.json({ header, manifest: cipher, revision: 1 });
    if (url.includes('/rpc/dynamic_diary_register_vault_blob')) return Response.json(null);
    if (init?.method === 'POST') return Response.json({ error: 'Duplicate', statusCode: '409' }, { status: 400 });
    return new Response(data);
  } });
  assert.deepEqual(await repo.writeBlob(session, { id: header.id, sha256: digest, base64: data.toString('base64') }), { id: header.id, sha256: digest, size: data.length });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateVaultHeader, validateVaultCipher, createVaultRepository } from './vaultRepository.mjs';
const cipher = { v: 1, iv: Buffer.alloc(12).toString('base64'), data: Buffer.alloc(48).toString('base64') };
const header = { format: 'dynamic-diary-vault', version: 1, id: '00000000-0000-4000-8000-000000000001', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16).toString('base64') }, password: cipher, recovery: cipher };
const session = { user: { id: 'owner' }, accessToken: 'test-only-token' };
const blobBytes = Buffer.from(JSON.stringify(cipher)), blobHash = createHash('sha256').update(blobBytes).digest('hex');
const blobInput = { id: header.id, sha256: blobHash, base64: blobBytes.toString('base64') };
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
    if (url.includes('/rpc/dynamic_diary_register_vault_blob')) return new Response(null, { status: 204 });
    if (init?.method === 'POST') return Response.json({ error: 'Duplicate', statusCode: '409' }, { status: 400 });
    return new Response(data);
  } });
  assert.deepEqual(await repo.writeBlob(session, { id: header.id, sha256: digest, base64: data.toString('base64') }), { id: header.id, sha256: digest, size: data.length });
});
test('a blob is confirmed after Storage readback and a void registration returns 204', async () => {
  const calls = [];
  const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public' }, fetchImpl: async (url, init) => {
    if (url.endsWith('/rpc/dynamic_diary_vault_snapshot')) { calls.push('snapshot'); return Response.json({ header, manifest: cipher, revision: 1 }); }
    if (url.endsWith('/rpc/dynamic_diary_register_vault_blob')) {
      calls.push('register');
      assert.deepEqual(JSON.parse(init.body), { p_id: header.id, p_hash: blobHash, p_size: blobBytes.length });
      return new Response(null, { status: 204 });
    }
    assert.equal(url, `https://test.supabase.co/storage/v1/object/dynamic-diary-vault/owner/${header.id}`);
    if (init.method === 'POST') { calls.push('upload'); assert.deepEqual(init.body, blobBytes); return Response.json({ Key: `dynamic-diary-vault/owner/${header.id}` }); }
    calls.push('readback'); return new Response(blobBytes);
  } });
  assert.deepEqual(await repo.writeBlob(session, blobInput), { id: header.id, sha256: blobHash, size: blobBytes.length });
  assert.deepEqual(calls, ['snapshot', 'upload', 'readback', 'register']);
});
test('snapshot, activation and CAS still require valid JSON responses', async () => {
  const operations = [
    repo => repo.get(session),
    repo => repo.activate(session, { header, manifest: cipher, expectedDocuments: [], operationId: 'activation-json' }),
    repo => repo.write(session, { manifest: cipher, baseRevision: 1, operationId: 'write-json' }),
  ];
  for (const response of [() => new Response(null, { status: 204 }), () => new Response('not-json')]) {
    for (const operation of operations) {
      const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public' }, fetchImpl: async () => response() });
      await assert.rejects(operation(repo), error => error.status === 502 && error.code === 'upstream_unavailable');
    }
  }
});
test('registration HTTP failures are not accepted as a completed blob upload', async () => {
  for (const [status, expectedStatus] of [[400, 502], [403, 403], [500, 502]]) {
    const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public' }, fetchImpl: async (url, init) => {
      if (url.endsWith('/rpc/dynamic_diary_vault_snapshot')) return Response.json({ header, manifest: cipher, revision: 1 });
      if (url.endsWith('/rpc/dynamic_diary_register_vault_blob')) return Response.json({ message: 'Registration refused' }, { status });
      if (init.method === 'POST') return Response.json({ Key: 'uploaded' });
      return new Response(blobBytes);
    } });
    await assert.rejects(repo.writeBlob(session, blobInput), error => error.status === expectedStatus);
  }
});
test('malformed JSON with HTTP 200 is still rejected for blob registration', async () => {
  const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public' }, fetchImpl: async (url, init) => {
    if (url.endsWith('/rpc/dynamic_diary_vault_snapshot')) return Response.json({ header, manifest: cipher, revision: 1 });
    if (url.endsWith('/rpc/dynamic_diary_register_vault_blob')) return new Response('not-json');
    if (init.method === 'POST') return Response.json({ Key: 'uploaded' });
    return new Response(blobBytes);
  } });
  await assert.rejects(repo.writeBlob(session, blobInput), error => error.status === 502 && error.code === 'upstream_unavailable');
});
test('a blob with mismatched Storage readback bytes is never registered', async () => {
  let registered = false;
  const repo = createVaultRepository({ config: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public' }, fetchImpl: async (url, init) => {
    if (url.endsWith('/rpc/dynamic_diary_vault_snapshot')) return Response.json({ header, manifest: cipher, revision: 1 });
    if (url.endsWith('/rpc/dynamic_diary_register_vault_blob')) { registered = true; return new Response(null, { status: 204 }); }
    if (init.method === 'POST') return Response.json({ Key: 'uploaded' });
    return new Response(Buffer.from('different bytes'));
  } });
  await assert.rejects(repo.writeBlob(session, blobInput), error => error.status === 502 && error.code === 'upstream_unavailable');
  assert.equal(registered, false);
});

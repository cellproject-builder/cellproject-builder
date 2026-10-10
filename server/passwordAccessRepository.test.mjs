import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordAccessRepository, validatePasswordAccess } from './passwordAccessRepository.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const vaultId = '22222222-2222-4222-8222-222222222222';
const access = { format: 'dynamic-diary-password-access', version: 1, ownerId, vaultId,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16, 1).toString('base64') },
  cipher: { v: 1, iv: Buffer.alloc(12, 2).toString('base64'), data: Buffer.alloc(88, 3).toString('base64') } };
const session = { user: { id: ownerId }, accessToken: 'synthetic-token' };
const config = { supabaseUrl: 'https://test.supabase.co', publishableKey: 'synthetic-public-key' };
const request = { access, baseRevision: 0, operationId: 'password-access-1', expectedOwnerId: ownerId };

test('password access accepts only the bounded ciphertext contract', () => {
  assert.deepEqual(validatePasswordAccess(access), access);
  for (const value of [
    { ...access, password: 'do-not-send' },
    { ...access, ownerId: '' },
    { ...access, vaultId: 'not-a-vault' },
    { ...access, version: '1' },
    { ...access, kdf: { ...access.kdf, iterations: 1 } },
    { ...access, kdf: { ...access.kdf, salt: Buffer.alloc(17).toString('base64') } },
    { ...access, kdf: { ...access.kdf, salt: 'AAAAAAAAAAAAAAAAAAAAAB==' } },
    { ...access, cipher: { ...access.cipher, data: Buffer.alloc(257).toString('base64') } },
    { ...access, cipher: { ...access.cipher, iv: 'invalid' } },
    { ...access, cipher: { ...access.cipher, secret: 'do-not-send' } },
  ]) assert.throws(() => validatePasswordAccess(value));
});

test('password access snapshot uses the user JWT and returns opaque ciphertext', async () => {
  const calls = [];
  const repository = createPasswordAccessRepository({ config, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return Response.json({ access, revision: 1 });
  } });
  assert.deepEqual(await repository.get(session), { access, revision: 1 });
  assert.equal(calls[0].url, `${config.supabaseUrl}/rest/v1/rpc/dynamic_diary_password_access_snapshot`);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${session.accessToken}`);
  assert.equal(calls[0].init.headers.apikey, config.publishableKey);
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), {});
});

test('password access can be absent and never accepts an untrusted snapshot', async () => {
  for (const value of [{ access: null }, { access, revision: 3 }]) {
    const repository = createPasswordAccessRepository({ config, fetchImpl: async () => Response.json(value) });
    assert.deepEqual(await repository.get(session), value);
  }
  for (const value of [
    { access: null, recovery: 'do-not-render' },
    { access: { ...access, ownerId: 'other-owner' }, revision: 1 },
    { access, revision: 0 },
    { access, revision: 1, password: 'do-not-render' },
  ]) {
    const repository = createPasswordAccessRepository({ config, fetchImpl: async () => Response.json(value) });
    await assert.rejects(repository.get(session), error => error.status === 502 && !error.message.includes('do-not-render'));
  }
});

test('password access writes bind account, expected revision and stable operation to the RPC', async () => {
  const calls = [];
  const repository = createPasswordAccessRepository({ config, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return Response.json({ revision: 1 });
  } });
  assert.deepEqual(await repository.write(session, request), { revision: 1 });
  assert.deepEqual(await repository.write(session, request), { revision: 1 });
  assert.equal(calls[0].url, `${config.supabaseUrl}/rest/v1/rpc/dynamic_diary_write_password_access`);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_access: access, p_base_revision: 0, p_operation_id: request.operationId, p_expected_owner_id: ownerId,
  });
  assert.ok(!calls[0].init.body.includes('synthetic-token'));
});

test('wrong account, malformed revisions and plaintext extras are refused before network access', async () => {
  let calls = 0;
  const repository = createPasswordAccessRepository({ config, fetchImpl: async () => { calls++; return Response.json({ revision: 1 }); } });
  for (const value of [
    { ...request, expectedOwnerId: 'another-owner' },
    { ...request, access: { ...access, ownerId: 'another-owner' } },
    { ...request, baseRevision: -1 },
    { ...request, baseRevision: 0.5 },
    { ...request, operationId: '' },
    { ...request, recoveryKey: 'do-not-send' },
  ]) await assert.rejects(repository.write(session, value));
  assert.equal(calls, 0);
});

test('provider errors normalize conflicts, authorization and unavailable responses', async () => {
  for (const [status, payload, expectedStatus] of [
    [400, { message: 'Revision conflict PRIVATE_DETAIL' }, 409],
    [400, { message: 'Vault conflict PRIVATE_DETAIL' }, 409],
    [400, { message: 'Invalid password access PRIVATE_DETAIL', code: '22023' }, 400],
    [403, { message: 'PRIVATE_DETAIL' }, 403],
    [429, { message: 'PRIVATE_DETAIL' }, 429],
    [500, { message: 'PRIVATE_DETAIL' }, 502],
  ]) {
    const repository = createPasswordAccessRepository({ config, fetchImpl: async () => Response.json(payload, { status }) });
    await assert.rejects(repository.write(session, request), error => error.status === expectedStatus && !error.message.includes('PRIVATE_DETAIL'));
  }
});

test('write rejects a mismatched or malformed confirmation instead of claiming saved access', async () => {
  for (const value of [{ revision: 0 }, { revision: 2 }, { revision: 1, key: 'unexpected' }]) {
    const repository = createPasswordAccessRepository({ config, fetchImpl: async () => Response.json(value) });
    await assert.rejects(repository.write(session, request), error => error.status === 502);
  }
});

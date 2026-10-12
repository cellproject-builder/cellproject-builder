import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('./externalRepository.mjs').catch(() => ({}));
const ownerId = '11111111-1111-4111-8111-111111111111', vaultId = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
const cipher = { v: 1, iv: Buffer.alloc(12).toString('base64'), data: Buffer.alloc(48).toString('base64') };
const header = { format: 'dynamic-diary-vault', version: 1, id: vaultId, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16).toString('base64') }, password: cipher, recovery: cipher };
const input = { id, name: 'Runtime', tokenHash: 'a'.repeat(64), tokenPrefix: 'cp_example', projects: ['project-1'], permissions: ['read', 'write'], expiresAt: '2030-01-01T00:00:00.000Z', vaultId, sealedKey: cipher };
const safe = { id, name: input.name, tokenPrefix: input.tokenPrefix, projects: input.projects, permissions: input.permissions, expiresAt: input.expiresAt, createdAt: '2026-10-11T00:00:00.000Z', revokedAt: null };
const credential = { id, ownerId, projects: input.projects, permissions: input.permissions, vaultId, sealedKey: cipher };
const config = { supabaseUrl: 'https://test.supabase.co', publishableKey: 'public-test', externalApiKey: 'SERVER_ONLY_SECRET' };
const session = { user: { id: ownerId }, accessToken: 'HUMAN_JWT' };

test('enrollment uses owner JWT while dedicated credential lookup uses server-only authentication', async () => {
  assert.equal(typeof module.createExternalRepository, 'function');
  const calls = [], repo = module.createExternalRepository({ config, fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith('_enroll') ? safe : credential); } });
  assert.deepEqual(await repo.enrollment(session, input), safe);
  assert.equal(calls[0].init.headers.authorization, 'Bearer HUMAN_JWT');
  assert.equal(calls[0].init.headers.apikey, 'public-test');
  assert.deepEqual(await repo.authenticate(input.tokenHash), credential);
  assert.equal(calls[1].init.headers.apikey, 'SERVER_ONLY_SECRET');
  assert.equal(calls[1].init.headers.authorization, undefined);
  assert.doesNotMatch(JSON.stringify(await repo.list(session).catch(() => [])), /SERVER_ONLY_SECRET/);
});

test('credential metadata canonicalizes PostgREST offsets and microseconds for enrollment and listing', async () => {
  const postgres = { ...safe, expiresAt: '2026-11-11T04:03:23.703+00:00', createdAt: '2026-10-12T04:03:23.703456+00:00' };
  const revoked = { ...postgres, revokedAt: '2026-10-12T07:05:06.987654+03:00' };
  const expected = { ...safe, expiresAt: '2026-11-11T04:03:23.703Z', createdAt: '2026-10-12T04:03:23.703Z' };
  const repo = module.createExternalRepository({ config, fetchImpl: async url => Response.json(url.endsWith('_enroll') ? postgres : [postgres, revoked]) });
  assert.deepEqual(await repo.enrollment(session, { ...input, expiresAt: expected.expiresAt }), expected);
  assert.deepEqual(await repo.list(session), [expected, { ...expected, revokedAt: '2026-10-12T04:05:06.987Z' }]);
  assert.equal(postgres.expiresAt, '2026-11-11T04:03:23.703+00:00');
  assert.equal(postgres.createdAt, '2026-10-12T04:03:23.703456+00:00');
});

test('credential metadata rejects malformed and non-string upstream timestamps', async () => {
  for (const key of ['expiresAt', 'createdAt', 'revokedAt']) {
    for (const value of ['invalid timestamp', 0]) {
      const malformed = { ...safe, [key]: value };
      const repo = module.createExternalRepository({ config, fetchImpl: async url => Response.json(url.endsWith('_enroll') ? malformed : [malformed]) });
      await assert.rejects(repo.enrollment(session, input), error => error.status === 502);
      await assert.rejects(repo.list(session), error => error.status === 502);
    }
  }
});

test('malformed enrollment and permission escalation shapes fail before upstream access', async () => {
  assert.equal(typeof module.createExternalRepository, 'function');
  let called = 0;
  const repo = module.createExternalRepository({ config, fetchImpl: async () => { called++; return Response.json(safe); } });
  for (const changed of [{ ...input, password: 'PRIVATE' }, { ...input, tokenHash: 'weak' }, { ...input, permissions: ['admin'] }, { ...input, projects: [] }, { ...input, projects: ['project-1', 'project-1'] }, { ...input, expiresAt: '2000-01-01T00:00:00.000Z' }]) await assert.rejects(repo.enrollment(session, changed), error => error.status === 400);
  assert.equal(called, 0);
});

test('snapshot pins owner and vault identity and rejects malformed upstream ciphertext', async () => {
  assert.equal(typeof module.createExternalRepository, 'function');
  const repo = module.createExternalRepository({ config, fetchImpl: async () => Response.json({ header, revision: 2, manifest: cipher }) });
  assert.deepEqual(await repo.snapshot(credential), { header, revision: 2, manifest: cipher });
  const wrong = module.createExternalRepository({ config, fetchImpl: async () => Response.json({ header: { ...header, id }, revision: 2, manifest: cipher }) });
  await assert.rejects(wrong.snapshot(credential), error => error.status === 502);
});

test('commit and replay carry target scope and reject incomplete idempotency identity', async () => {
  assert.equal(typeof module.createExternalRepository, 'function');
  const calls = [], receipt = { ...cipher, data: Buffer.alloc(32).toString('base64') }, scope = { operationId: 'logical-1', fingerprint: 'b'.repeat(64), projectId: 'project-1', accountOperation: false };
  const repo = module.createExternalRepository({ config, fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json(url.endsWith('_replay') ? null : { revision: 3, replayed: false, receipt }); } });
  assert.equal(await repo.replay(credential, scope), null);
  assert.equal((await repo.commit(credential, { ...scope, baseRevision: 2, manifest: cipher, receipt })).revision, 3);
  for (const body of calls) { assert.equal(body.p_credential_id, id); assert.equal(body.p_owner_id, ownerId); assert.equal(body.p_project_id, 'project-1'); assert.equal(body.p_account_operation, false); }
  await assert.rejects(repo.commit(credential, { ...scope, baseRevision: 2, manifest: cipher, receipt, operationId: '' }), error => error.status === 400);
});

test('authorization, revision and operation identity errors stay distinct without provider data leaks', async () => {
  assert.equal(typeof module.createExternalRepository, 'function');
  for (const [message, code, expected] of [['External credential forbidden', '42501', [403, 'external_forbidden']], ['Revision conflict', 'P0001', [409, 'external_revision_conflict']], ['Operation conflict', 'P0001', [409, 'external_operation_conflict']], ['Blob conflict', 'P0001', [409, 'external_blob_conflict']], ['Vault quota exceeded', '22023', [413, 'external_storage_limit']], ['PRIVATE_PROVIDER_DATA', 'XX000', [502, 'upstream_unavailable']]]) {
    const repo = module.createExternalRepository({ config, fetchImpl: async () => Response.json({ message, code }, { status: 400 }) });
    await assert.rejects(repo.snapshot(credential), error => error.status === expected[0] && error.code === expected[1] && !error.message.includes('PRIVATE_PROVIDER_DATA'));
  }
});

test('encrypted media is scoped before immutable upload, read back, and registered only after verification', async () => {
  assert.equal(typeof module.createExternalRepository, 'function');
  const { createHash } = await import('node:crypto'), bytes = Buffer.from(JSON.stringify(cipher)), sha256 = createHash('sha256').update(bytes).digest('hex');
  const calls = [], file = { id: vaultId, sha256, size: bytes.length };
  const repo = module.createExternalRepository({ config, fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method });
    if (url.endsWith('_blob_access')) return Response.json(JSON.parse(init.body).p_write ? null : file);
    if (url.endsWith('_blob')) return Response.json(file);
    assert.equal(url, `https://test.supabase.co/storage/v1/object/dynamic-diary-vault/${ownerId}/${vaultId}`);
    if (init.method === 'POST') { assert.equal(init.headers['x-upsert'], 'false'); assert.deepEqual(init.body, bytes); return Response.json({ Key: 'opaque' }); }
    return new Response(bytes);
  } });
  const target = { projectId: 'project-1', accountOperation: false, id: vaultId };
  assert.equal(typeof repo.writeBlob, 'function');
  assert.deepEqual(await repo.writeBlob(credential, { ...target, sha256, base64: bytes.toString('base64') }), file);
  assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['cellproject_external_blob_access', vaultId, vaultId, 'cellproject_external_blob']);
  assert.deepEqual(await repo.readBlob(credential, target), bytes);
  assert.equal(calls.at(-1).url.endsWith('_blob_access'), true, 'revocation rechecked after the byte read');
});

test('corrupted encrypted upload readback and out-of-scope preflight cannot register media', async () => {
  const { createHash } = await import('node:crypto'), bytes = Buffer.from(JSON.stringify(cipher)), sha256 = createHash('sha256').update(bytes).digest('hex');
  const target = { projectId: 'project-1', accountOperation: false, id: vaultId, sha256, base64: bytes.toString('base64') };
  let registered = 0, storage = 0;
  const repo = module.createExternalRepository({ config, fetchImpl: async (url, init) => {
    if (url.endsWith('_blob_access')) return Response.json(null);
    if (url.endsWith('_blob')) { registered++; return Response.json({}); }
    storage++; return init.method === 'POST' ? Response.json({}) : new Response('corrupted');
  } });
  assert.equal(typeof repo.writeBlob, 'function');
  await assert.rejects(repo.writeBlob(credential, target), error => error.status === 502); assert.equal(registered, 0);
  const denied = module.createExternalRepository({ config, fetchImpl: async () => Response.json({ message: 'External credential forbidden', code: '42501' }, { status: 403 }) });
  await assert.rejects(denied.writeBlob(credential, target), error => error.status === 403); assert.equal(storage, 2);
});

test('SQL enforces durable scopes, revocation, CAS and encrypted logical receipts', { skip: !process.env.CELLPROJECT_TEST_PGLITE_DIR }, async () => {
  const { readFile } = await import('node:fs/promises'), path = await import('node:path'), { pathToFileURL } = await import('node:url');
  const runtime = process.env.CELLPROJECT_TEST_PGLITE_DIR;
  const { PGlite } = await import(pathToFileURL(path.join(runtime, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
  const db = new PGlite();
  const ownerSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', foreign = '99999999-9999-4999-8999-999999999999';
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const asRole = async (role, fn, uid = ownerId) => {
    await db.exec('RESET ROLE');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [uid, JSON.stringify({ sub: uid, session_id: ownerSession, role })]);
    await db.exec(`SET ROLE ${role}`);
    try { return await fn(); } finally { await db.exec('RESET ROLE'); }
  };
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,is_anonymous boolean not null default false,email_confirmed_at timestamptz,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema auth,storage to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated,service_role;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
      grant execute on function storage.foldername(text) to authenticated,service_role;
      create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
      insert into auth.users(id,email,email_confirmed_at) values('${ownerId}','wylgnerbossman@gmail.com',now()),('${foreign}','other@example.invalid',now());
      insert into auth.sessions(id,user_id) values('${ownerSession}','${ownerId}');
    `);
    for (const name of ['20261010043955_cellproject_cloud_persistence.sql', '20261010044015_cellproject_harden_default_permissions.sql', '20261010130012_dynamic_diary_encrypted_vault.sql', '20261010131431_dynamic_diary_vault_safe_writes.sql', '20261010163258_dynamic_diary_password_access.sql', '20261012034451_cellproject_external_runtime.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    await db.query('insert into cellproject_private.allowed_users(user_id) values($1)', [ownerId]);
    await asRole('authenticated', () => scalar('select public.dynamic_diary_activate_vault($1,$2,$3,$4)', [header, cipher, [], 'activation']));
    const enroll = (v = input) => scalar('select public.cellproject_external_enroll($1,$2,$3,$4,$5,$6,$7,$8,$9)', [v.id, v.name, v.tokenHash, v.tokenPrefix, JSON.stringify(v.projects), v.permissions, v.expiresAt, v.vaultId, v.sealedKey]);
    const auth = () => scalar('select public.cellproject_external_authenticate($1)', [input.tokenHash]);
    const commit = (base = 1, op = 'logical-1', fingerprint = 'b'.repeat(64), projectId = 'project-1', accountOperation = false) => scalar('select public.cellproject_external_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, ownerId, vaultId, op, fingerprint, projectId, accountOperation, base, cipher, cipher]);
    const replay = (op = 'logical-1', fingerprint = 'b'.repeat(64), projectId = 'project-1') => scalar('select public.cellproject_external_replay($1,$2,$3,$4,$5,$6,$7)', [id, ownerId, vaultId, op, fingerprint, projectId, false]);
    const saved = await asRole('authenticated', () => enroll());
    assert.equal(saved.id, id); assert.equal(saved.tokenHash, undefined); assert.equal(saved.sealedKey, undefined);
    assert.deepEqual(await asRole('authenticated', () => enroll({ ...input, sealedKey: { ...cipher, iv: Buffer.alloc(12, 5).toString('base64') } })), saved);
    assert.deepEqual(await scalar('select sealed_key from cellproject_private.external_credentials where id=$1', [id]), cipher, 'enrollment retry preserves the original delegated capability');
    await assert.rejects(asRole('authenticated', () => enroll({ ...input, permissions: ['read'] })), /Credential conflict/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const table of ['cellproject_private.external_credentials', 'cellproject_private.external_operations']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(await scalar('select has_table_privilege($1,$2,$3)', [role, table, privilege]), false);
      }
    }
    assert.equal(await scalar('select has_function_privilege($1,$2,$3)', ['authenticated', 'public.cellproject_external_commit(uuid,uuid,uuid,text,text,text,boolean,bigint,jsonb,jsonb)', 'EXECUTE']), false);
    await assert.rejects(asRole('authenticated', () => auth()), /permission denied/);
    assert.equal((await asRole('service_role', auth, '')).ownerId, ownerId);
    assert.equal(await asRole('service_role', () => replay(), ''), null);
    await assert.rejects(asRole('service_role', () => commit(1, 'denied', 'b'.repeat(64), 'project-2'), ''), /forbidden/i);
    await assert.rejects(asRole('service_role', () => commit(1, 'denied-account', 'b'.repeat(64), null, true), ''), /forbidden/i);
    assert.deepEqual(await asRole('service_role', () => commit(), ''), { revision: 2, replayed: false, receipt: cipher });
    assert.deepEqual(await asRole('service_role', () => commit(), ''), { revision: 2, replayed: true, receipt: cipher });
    assert.deepEqual(await asRole('service_role', () => replay(), ''), { revision: 2, replayed: true, receipt: cipher });
    await assert.rejects(asRole('service_role', () => replay('logical-1', 'c'.repeat(64)), ''), /Operation conflict/);
    await assert.rejects(asRole('service_role', () => commit(1, 'logical-2'), ''), /Revision conflict/);
    assert.equal(await scalar('select revision from public.dynamic_diary_vaults where owner_id=$1', [ownerId]), 2);
    assert.equal(await scalar('select count(*)::int from cellproject_private.external_operations'), 1);
    assert.equal(await scalar("select count(*)::int from public.dynamic_diary_vault_operations where operation_id like 'external:%'"), 1);
    const blobAccess = (blobId = vaultId, write = false, projectId = 'project-1', credentialId = id) => scalar('select public.cellproject_external_blob_access($1,$2,$3,$4,$5,$6,$7)', [credentialId, ownerId, vaultId, projectId, false, blobId, write]);
    const registerBlob = (blobId = vaultId, sha = 'd'.repeat(64), size = 100, credentialId = id) => scalar('select public.cellproject_external_blob($1,$2,$3,$4,$5,$6,$7,$8)', [credentialId, ownerId, vaultId, 'project-1', false, blobId, sha, size]);
    assert.equal(await asRole('service_role', () => blobAccess(vaultId, true), ''), null);
    assert.deepEqual(await asRole('service_role', () => registerBlob(), ''), { id: vaultId, sha256: 'd'.repeat(64), size: 100 });
    assert.deepEqual(await asRole('service_role', () => blobAccess(), ''), { id: vaultId, sha256: 'd'.repeat(64), size: 100 });
    await assert.rejects(asRole('service_role', () => registerBlob(vaultId, 'e'.repeat(64)), ''), /Blob conflict/);
    await assert.rejects(asRole('service_role', () => blobAccess(vaultId, false, 'project-2'), ''), /forbidden/i);
    const readOnlyId = '44444444-4444-4444-8444-444444444444';
    await asRole('authenticated', () => enroll({ ...input, id: readOnlyId, tokenHash: 'c'.repeat(64), permissions: ['read'] }));
    assert.equal((await asRole('service_role', () => blobAccess(vaultId, false, 'project-1', readOnlyId), '')).id, vaultId);
    await assert.rejects(asRole('service_role', () => registerBlob(id, 'f'.repeat(64), 100, readOnlyId), ''), /forbidden/i);
    await db.query('insert into public.dynamic_diary_vault_blobs(owner_id,id,sha256,size) select $1,gen_random_uuid(),$2,15728640 from generate_series(1,46)', [ownerId, 'f'.repeat(64)]);
    await assert.rejects(asRole('service_role', () => registerBlob(id, 'f'.repeat(64), 15728640), ''), /quota/i);
    // An expiry must use the clock at authorization, even in a transaction that
    // began before expiry (including a commit blocked on the owner lock).
    await db.exec('BEGIN');
    try {
      await db.query("update cellproject_private.external_credentials set expires_at=clock_timestamp()+interval '1 millisecond' where id=$1", [id]);
      await db.exec('select pg_sleep(0.02)');
      assert.equal(await asRole('service_role', auth, ''), null);
    } finally { await db.exec('ROLLBACK'); }
    await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [ownerId]);
    assert.equal(await asRole('service_role', auth, ''), null);
    await assert.rejects(asRole('service_role', () => commit(2, 'banned'), ''), /forbidden/i);
    await db.query('update auth.users set banned_until=null where id=$1', [ownerId]);
    await db.exec('delete from auth.sessions');
    assert.equal((await asRole('service_role', auth, '')).id, id, 'dedicated credential survives browser session removal');
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [ownerSession, ownerId]);
    await asRole('authenticated', () => scalar('select public.cellproject_external_revoke($1)', [id]));
    assert.equal(await asRole('service_role', auth, ''), null);
    await assert.rejects(asRole('service_role', () => replay(), ''), /forbidden/i);
    await assert.rejects(asRole('service_role', () => commit(2, 'revoked'), ''), /forbidden/i);
    await assert.rejects(asRole('service_role', () => blobAccess(), ''), /forbidden/i);
    assert.equal(await scalar('select sealed_key from cellproject_private.external_credentials where id=$1', [id]), null);
  } finally { await db.close(); }
});

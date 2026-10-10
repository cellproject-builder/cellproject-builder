import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Isolated WASM Postgres with fabricated fixtures only. No network DB or secrets.
 * Run from PowerShell without modifying repository dependencies:
 *   $vaultSqlRuntime = Join-Path $env:TEMP ('dynamic-diary-pglite-' + [guid]::NewGuid())
 *   npm install --prefix $vaultSqlRuntime --save-exact --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
 *   node scripts/test-vault-sql.mjs $vaultSqlRuntime
 * PGlite has one exclusive session: this verifies SQL behavior, not race scheduling
 * or the managed Supabase Auth/Storage services. Data is discarded on db.close().
 * Documentation: https://pglite.dev/docs/ and https://pglite.dev/docs/api
 */
const packageRoot = process.argv[2];
if (!packageRoot?.includes('dynamic-diary-pglite-')) throw new Error('Pass the temporary PGlite installation directory');
const packageMetadata = JSON.parse(await readFile(path.join(packageRoot, 'node_modules/@electric-sql/pglite/package.json'), 'utf8'));
assert.equal(packageMetadata.version, '0.5.8', 'Use the pinned PGlite version documented above');
const { PGlite } = await import(pathToFileURL(path.join(packageRoot, 'node_modules/@electric-sql/pglite/dist/index.js')).href);
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const ownerSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreignSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const headerId = '33333333-3333-4333-8333-333333333333';
// Byte strings below are schema fixtures, not encrypted user data or real keys.
const cipher = bytes => ({ v: 1, iv: Buffer.alloc(12, 1).toString('base64'), data: Buffer.alloc(bytes, 2).toString('base64') });
const header = { format: 'dynamic-diary-vault', version: 1, id: headerId,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.alloc(16, 3).toString('base64') },
  password: cipher(48), recovery: cipher(48) };
const manifest = cipher(32);
const legacyDocuments = [{ key: 'cellproject-workspace', revision: 2 }, { key: 'cellproject-graph', revision: 1 }];
let passed = 0;
const failed = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed.push({ name, message: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function user(fn, { uid = owner, session = ownerSession, role = 'authenticated' } = {}) {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await db.exec('RESET ROLE');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [uid, JSON.stringify({ sub: uid, session_id: session, role })]);
  await db.exec(`SET ROLE ${role}`);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const activate = (expected, op = 'activate-valid', h = header, m = manifest) => db.query('select public.dynamic_diary_activate_vault($1,$2,$3,$4) as result', [h, m, expected, op]);
const write = (base, op = 'write-valid', m = manifest) => db.query('select public.dynamic_diary_write_vault($1,$2,$3) as result', [m, base, op]);

try {
  console.log(JSON.stringify({ engine: await scalar('select version()'), package: '@electric-sql/pglite@0.5.8', isolation: 'ephemeral in-memory only', concurrentSessions: false }));
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    -- Managed Supabase grants these defaults before application migrations run.
    -- Narrow grants must first revoke inherited privileges, not merely add more.
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
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','wylgnerbossman@gmail.com',now()),('${foreign}','other@example.invalid',now());
    insert into auth.sessions(id,user_id) values('${ownerSession}','${owner}'),('${foreignSession}','${foreign}');
  `);
  for (const name of ['20261010043955_cellproject_cloud_persistence.sql','20261010044015_cellproject_harden_default_permissions.sql','20261010130012_dynamic_diary_encrypted_vault.sql','20261010131431_dynamic_diary_vault_safe_writes.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    console.log(`APPLIED ${name}`);
  }
  await db.query('insert into cellproject_private.allowed_users(user_id) values($1)', [owner]);

  await check('vault tables strip managed default privileges before granting the minimum', async () => {
    for (const table of ['dynamic_diary_vaults','dynamic_diary_vault_operations','dynamic_diary_vault_blobs']) {
      for (const privilege of ['DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal(await scalar('select has_table_privilege($1,$2,$3)', ['authenticated', `public.${table}`, privilege]), false, `authenticated must not have ${privilege} on ${table}`);
      }
      for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal(await scalar('select has_table_privilege($1,$2,$3)', ['service_role', `public.${table}`, privilege]), false, `service_role must not have ${privilege} on ${table}`);
      }
    }
    for (const table of ['dynamic_diary_vault_operations','dynamic_diary_vault_blobs']) {
      assert.equal(await scalar('select has_table_privilege($1,$2,$3)', ['authenticated', `public.${table}`, 'UPDATE']), false);
      assert.equal(await scalar('select has_table_privilege($1,$2,$3)', ['service_role', `public.${table}`, 'SELECT']), false);
    }
    assert.equal(await scalar("select has_table_privilege('service_role','public.dynamic_diary_vaults','SELECT')"), true);
  });
  await check('vault mutation SQL always identifies the owner for managed safe-update checks', async () => {
    // PGlite does not load the managed safeupdate library. Inspect the actual SQL
    // definitions as a separate guard; behavior is exercised below with RLS.
    const activation = await scalar("select prosrc from pg_proc where oid='public.dynamic_diary_activate_vault(jsonb,jsonb,jsonb,text)'::regprocedure");
    const writing = await scalar("select prosrc from pg_proc where oid='public.dynamic_diary_write_vault(jsonb,bigint,text)'::regprocedure");
    assert.match(activation, /delete\s+from\s+public\.cellproject_documents\s+where\s+owner_id\s*=\s*auth\.uid\(\)/i);
    assert.match(activation, /delete\s+from\s+public\.cellproject_operations\s+where\s+owner_id\s*=\s*auth\.uid\(\)/i);
    assert.match(writing, /update\s+public\.dynamic_diary_vaults\s+set[^;]+where\s+owner_id\s*=\s*auth\.uid\(\)/i);
  });

  await check('advisory transaction lock exists and executes', () => db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [owner]));
  await check('authenticated admission with confirmed active session', async () => assert.equal(await user(() => scalar('select public.cellproject_authorized()')), true));
  await check('foreign non-admitted session is denied', async () => assert.equal(await user(() => scalar('select public.cellproject_authorized()'), { uid: foreign, session: foreignSession }), false));
  await check('legacy write succeeds before activation', async () => {
    const result = await user(() => db.query('select public.cellproject_write_document($1,$2,0,$3) as result', ['cellproject-workspace', '{"state":{"projects":{}},"version":1}', 'legacy-seed']));
    assert.equal(result.rows[0].result.revision, 1);
    await user(() => db.query('select public.cellproject_write_document($1,$2,0,$3)', ['cellproject-graph', '{}', 'legacy-seed-2']));
    await user(() => db.query('select public.cellproject_write_document($1,$2,1,$3)', ['cellproject-workspace', '{"state":{},"version":1}', 'legacy-seed-3']));
  });
  await check('strict cipher validator rejects empty objects', async () => {
    await assert.rejects(user(() => db.query("select cellproject_private.validate_cipher('{}'::jsonb)")), /Invalid ciphertext/);
  });
  await check('direct vault INSERT cannot bypass plaintext migration', async () => {
    await assert.rejects(user(() => db.query('insert into public.dynamic_diary_vaults(header,manifest,revision) values($1,$2,1)', [header, manifest])), /legacy|activation|migration|conflict/i);
  });
  // A failed assertion above may have inserted an unauthorized head. Remove only
  // this fabricated row as fixture administrator so remaining checks are useful.
  await db.query('delete from public.dynamic_diary_vaults where owner_id=$1', [owner]);
  await check('CAS mismatch leaves plaintext and vault unchanged', async () => {
    await assert.rejects(user(() => activate([{ key: 'cellproject-workspace', revision: 2 }], 'activate-stale')), /Revision conflict/);
    assert.equal(await scalar('select count(*)::int from public.cellproject_documents'), 2);
    assert.equal(await scalar('select count(*)::int from public.dynamic_diary_vaults'), 0);
  });
  await check('legacy media blocks activation without data loss', async () => {
    await db.query('insert into public.cellproject_media(owner_id,id,mime,name,sha256,size,path) values($1,$2,$3,$4,$5,$6,$7)', [owner, 'fixture-media', 'text/plain', 'fixture.txt', 'a'.repeat(64), 1, `${owner}/${'b'.repeat(64)}/${'a'.repeat(64)}`]);
    await assert.rejects(user(() => activate(legacyDocuments, 'activate-media')), /Legacy_media/);
    assert.equal(await scalar('select count(*)::int from public.cellproject_documents'), 2);
    await db.query('delete from public.cellproject_media where id=$1', ['fixture-media']);
  });
  await check('activation atomically installs ciphertext and removes plaintext', async () => {
    await db.query('insert into public.cellproject_documents(owner_id,key,value) values($1,$2,$3)', [foreign, 'cellproject-workspace', '{}']);
    const result = await user(() => activate(legacyDocuments));
    assert.equal(result.rows[0].result.revision, 1);
    assert.equal(await scalar('select count(*)::int from public.cellproject_documents where owner_id=$1', [foreign]), 1, 'Activation must preserve another owner\'s documents');
    await db.query('delete from public.cellproject_documents where owner_id=$1', [foreign]);
    assert.equal(await scalar('select count(*)::int from public.cellproject_documents'), 0);
    assert.equal(await scalar('select count(*)::int from public.cellproject_operations'), 0);
    assert.equal(await scalar('select count(*)::int from public.dynamic_diary_vaults'), 1);
  });
  await check('activation replay is idempotent after plaintext removal', async () => {
    const result = await user(() => activate(legacyDocuments));
    assert.equal(result.rows[0].result.revision, 1);
  });
  await check('activation reused operation ID with changed request conflicts', async () => {
    await assert.rejects(user(() => activate([], 'activate-valid')), /Operation conflict/);
  });
  await check('old RPC cannot reintroduce plaintext after activation', async () => {
    await assert.rejects(user(() => db.query('select public.cellproject_write_document($1,$2,0,$3)', ['cellproject-workspace', '{}', 'old-tab'])), /legacy writes are disabled/);
  });
  await check('direct Data API table INSERT cannot reintroduce plaintext', async () => {
    await assert.rejects(user(() => db.query('insert into public.cellproject_documents(key,value) values($1,$2)', ['cellproject-workspace', '{}'])), /legacy writes are disabled/);
  });
  await check('storage legacy INSERT cannot reintroduce plaintext', async () => {
    await assert.rejects(user(() => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['cellproject-media', `${owner}/${'b'.repeat(64)}/${'a'.repeat(64)}`])), /legacy writes are disabled/);
  });
  await check('service_role final legacy storage INSERT also sees the encryption guard', async () => {
    assert.equal(await user(() => scalar('select auth.uid()'), { role: 'service_role', uid: '', session: '' }), null);
    await assert.rejects(user(() => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['cellproject-media', `${owner}/${'b'.repeat(64)}/${'a'.repeat(64)}`]), { role: 'service_role', uid: '', session: '' }), /legacy writes are disabled/);
  });
  await check('vault write checks base revision and persists the next version', async () => {
    const result = await user(() => write(1));
    assert.equal(result.rows[0].result.revision, 2);
    assert.equal(await scalar('select revision::int from public.dynamic_diary_vaults'), 2);
  });
  await check('write replay is idempotent and stale writer conflicts', async () => {
    assert.equal((await user(() => write(1))).rows[0].result.revision, 2);
    await assert.rejects(user(() => write(1, 'stale-writer')), /Revision conflict/);
    assert.equal(await scalar('select revision::int from public.dynamic_diary_vaults'), 2);
  });
  await check('RLS WITH CHECK prevents changing vault ownership', async () => {
    await assert.rejects(user(() => db.query('update public.dynamic_diary_vaults set owner_id=$1,revision=revision+1', [foreign])), /Vault conflict|row-level security/);
  });
  await check('foreign authenticated session cannot read vault, operation or blob rows', async () => {
    for (const table of ['dynamic_diary_vaults','dynamic_diary_vault_operations','dynamic_diary_vault_blobs']) {
      assert.equal(await user(() => scalar(`select count(*)::int from public.${table}`), { uid: foreign, session: foreignSession }), 0);
    }
  });
  await check('anonymous principal cannot execute snapshot', async () => {
    await assert.rejects(user(() => db.query('select public.dynamic_diary_vault_snapshot()'), { role: 'anon' }), /permission denied/);
  });
  await check('authenticated principal cannot delete vault to disable encryption', async () => {
    assert.equal(await scalar("select has_table_privilege('authenticated','public.dynamic_diary_vaults','DELETE')"), false);
    await assert.rejects(user(() => db.query('delete from public.dynamic_diary_vaults')), /permission denied/);
  });
  await check('opaque vault storage insert accepts allowed owner and bucket', async () => {
    assert.equal((await user(() => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['dynamic-diary-vault', `${owner}/${headerId}`]))).affectedRows, 1);
  });
  await check('opaque vault storage rejects a path owned by another account', async () => {
    await assert.rejects(user(() => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['dynamic-diary-vault', `${foreign}/${headerId}`])), /row-level security/);
  });
  await check('blob catalog registration is idempotent and rejects changed bytes', async () => {
    const register = hash => db.query('select public.dynamic_diary_register_vault_blob($1,$2,$3)', [headerId, hash, 64]);
    await user(() => register('c'.repeat(64))); await user(() => register('c'.repeat(64)));
    await assert.rejects(user(() => register('d'.repeat(64))), /Blob conflict/);
    assert.equal(await scalar('select count(*)::int from public.dynamic_diary_vault_blobs'), 1);
  });
  await check('admitted owner cannot insert a blob owned by another account', async () => {
    await assert.rejects(user(() => db.query('insert into public.dynamic_diary_vault_blobs(owner_id,id,sha256,size) values($1,$2,$3,64)', [foreign, headerId, 'c'.repeat(64)])), /row-level security/);
  });
  await check('owner RLS filters rows belonging to another principal even when admitted', async () => {
    // Administrator creates a synthetic second row. The tested JWT remains the
    // admitted owner; this proves ownership rather than admission alone.
    await db.query('insert into public.dynamic_diary_vaults(owner_id,header,manifest,revision) values($1,$2,$3,1)', [foreign, header, manifest]);
    await db.query('insert into public.dynamic_diary_vault_operations(owner_id,operation_id,request_hash,response) values($1,$2,$3,$4)', [foreign, 'foreign-op', 'fixture', {}]);
    await db.query('insert into public.dynamic_diary_vault_blobs(owner_id,id,sha256,size) values($1,$2,$3,64)', [foreign, headerId, 'c'.repeat(64)]);
    assert.equal(await scalar('select count(*)::int from public.dynamic_diary_vaults'), 2);
    for (const table of ['dynamic_diary_vaults','dynamic_diary_vault_blobs']) assert.equal(await user(() => scalar(`select count(*)::int from public.${table}`)), 1);
    assert.equal(await user(() => scalar('select count(*)::int from public.dynamic_diary_vault_operations where operation_id=$1', ['foreign-op'])), 0);
    assert.equal(await user(() => scalar('select count(*)::int from storage.objects')), 1);
  });
  await check('direct vault UPDATE cannot replace the wrapped keys', async () => {
    await assert.rejects(user(() => db.query('update public.dynamic_diary_vaults set header=$1,revision=revision+1', [{ ...header, id: '44444444-4444-4444-8444-444444444444' }])), /Vault conflict/);
  });
  await check('direct vault UPDATE cannot skip revision sequence', async () => {
    await assert.rejects(user(() => db.query('update public.dynamic_diary_vaults set revision=revision+2')), /Vault conflict/);
  });
  await check('cipher schema rejects missing, null and noncanonical field values', async () => {
    for (const value of [null, {}, { ...manifest, v: '1' }, { ...manifest, iv: null }, { ...manifest, data: null }, { ...manifest, data: manifest.data.slice(0, -1) }, { ...manifest, extra: 'plaintext' }]) {
      await assert.rejects(user(() => db.query('select cellproject_private.validate_cipher($1)', [value])));
    }
  });
} finally {
  await db.close();
}
console.log(JSON.stringify({ passed, failed, limitations: ['Single exclusive Postgres session; no cross-session races or advisory-lock waiting tested', 'Auth and Storage tables/functions/roles are fixtures, not Supabase service integration', 'No actual ciphertext, credentials, recovery codes or user data used', 'No remote database calls or production migration applied'] }, null, 2));
if (failed.length) process.exitCode = 1;

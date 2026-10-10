import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Isolated WASM Postgres with fabricated fixtures only. No network DB or secrets.
 * Run from PowerShell without modifying repository dependencies:
 *   $vaultSqlRuntime = Join-Path $env:TEMP ('dynamic-diary-pglite-' + [guid]::NewGuid())
 *   npm install --prefix $vaultSqlRuntime --save-exact --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
 *   node scripts/test-password-access-sql.mjs $vaultSqlRuntime
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
    await db.exec(await readFile(path.join(process.cwd(),'supabase/migrations',name), 'utf8'));
    console.log(`APPLIED ${name}`);
  }
  await db.query('insert into cellproject_private.allowed_users(user_id) values($1)', [owner]);


  await db.exec(await readFile(path.join(process.cwd(),'supabase/migrations/20261010163258_dynamic_diary_password_access.sql'),'utf8'));
  const access = { format:'dynamic-diary-password-access',version:1,ownerId:owner,vaultId:headerId,kdf:header.kdf,cipher:cipher(88) };
  const snapshotAccess = () => scalar('select public.dynamic_diary_password_access_snapshot()');
  const saveAccess = (value=access,base=0,op='first',expected=owner) => scalar('select public.dynamic_diary_write_password_access($1,$2,$3,$4)',[value,base,op,expected]);
  await check('no direct writes despite managed defaults',async()=>{
    for(const table of ['public.dynamic_diary_password_access','cellproject_private.password_access_operations']) {
      for(const role of ['authenticated','anon','service_role']) for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER']) assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,table,privilege]),false);
    }
    assert.equal(await scalar('select has_function_privilege($1,$2,$3)',['anon','public.dynamic_diary_write_password_access(jsonb,bigint,text,uuid)','EXECUTE']),false);
    assert.equal(await scalar('select has_function_privilege($1,$2,$3)',['service_role','cellproject_private.write_password_access(jsonb,bigint,text,uuid)','EXECUTE']),false);
  });
  await check('empty snapshot, refusing writes without canonical vault',async()=>{
    assert.deepEqual(await user(snapshotAccess),{access:null});
    await assert.rejects(user(()=>saveAccess()),/Vault conflict/);
  });
  await user(()=>activate([], 'activate-password-fixture'));
  const originalVault = await scalar('select to_jsonb(v) from public.dynamic_diary_vaults v where owner_id=$1',[owner]);
  await check('first access persists ciphertext only',async()=>{
    assert.deepEqual(await user(()=>saveAccess()),{revision:1});
    assert.deepEqual(await user(snapshotAccess),{access,revision:1});
  });
  await check('stable operation replay does not write again',async()=>{
    assert.deepEqual(await user(()=>saveAccess()),{revision:1});
    assert.equal(await scalar('select revision from public.dynamic_diary_password_access where owner_id=$1',[owner]),1);
  });
  await check('changed request under same operation conflicts',async()=>{
    await assert.rejects(user(()=>saveAccess({...access,cipher:cipher(89)})),/Operation conflict/);
  });
  await check('stale CAS preserves prior access',async()=>{
    await assert.rejects(user(()=>saveAccess({...access,cipher:cipher(89)},0,'stale')),/Revision conflict/);
    assert.deepEqual(await user(snapshotAccess),{access,revision:1});
  });
  await check('wrong account and vault are rejected',async()=>{
    await assert.rejects(user(()=>saveAccess(access,1,'owner-mismatch',foreign)),/Forbidden/);
    await assert.rejects(user(()=>saveAccess({...access,ownerId:foreign},1,'payload-owner')),/Forbidden/);
    await assert.rejects(user(()=>saveAccess({...access,vaultId:foreign},1,'payload-vault')),/Vault conflict/);
  });
  await check('non-admitted, expired and anonymous callers denied',async()=>{
    await assert.rejects(user(snapshotAccess,{uid:foreign,session:foreignSession}),/Forbidden/);
    await assert.rejects(user(()=>saveAccess(),{uid:foreign,session:foreignSession}),/Forbidden/);
    await assert.rejects(user(snapshotAccess,{role:'anon'}),/permission denied/);
    await db.query("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[ownerSession]);
    await assert.rejects(user(snapshotAccess),/Forbidden/);
    await db.query('update auth.sessions set not_after=null where id=$1',[ownerSession]);
  });
  await check('strict JSON, KDF and byte limits enforced in SQL',async()=>{
    for(const bad of [
      {...access,secret:'plaintext'},
      {...access,kdf:{...access.kdf,iterations:1}},
      {...access,kdf:{...access.kdf,salt:'AAAAAAAAAAAAAAAAAAAAAB=='}},
      {...access,cipher:cipher(257)},
      {...access,cipher:{...access.cipher,secret:'plaintext'}},
    ]) await assert.rejects(user(()=>saveAccess(bad,1,'invalid')));
  });
  await check('valid replacement advances access, preserving canonical vault byte-for-byte',async()=>{
    const next={...access,cipher:cipher(90)};
    assert.deepEqual(await user(()=>saveAccess(next,1,'second')),{revision:2});
    assert.deepEqual(await user(snapshotAccess),{access:next,revision:2});
    assert.deepEqual(await scalar('select to_jsonb(v) from public.dynamic_diary_vaults v where owner_id=$1',[owner]),originalVault);
  });
  await check('direct updates and ledger writes cannot bypass CAS',async()=>{
    await assert.rejects(user(()=>db.query('update public.dynamic_diary_password_access set access=$1 where owner_id=$2',[access,owner])),/permission denied/);
    await assert.rejects(user(()=>db.query('insert into cellproject_private.password_access_operations(owner_id,operation_id,request_hash,response) values($1,$2,$3,$4)',[owner,'bypass','a'.repeat(64),{revision:99}])),/permission denied/);
  });
  console.log(JSON.stringify({passed,failed}));
  if(failed.length) process.exitCode=1;
} finally { await db.close(); }

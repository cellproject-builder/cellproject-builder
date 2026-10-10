-- Client-side encrypted vault: only wrapped keys, authenticated ciphertext and opaque
-- file identifiers are stored. Apply after review; this file does not migrate users.
create table public.dynamic_diary_vaults (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  header jsonb not null,
  manifest jsonb not null,
  revision bigint not null check(revision > 0),
  updated_at timestamptz not null default now(),
  check(octet_length(header::text) <= 4096),
  check(octet_length(manifest::text) <= 136314880)
);
create table public.dynamic_diary_vault_operations (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id text not null check(length(operation_id) between 1 and 160),
  request_hash text not null, response jsonb not null,
  primary key(owner_id,operation_id)
);
create table public.dynamic_diary_vault_blobs (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  size bigint not null check(size between 1 and 15728640),
  primary key(owner_id,id)
);
alter table public.dynamic_diary_vaults enable row level security;
alter table public.dynamic_diary_vault_operations enable row level security;
alter table public.dynamic_diary_vault_blobs enable row level security;
revoke all on public.dynamic_diary_vaults,public.dynamic_diary_vault_operations,public.dynamic_diary_vault_blobs from public,anon;
-- No DELETE privilege: old clients cannot silently disable encryption.
grant select,insert,update on public.dynamic_diary_vaults to authenticated;
grant select,insert on public.dynamic_diary_vault_operations,public.dynamic_diary_vault_blobs to authenticated;
create policy owner_vault on public.dynamic_diary_vaults to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()))
with check(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));
create policy owner_vault_operations on public.dynamic_diary_vault_operations to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()))
with check(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));
create policy owner_vault_blobs on public.dynamic_diary_vault_blobs to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()))
with check(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));

create function cellproject_private.validate_cipher(p_value jsonb,p_max bigint default 100663296) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not coalesce(jsonb_typeof(p_value)='object' and
     (select array_agg(key order by key) from jsonb_object_keys(p_value) key)=array['data','iv','v'] and
     p_value->>'v'='1' and jsonb_typeof(p_value->'v')='number' and
     jsonb_typeof(p_value->'iv')='string' and jsonb_typeof(p_value->'data')='string' and
     p_value->>'iv' ~ '^[A-Za-z0-9+/]{16}$' and
     length(p_value->>'data')<=ceil(p_max::numeric/3)*4 and
     p_value->>'data' ~ '^[A-Za-z0-9+/]*={0,2}$' and
     octet_length(decode(p_value->>'iv','base64'))=12 and
     octet_length(decode(p_value->>'data','base64')) between 16 and p_max and
     replace(encode(decode(p_value->>'data','base64'),'base64'),chr(10),'')=p_value->>'data',false) then
    raise exception 'Invalid ciphertext' using errcode='22023';
  end if;
end $$;
create function cellproject_private.validate_vault_header(p_value jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not coalesce(jsonb_typeof(p_value)='object' and
    (select array_agg(key order by key) from jsonb_object_keys(p_value) key)=array['format','id','kdf','password','recovery','version'] and
    p_value->>'format'='dynamic-diary-vault' and p_value->>'version'='1' and jsonb_typeof(p_value->'version')='number' and
    jsonb_typeof(p_value->'id')='string' and p_value->>'id' ~ '^[a-f0-9-]{36}$' and
    jsonb_typeof(p_value->'kdf')='object' and
    (select array_agg(key order by key) from jsonb_object_keys(p_value->'kdf') key)=array['hash','iterations','name','salt'] and
    p_value->'kdf'->>'name'='PBKDF2' and p_value->'kdf'->>'hash'='SHA-256' and
    p_value->'kdf'->>'iterations'='600000' and jsonb_typeof(p_value->'kdf'->'iterations')='number' and
    jsonb_typeof(p_value->'kdf'->'salt')='string' and
    octet_length(decode(p_value->'kdf'->>'salt','base64'))=16 and
    encode(decode(p_value->'kdf'->>'salt','base64'),'base64')=p_value->'kdf'->>'salt',false) then
    raise exception 'Invalid vault header' using errcode='22023';
  end if;
  perform cellproject_private.validate_cipher(p_value->'password',48);
  perform cellproject_private.validate_cipher(p_value->'recovery',48);
  if octet_length(decode(p_value->'password'->>'data','base64'))<>48 or octet_length(decode(p_value->'recovery'->>'data','base64'))<>48 then
    raise exception 'Invalid key wrap' using errcode='22023';
  end if;
end $$;
create function cellproject_private.guard_vault_row() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
  if tg_op='INSERT' and (new.revision<>1 or exists(select 1 from public.cellproject_documents where owner_id=new.owner_id) or exists(select 1 from public.cellproject_media where owner_id=new.owner_id) or exists(select 1 from storage.objects where bucket_id='cellproject-media' and split_part(name,'/',1)=new.owner_id::text)) then
    raise exception 'Legacy conflict: activate the vault atomically' using errcode='P0001';
  end if;
  perform cellproject_private.validate_vault_header(new.header);
  perform cellproject_private.validate_cipher(new.manifest);
  if tg_op='UPDATE' and (new.header<>old.header or new.owner_id<>old.owner_id or new.revision<>old.revision+1) then
    raise exception 'Vault conflict' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger validate_vault before insert or update on public.dynamic_diary_vaults
for each row execute function cellproject_private.guard_vault_row();

-- A lock shared with activation closes concurrent old-tab and direct Data API writes.
create function cellproject_private.guard_legacy_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner uuid;
begin
  if tg_table_schema='storage' then
    if new.bucket_id<>'cellproject-media' then return new; end if;
    owner := (split_part(new.name,'/',1))::uuid;
  elsif tg_op='DELETE' then owner:=old.owner_id;
  else owner:=new.owner_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
  if exists(select 1 from public.dynamic_diary_vaults where owner_id=owner) then
    raise exception 'Vault exists: legacy writes are disabled' using errcode='P0001';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger stop_plaintext_documents before insert or update or delete on public.cellproject_documents
for each row execute function cellproject_private.guard_legacy_write();
create trigger stop_plaintext_catalog before insert or update or delete on public.cellproject_media
for each row execute function cellproject_private.guard_legacy_write();
create trigger stop_plaintext_operations before insert or update or delete on public.cellproject_operations
for each row execute function cellproject_private.guard_legacy_write();
create trigger stop_plaintext_storage before insert or update on storage.objects
for each row execute function cellproject_private.guard_legacy_write();

create function public.dynamic_diary_vault_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce((select jsonb_build_object('header',header,'manifest',manifest,'revision',revision) from public.dynamic_diary_vaults where owner_id=auth.uid()),'{"vault":null}'::jsonb)
$$;
create function public.dynamic_diary_activate_vault(p_header jsonb,p_manifest jsonb,p_expected_documents jsonb,p_operation_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare expected jsonb; actual jsonb; req text; existing public.dynamic_diary_vault_operations; reply jsonb:='{"revision":1}';
begin
  if not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 160 or jsonb_typeof(p_expected_documents)<>'array' or jsonb_array_length(p_expected_documents)>9 then raise exception 'Invalid activation' using errcode='22023'; end if;
  perform cellproject_private.validate_vault_header(p_header); perform cellproject_private.validate_cipher(p_manifest);
  req:=encode(sha256(convert_to(jsonb_build_array('activate',p_header,p_manifest,p_expected_documents)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.dynamic_diary_vault_operations where operation_id=p_operation_id;
  if found then
    if existing.request_hash<>req then raise exception 'Operation conflict' using errcode='P0001'; end if; return existing.response;
  end if;
  if exists(select 1 from public.dynamic_diary_vaults) then raise exception 'Vault exists conflict' using errcode='P0001'; end if;
  if exists(select 1 from public.cellproject_media) or exists(select 1 from storage.objects where bucket_id='cellproject-media' and split_part(name,'/',1)=auth.uid()::text) then
    raise exception 'Legacy_media requires assisted migration' using errcode='P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'revision',revision) order by key),'[]'::jsonb) into actual from public.cellproject_documents;
  select coalesce(jsonb_agg(value order by value->>'key'),'[]'::jsonb) into expected from jsonb_array_elements(p_expected_documents);
  if actual<>expected then raise exception 'Revision conflict' using errcode='P0001'; end if;
  -- Deletions and encrypted head are one transaction. Historical provider backups
  -- are subject to retention and are NOT retroactively erased by this migration.
  delete from public.cellproject_documents; delete from public.cellproject_operations;
  insert into public.dynamic_diary_vaults(header,manifest,revision) values(p_header,p_manifest,1);
  insert into public.dynamic_diary_vault_operations(operation_id,request_hash,response) values(p_operation_id,req,reply); return reply;
end $$;
create function public.dynamic_diary_write_vault(p_manifest jsonb,p_base_revision bigint,p_operation_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare req text; existing public.dynamic_diary_vault_operations; rev bigint; reply jsonb;
begin
  if not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 160 or p_base_revision is null or p_base_revision<1 then raise exception 'Invalid operation' using errcode='22023'; end if;
  perform cellproject_private.validate_cipher(p_manifest);
  req:=encode(sha256(convert_to(jsonb_build_array('write',p_manifest,p_base_revision)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.dynamic_diary_vault_operations where operation_id=p_operation_id;
  if found then
    if existing.request_hash<>req then raise exception 'Operation conflict' using errcode='P0001'; end if; return existing.response;
  end if;
  select revision into rev from public.dynamic_diary_vaults;
  if rev is distinct from p_base_revision then raise exception 'Revision conflict' using errcode='P0001'; end if;
  update public.dynamic_diary_vaults set manifest=p_manifest,revision=revision+1,updated_at=now();
  reply:=jsonb_build_object('revision',rev+1);
  insert into public.dynamic_diary_vault_operations(operation_id,request_hash,response) values(p_operation_id,req,reply); return reply;
end $$;
create function public.dynamic_diary_register_vault_blob(p_id uuid,p_hash text,p_size bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.dynamic_diary_vault_blobs;
begin
  if not cellproject_private.is_allowed_user() or not exists(select 1 from public.dynamic_diary_vaults) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into item from public.dynamic_diary_vault_blobs where id=p_id;
  if found then
    if item.sha256<>p_hash or item.size<>p_size then raise exception 'Blob conflict' using errcode='P0001'; end if; return;
  end if;
  if coalesce((select sum(size) from public.dynamic_diary_vault_blobs),0)+p_size>734003200 then raise exception 'Vault quota exceeded' using errcode='22023'; end if;
  insert into public.dynamic_diary_vault_blobs(id,sha256,size) values(p_id,p_hash,p_size);
end $$;
revoke all on function cellproject_private.validate_cipher(jsonb,bigint),cellproject_private.validate_vault_header(jsonb),cellproject_private.guard_vault_row(),cellproject_private.guard_legacy_write() from public,anon;
grant execute on function cellproject_private.validate_cipher(jsonb,bigint),cellproject_private.validate_vault_header(jsonb),cellproject_private.guard_vault_row(),cellproject_private.guard_legacy_write() to authenticated;
revoke all on function public.dynamic_diary_vault_snapshot(),public.dynamic_diary_activate_vault(jsonb,jsonb,jsonb,text),public.dynamic_diary_write_vault(jsonb,bigint,text),public.dynamic_diary_register_vault_blob(uuid,text,bigint) from public,anon;
grant execute on function public.dynamic_diary_vault_snapshot(),public.dynamic_diary_activate_vault(jsonb,jsonb,jsonb,text),public.dynamic_diary_write_vault(jsonb,bigint,text),public.dynamic_diary_register_vault_blob(uuid,text,bigint) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dynamic-diary-vault','dynamic-diary-vault',false,15728640,array['application/octet-stream']);
create policy vault_read_blob on storage.objects for select to authenticated
using(bucket_id='dynamic-diary-vault' and split_part(name,'/',1)=(select auth.uid())::text and (select cellproject_private.is_allowed_user()));
create policy vault_insert_blob on storage.objects for insert to authenticated
with check(bucket_id='dynamic-diary-vault' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$' and split_part(name,'/',1)=(select auth.uid())::text and (select cellproject_private.is_allowed_user()) and exists(select 1 from public.dynamic_diary_vaults));

grant select on public.dynamic_diary_vaults to service_role; -- Storage final upload runs under this role; trigger must see an activated vault.

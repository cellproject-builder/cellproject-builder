-- Persistent delegated access is separate from human Supabase sessions. Only
-- encrypted DEKs, encrypted manifests and encrypted logical results are stored.
create function cellproject_private.valid_external_projects(p_projects jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_projects='"*"'::jsonb then return true; end if;
  if p_projects is null or jsonb_typeof(p_projects)<>'array' then return false; end if;
  if jsonb_array_length(p_projects) not between 1 and 1000 then return false; end if;
  return not exists(select 1 from jsonb_array_elements(p_projects) p where jsonb_typeof(p)<>'string' or p#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,180}$' or p#>>'{}' in ('.','..'))
    and (select count(distinct p) from jsonb_array_elements(p_projects) p)=jsonb_array_length(p_projects);
end $$;

create table cellproject_private.external_credentials (
  id uuid primary key,
  owner_id uuid not null references public.dynamic_diary_vaults(owner_id) on delete cascade,
  vault_id uuid not null,
  name text not null check(length(name) between 1 and 100 and length(btrim(name))>0),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix text not null check(token_prefix ~ '^[A-Za-z0-9_-]{1,32}$'),
  projects jsonb not null check(cellproject_private.valid_external_projects(projects)),
  permissions text[] not null check(cardinality(permissions) between 1 and 2 and permissions <@ array['read','write']::text[] and array_position(permissions,null) is null),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  sealed_key jsonb,
  check((revoked_at is null and sealed_key is not null) or (revoked_at is not null and sealed_key is null)),
  check(sealed_key is null or octet_length(sealed_key::text)<=512)
);
create index external_credentials_owner on cellproject_private.external_credentials(owner_id,created_at desc);
create table cellproject_private.external_operations (
  credential_id uuid not null references cellproject_private.external_credentials(id) on delete cascade,
  owner_id uuid not null references public.dynamic_diary_vaults(owner_id) on delete cascade,
  operation_id text not null check(operation_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  project_id text,
  account_operation boolean not null,
  vault_revision bigint not null check(vault_revision between 1 and 9007199254740991),
  receipt jsonb not null check(octet_length(receipt::text)<=3145728),
  created_at timestamptz not null default now(),
  primary key(credential_id,operation_id),
  check((account_operation and project_id is null) or (not account_operation and project_id ~ '^[A-Za-z0-9_.:-]{1,180}$' and project_id not in ('.','..')))
);
alter table cellproject_private.external_credentials enable row level security;
alter table cellproject_private.external_operations enable row level security;
revoke all on cellproject_private.external_credentials,cellproject_private.external_operations from public,anon,authenticated,service_role;

create function cellproject_private.external_owner_active(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from cellproject_private.allowed_users a join auth.users u on u.id=a.user_id
    where a.user_id=p_owner and lower(u.email)='wylgnerbossman@gmail.com' and u.email_confirmed_at is not null
      and not u.is_anonymous and (u.banned_until is null or u.banned_until<=clock_timestamp()))
$$;
create function cellproject_private.external_metadata(p_value cellproject_private.external_credentials) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_value.id,'name',p_value.name,'tokenPrefix',p_value.token_prefix,'projects',p_value.projects,
    'permissions',p_value.permissions,'expiresAt',p_value.expires_at,'createdAt',p_value.created_at,'revokedAt',p_value.revoked_at)
$$;
create function cellproject_private.external_assert_credential(p_id uuid,p_owner uuid,p_vault uuid,p_write boolean default false,p_project text default null,p_account boolean default false)
returns cellproject_private.external_credentials language plpgsql security invoker set search_path='' as $$
declare credential cellproject_private.external_credentials;
begin
  select c.* into credential from cellproject_private.external_credentials c join public.dynamic_diary_vaults v on v.owner_id=c.owner_id and v.header->>'id'=c.vault_id::text
    where c.id=p_id and c.owner_id=p_owner and c.vault_id=p_vault and c.revoked_at is null and c.expires_at>clock_timestamp()
      and c.sealed_key is not null and cellproject_private.external_owner_active(c.owner_id);
  if not found then raise exception 'External credential forbidden' using errcode='42501'; end if;
  if p_write then
    if not ('write'=any(credential.permissions)) or p_account is null
      or (p_account and (p_project is not null or credential.projects<>'"*"'::jsonb))
      or (not p_account and (p_project is null or p_project !~ '^[A-Za-z0-9_.:-]{1,180}$' or p_project in ('.','..') or (credential.projects<>'"*"'::jsonb and not credential.projects ? p_project))) then
      raise exception 'External credential forbidden' using errcode='42501';
    end if;
  end if;
  return credential;
end $$;

create function cellproject_private.external_enroll(p_id uuid,p_name text,p_token_hash text,p_token_prefix text,p_projects jsonb,p_permissions text[],p_expires_at timestamptz,p_vault_id uuid,p_sealed_key jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=auth.uid(); existing cellproject_private.external_credentials; credential cellproject_private.external_credentials;
begin
  if account is null or not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_id is null or p_vault_id is null or p_name is null or length(p_name) not between 1 and 100 or length(btrim(p_name))=0
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_token_prefix is null or p_token_prefix !~ '^[A-Za-z0-9_-]{1,32}$'
    or not cellproject_private.valid_external_projects(p_projects) or p_permissions is null or cardinality(p_permissions) not between 1 and 2
    or not p_permissions <@ array['read','write']::text[] or array_position(p_permissions,null) is not null
    or (select count(distinct p) from unnest(p_permissions) p)<>cardinality(p_permissions)
    or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=now() then raise exception 'Invalid credential' using errcode='22023'; end if;
  perform cellproject_private.validate_cipher(p_sealed_key,48);
  if octet_length(decode(p_sealed_key->>'data','base64'))<>48 then raise exception 'Invalid delegated key' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(account::text,0));
  if not exists(select 1 from public.dynamic_diary_vaults where owner_id=account and header->>'id'=p_vault_id::text) then raise exception 'External credential forbidden' using errcode='42501'; end if;
  select * into existing from cellproject_private.external_credentials where id=p_id;
  if found then
    -- Enrollment retries may carry a fresh AES IV. Existing capabilities never get overwritten.
    if existing.owner_id<>account or existing.vault_id<>p_vault_id or existing.name<>p_name or existing.token_hash<>p_token_hash or existing.token_prefix<>p_token_prefix
      or existing.projects<>p_projects or existing.permissions<>p_permissions or existing.expires_at<>p_expires_at or existing.revoked_at is not null then
      raise exception 'Credential conflict' using errcode='P0001';
    end if;
    return cellproject_private.external_metadata(existing);
  end if;
  if exists(select 1 from cellproject_private.external_credentials where token_hash=p_token_hash) then raise exception 'Credential conflict' using errcode='P0001'; end if;
  if (select count(*) from cellproject_private.external_credentials where owner_id=account and revoked_at is null and expires_at>now())>=50 then raise exception 'Credential limit reached' using errcode='22023'; end if;
  insert into cellproject_private.external_credentials(id,owner_id,vault_id,name,token_hash,token_prefix,projects,permissions,expires_at,sealed_key)
    values(p_id,account,p_vault_id,p_name,p_token_hash,p_token_prefix,p_projects,p_permissions,p_expires_at,p_sealed_key) returning * into credential;
  return cellproject_private.external_metadata(credential);
end $$;
create function cellproject_private.external_list() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account uuid:=auth.uid(); result jsonb;
begin
  if account is null or not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(cellproject_private.external_metadata(c)),'[]'::jsonb) into result
    from (select * from cellproject_private.external_credentials where owner_id=account order by (revoked_at is null and expires_at>now()) desc,created_at desc,id limit 100) c;
  return result;
end $$;
create function cellproject_private.external_revoke(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=auth.uid();
begin
  if account is null or not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_id is null then raise exception 'Invalid credential' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(account::text,0));
  update cellproject_private.external_credentials set revoked_at=now(),sealed_key=null where id=p_id and owner_id=account and revoked_at is null;
  return '{"revoked":true}'::jsonb;
end $$;
create function cellproject_private.external_authenticate(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare credential cellproject_private.external_credentials;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select c.* into credential from cellproject_private.external_credentials c join public.dynamic_diary_vaults v on v.owner_id=c.owner_id and v.header->>'id'=c.vault_id::text
    where c.token_hash=p_token_hash and c.revoked_at is null and c.expires_at>clock_timestamp() and c.sealed_key is not null and cellproject_private.external_owner_active(c.owner_id);
  if not found then return null; end if;
  return jsonb_build_object('id',credential.id,'ownerId',credential.owner_id,'projects',credential.projects,'permissions',credential.permissions,'vaultId',credential.vault_id,'sealedKey',credential.sealed_key);
end $$;
create function cellproject_private.external_snapshot(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform cellproject_private.external_assert_credential(p_credential_id,p_owner_id,p_vault_id);
  select jsonb_build_object('header',header,'revision',revision,'manifest',manifest) into result from public.dynamic_diary_vaults where owner_id=p_owner_id and header->>'id'=p_vault_id::text;
  return result;
end $$;
create function cellproject_private.external_replay(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_operation_id text,p_fingerprint text,p_project_id text,p_account_operation boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing cellproject_private.external_operations;
begin
  if p_operation_id is null or p_operation_id !~ '^[A-Za-z0-9_.:-]{1,160}$' or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid operation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  perform cellproject_private.external_assert_credential(p_credential_id,p_owner_id,p_vault_id,true,p_project_id,p_account_operation);
  select * into existing from cellproject_private.external_operations where credential_id=p_credential_id and owner_id=p_owner_id and operation_id=p_operation_id;
  if not found then return null; end if;
  if existing.fingerprint<>p_fingerprint or existing.project_id is distinct from p_project_id or existing.account_operation<>p_account_operation then raise exception 'Operation conflict' using errcode='P0001'; end if;
  return jsonb_build_object('revision',existing.vault_revision,'replayed',true,'receipt',existing.receipt);
end $$;
create function cellproject_private.external_commit(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_operation_id text,p_fingerprint text,p_project_id text,p_account_operation boolean,p_base_revision bigint,p_manifest jsonb,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing jsonb; revision bigint; wire_id text; wire_hash text;
begin
  if p_base_revision is null or p_base_revision<1 or p_base_revision>=9007199254740991 then raise exception 'Invalid revision' using errcode='22023'; end if;
  perform cellproject_private.validate_cipher(p_manifest);
  perform cellproject_private.validate_cipher(p_receipt,2097152);
  -- replay acquires the same account lock and checks live admission, revocation,
  -- expiry and target grants before it returns a receipt or permits a new write.
  existing:=cellproject_private.external_replay(p_credential_id,p_owner_id,p_vault_id,p_operation_id,p_fingerprint,p_project_id,p_account_operation);
  if existing is not null then return existing; end if;
  select v.revision into revision from public.dynamic_diary_vaults v where owner_id=p_owner_id and header->>'id'=p_vault_id::text;
  if revision is distinct from p_base_revision then raise exception 'Revision conflict' using errcode='P0001'; end if;
  if (select count(*) from cellproject_private.external_operations where credential_id=p_credential_id)>=100000 then raise exception 'Operation limit reached' using errcode='22023'; end if;
  wire_id:='external:'||encode(sha256(convert_to(jsonb_build_array(p_credential_id,p_operation_id)::text,'UTF8')),'hex');
  wire_hash:=encode(sha256(convert_to(jsonb_build_array('write',p_manifest,p_base_revision)::text,'UTF8')),'hex');
  if exists(select 1 from public.dynamic_diary_vault_operations where owner_id=p_owner_id and operation_id=wire_id) then raise exception 'Operation conflict' using errcode='P0001'; end if;
  update public.dynamic_diary_vaults set manifest=p_manifest,revision=p_base_revision+1,updated_at=now() where owner_id=p_owner_id and dynamic_diary_vaults.revision=p_base_revision;
  if not found then raise exception 'Revision conflict' using errcode='P0001'; end if;
  insert into cellproject_private.external_operations(credential_id,owner_id,operation_id,fingerprint,project_id,account_operation,vault_revision,receipt)
    values(p_credential_id,p_owner_id,p_operation_id,p_fingerprint,p_project_id,p_account_operation,p_base_revision+1,p_receipt);
  insert into public.dynamic_diary_vault_operations(owner_id,operation_id,request_hash,response)
    values(p_owner_id,wire_id,wire_hash,jsonb_build_object('revision',p_base_revision+1));
  return jsonb_build_object('revision',p_base_revision+1,'replayed',false,'receipt',p_receipt);
end $$;

create function cellproject_private.external_blob_access(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_project_id text,p_account_operation boolean,p_id uuid,p_write boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare credential cellproject_private.external_credentials; result jsonb;
begin
  if p_id is null or p_write is null or p_account_operation is null then raise exception 'Invalid blob access' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  credential:=cellproject_private.external_assert_credential(p_credential_id,p_owner_id,p_vault_id,p_write,p_project_id,p_account_operation);
  if not p_write and (not ('read'=any(credential.permissions))
    or (p_account_operation and (p_project_id is not null or credential.projects<>'"*"'::jsonb))
    or (not p_account_operation and (p_project_id is null or p_project_id !~ '^[A-Za-z0-9_.:-]{1,180}$' or p_project_id in ('.','..') or (credential.projects<>'"*"'::jsonb and not credential.projects ? p_project_id)))) then
    raise exception 'External credential forbidden' using errcode='42501';
  end if;
  select jsonb_build_object('id',id,'sha256',sha256,'size',size) into result from public.dynamic_diary_vault_blobs where owner_id=p_owner_id and id=p_id;
  return result;
end $$;
create function cellproject_private.external_blob(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_project_id text,p_account_operation boolean,p_id uuid,p_hash text,p_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing jsonb;
begin
  if p_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_size is null or p_size not between 1 and 15728640 then raise exception 'Invalid encrypted blob' using errcode='22023'; end if;
  existing:=cellproject_private.external_blob_access(p_credential_id,p_owner_id,p_vault_id,p_project_id,p_account_operation,p_id,true);
  if existing is not null then
    if existing->>'sha256'<>p_hash or (existing->>'size')::bigint<>p_size then raise exception 'Blob conflict' using errcode='P0001'; end if;
    return existing;
  end if;
  if coalesce((select sum(size) from public.dynamic_diary_vault_blobs where owner_id=p_owner_id),0)+p_size>734003200 then raise exception 'Vault quota exceeded' using errcode='22023'; end if;
  insert into public.dynamic_diary_vault_blobs(owner_id,id,sha256,size) values(p_owner_id,p_id,p_hash,p_size);
  return jsonb_build_object('id',p_id,'sha256',p_hash,'size',p_size);
end $$;

-- Public functions are allowlisted transport wrappers. Privileged implementation
-- stays in a non-exposed schema; callers cannot mutate its tables directly.
create function public.cellproject_external_enroll(p_id uuid,p_name text,p_token_hash text,p_token_prefix text,p_projects jsonb,p_permissions text[],p_expires_at timestamptz,p_vault_id uuid,p_sealed_key jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select cellproject_private.external_enroll(p_id,p_name,p_token_hash,p_token_prefix,p_projects,p_permissions,p_expires_at,p_vault_id,p_sealed_key) $$;
create function public.cellproject_external_list() returns jsonb language sql stable security invoker set search_path='' as $$ select cellproject_private.external_list() $$;
create function public.cellproject_external_revoke(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select cellproject_private.external_revoke(p_id) $$;
create function public.cellproject_external_authenticate(p_token_hash text) returns jsonb language sql stable security invoker set search_path='' as $$ select cellproject_private.external_authenticate(p_token_hash) $$;
create function public.cellproject_external_snapshot(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select cellproject_private.external_snapshot(p_credential_id,p_owner_id,p_vault_id) $$;
create function public.cellproject_external_replay(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_operation_id text,p_fingerprint text,p_project_id text,p_account_operation boolean) returns jsonb language sql security invoker set search_path='' as $$ select cellproject_private.external_replay(p_credential_id,p_owner_id,p_vault_id,p_operation_id,p_fingerprint,p_project_id,p_account_operation) $$;
create function public.cellproject_external_commit(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_operation_id text,p_fingerprint text,p_project_id text,p_account_operation boolean,p_base_revision bigint,p_manifest jsonb,p_receipt jsonb) returns jsonb language sql security invoker set search_path='' as $$ select cellproject_private.external_commit(p_credential_id,p_owner_id,p_vault_id,p_operation_id,p_fingerprint,p_project_id,p_account_operation,p_base_revision,p_manifest,p_receipt) $$;
create function public.cellproject_external_blob_access(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_project_id text,p_account_operation boolean,p_id uuid,p_write boolean) returns jsonb language sql security invoker set search_path='' as $$ select cellproject_private.external_blob_access(p_credential_id,p_owner_id,p_vault_id,p_project_id,p_account_operation,p_id,p_write) $$;
create function public.cellproject_external_blob(p_credential_id uuid,p_owner_id uuid,p_vault_id uuid,p_project_id text,p_account_operation boolean,p_id uuid,p_hash text,p_size bigint) returns jsonb language sql security invoker set search_path='' as $$ select cellproject_private.external_blob(p_credential_id,p_owner_id,p_vault_id,p_project_id,p_account_operation,p_id,p_hash,p_size) $$;

revoke all on function cellproject_private.valid_external_projects(jsonb),cellproject_private.external_owner_active(uuid),cellproject_private.external_metadata(cellproject_private.external_credentials),cellproject_private.external_assert_credential(uuid,uuid,uuid,boolean,text,boolean) from public,anon,authenticated,service_role;
revoke all on function cellproject_private.external_enroll(uuid,text,text,text,jsonb,text[],timestamptz,uuid,jsonb),cellproject_private.external_list(),cellproject_private.external_revoke(uuid),cellproject_private.external_authenticate(text),cellproject_private.external_snapshot(uuid,uuid,uuid),cellproject_private.external_replay(uuid,uuid,uuid,text,text,text,boolean),cellproject_private.external_commit(uuid,uuid,uuid,text,text,text,boolean,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cellproject_external_enroll(uuid,text,text,text,jsonb,text[],timestamptz,uuid,jsonb),public.cellproject_external_list(),public.cellproject_external_revoke(uuid),public.cellproject_external_authenticate(text),public.cellproject_external_snapshot(uuid,uuid,uuid),public.cellproject_external_replay(uuid,uuid,uuid,text,text,text,boolean),public.cellproject_external_commit(uuid,uuid,uuid,text,text,text,boolean,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function cellproject_private.external_enroll(uuid,text,text,text,jsonb,text[],timestamptz,uuid,jsonb),cellproject_private.external_list(),cellproject_private.external_revoke(uuid),public.cellproject_external_enroll(uuid,text,text,text,jsonb,text[],timestamptz,uuid,jsonb),public.cellproject_external_list(),public.cellproject_external_revoke(uuid) to authenticated;
grant usage on schema cellproject_private to service_role;
grant execute on function cellproject_private.external_authenticate(text),cellproject_private.external_snapshot(uuid,uuid,uuid),cellproject_private.external_replay(uuid,uuid,uuid,text,text,text,boolean),cellproject_private.external_commit(uuid,uuid,uuid,text,text,text,boolean,bigint,jsonb,jsonb),public.cellproject_external_authenticate(text),public.cellproject_external_snapshot(uuid,uuid,uuid),public.cellproject_external_replay(uuid,uuid,uuid,text,text,text,boolean),public.cellproject_external_commit(uuid,uuid,uuid,text,text,text,boolean,bigint,jsonb,jsonb) to service_role;
revoke all on function cellproject_private.external_blob_access(uuid,uuid,uuid,text,boolean,uuid,boolean),cellproject_private.external_blob(uuid,uuid,uuid,text,boolean,uuid,text,bigint),public.cellproject_external_blob_access(uuid,uuid,uuid,text,boolean,uuid,boolean),public.cellproject_external_blob(uuid,uuid,uuid,text,boolean,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function cellproject_private.external_blob_access(uuid,uuid,uuid,text,boolean,uuid,boolean),cellproject_private.external_blob(uuid,uuid,uuid,text,boolean,uuid,text,bigint),public.cellproject_external_blob_access(uuid,uuid,uuid,text,boolean,uuid,boolean),public.cellproject_external_blob(uuid,uuid,uuid,text,boolean,uuid,text,bigint) to service_role;

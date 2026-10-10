-- Additive password access: preserve the vault ID, immutable header, manifest and
-- data key. The browser uploads only an encrypted recovery capability.
create table public.dynamic_diary_password_access (
  owner_id uuid primary key references public.dynamic_diary_vaults(owner_id) on delete cascade,
  vault_id uuid not null,
  access jsonb not null check(octet_length(access::text) <= 2048),
  revision bigint not null check(revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);
create table cellproject_private.password_access_operations (
  owner_id uuid not null references public.dynamic_diary_vaults(owner_id) on delete cascade,
  operation_id text not null check(operation_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null,
  primary key(owner_id,operation_id)
);
alter table public.dynamic_diary_password_access enable row level security;
alter table cellproject_private.password_access_operations enable row level security;
-- Strip managed defaults; the client may read its row but never write tables or
-- the ledger directly. Mutations pass through the checked, private RPC below.
revoke all on public.dynamic_diary_password_access,cellproject_private.password_access_operations from public,anon,authenticated,service_role;
grant select on public.dynamic_diary_password_access to authenticated;
create policy owner_password_access on public.dynamic_diary_password_access for select to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));

create function cellproject_private.validate_password_access(p_value jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not coalesce(jsonb_typeof(p_value)='object' and
    (select array_agg(key order by key) from jsonb_object_keys(p_value) key)=array['cipher','format','kdf','ownerId','vaultId','version'] and
    p_value->>'format'='dynamic-diary-password-access' and p_value->>'version'='1' and jsonb_typeof(p_value->'version')='number' and
    jsonb_typeof(p_value->'ownerId')='string' and length(p_value->>'ownerId') between 1 and 180 and
    jsonb_typeof(p_value->'vaultId')='string' and p_value->>'vaultId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and
    jsonb_typeof(p_value->'kdf')='object' and
    (select array_agg(key order by key) from jsonb_object_keys(p_value->'kdf') key)=array['hash','iterations','name','salt'] and
    p_value->'kdf'->>'name'='PBKDF2' and p_value->'kdf'->>'hash'='SHA-256' and
    p_value->'kdf'->>'iterations'='600000' and jsonb_typeof(p_value->'kdf'->'iterations')='number' and
    jsonb_typeof(p_value->'kdf'->'salt')='string' and p_value->'kdf'->>'salt' ~ '^[A-Za-z0-9+/]{22}==$' and
    octet_length(decode(p_value->'kdf'->>'salt','base64'))=16 and
    encode(decode(p_value->'kdf'->>'salt','base64'),'base64')=p_value->'kdf'->>'salt',false) then
    raise exception 'Invalid password access' using errcode='22023';
  end if;
  perform cellproject_private.validate_cipher(p_value->'cipher',256);
end $$;

-- Privileged functions stay outside exposed schemas. Explicit identity checks
-- remain mandatory because SECURITY DEFINER bypasses table RLS.
create function cellproject_private.password_access_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account uuid:=auth.uid(); result jsonb;
begin
  if account is null or not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  select jsonb_build_object('access',a.access,'revision',a.revision) into result
    from public.dynamic_diary_password_access a
    join public.dynamic_diary_vaults v on v.owner_id=a.owner_id and v.header->>'id'=a.vault_id::text
    where a.owner_id=account;
  return coalesce(result,'{"access":null}'::jsonb);
end $$;
create function cellproject_private.write_password_access(p_access jsonb,p_base_revision bigint,p_operation_id text,p_expected_owner_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare account uuid:=auth.uid(); canonical_id text; current_revision bigint; req text;
  existing cellproject_private.password_access_operations; reply jsonb;
begin
  if account is null or not cellproject_private.is_allowed_user() or p_expected_owner_id is distinct from account then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_operation_id is null or p_operation_id !~ '^[A-Za-z0-9_.:-]{1,160}$' or p_base_revision is null or p_base_revision<0 or p_base_revision>=9007199254740991 then raise exception 'Invalid password access operation' using errcode='22023'; end if;
  perform cellproject_private.validate_password_access(p_access);
  if p_access->>'ownerId' is distinct from account::text then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(account::text,0));
  select header->>'id' into canonical_id from public.dynamic_diary_vaults where owner_id=account;
  if canonical_id is null or canonical_id is distinct from p_access->>'vaultId' then raise exception 'Vault conflict' using errcode='P0001'; end if;
  req:=encode(sha256(convert_to(jsonb_build_array('password-access',account,p_access,p_base_revision)::text,'UTF8')),'hex');
  select * into existing from cellproject_private.password_access_operations where owner_id=account and operation_id=p_operation_id;
  if found then
    if existing.request_hash<>req then raise exception 'Operation conflict' using errcode='P0001'; end if;
    return existing.response;
  end if;
  select revision into current_revision from public.dynamic_diary_password_access where owner_id=account;
  if coalesce(current_revision,0)<>p_base_revision then raise exception 'Revision conflict' using errcode='P0001'; end if;
  if current_revision is null then
    insert into public.dynamic_diary_password_access(owner_id,vault_id,access,revision)
      values(account,canonical_id::uuid,p_access,1);
  else
    update public.dynamic_diary_password_access set access=p_access,revision=revision+1,updated_at=now()
      where owner_id=account and vault_id=canonical_id::uuid and revision=p_base_revision;
    if not found then raise exception 'Revision conflict' using errcode='P0001'; end if;
  end if;
  reply:=jsonb_build_object('revision',p_base_revision+1);
  insert into cellproject_private.password_access_operations(owner_id,operation_id,request_hash,response)
    values(account,p_operation_id,req,reply);
  return reply;
end $$;

create function public.dynamic_diary_password_access_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
  select cellproject_private.password_access_snapshot()
$$;
create function public.dynamic_diary_write_password_access(p_access jsonb,p_base_revision bigint,p_operation_id text,p_expected_owner_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select cellproject_private.write_password_access(p_access,p_base_revision,p_operation_id,p_expected_owner_id)
$$;
revoke all on function cellproject_private.validate_password_access(jsonb),cellproject_private.password_access_snapshot(),cellproject_private.write_password_access(jsonb,bigint,text,uuid),public.dynamic_diary_password_access_snapshot(),public.dynamic_diary_write_password_access(jsonb,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function cellproject_private.password_access_snapshot(),cellproject_private.write_password_access(jsonb,bigint,text,uuid),public.dynamic_diary_password_access_snapshot(),public.dynamic_diary_write_password_access(jsonb,bigint,text,uuid) to authenticated;

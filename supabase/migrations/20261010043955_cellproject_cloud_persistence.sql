-- Exact, versioned application envelopes. No credentials, flattened lossy exports,
-- Edge Functions or public media. Normal API calls use the authenticated JWT.
create schema cellproject_private;
revoke all on schema cellproject_private from public, anon;
grant usage on schema cellproject_private to authenticated;

create table cellproject_private.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  admitted_at timestamptz not null default now()
);
alter table cellproject_private.allowed_users enable row level security;
revoke all on cellproject_private.allowed_users from public, anon, authenticated;

-- Admission is managed by Auth's actual record, never user_metadata or client input.
create function cellproject_private.admit_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email,'')) <> 'wylgnerbossman@gmail.com'
     or coalesce(new.is_anonymous,false) then
    raise exception 'Registration is restricted' using errcode = '42501';
  end if;
  if tg_when = 'AFTER' then
    insert into cellproject_private.allowed_users(user_id) values(new.id)
      on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function cellproject_private.admit_user() from public, anon, authenticated;
create trigger cellproject_restrict_signup before insert on auth.users
for each row execute function cellproject_private.admit_user();
create trigger cellproject_admit_signup after insert on auth.users
for each row execute function cellproject_private.admit_user();

-- This private privileged lookup is the only authorization exception to RLS.
-- An authenticated UID, confirmed email, live Auth session and admission are required.
create function cellproject_private.is_allowed_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from cellproject_private.allowed_users a
    join auth.users u on u.id = a.user_id
    join auth.sessions s on s.user_id = u.id
    where a.user_id = auth.uid()
      and lower(u.email) = 'wylgnerbossman@gmail.com'
      and u.email_confirmed_at is not null and not u.is_anonymous
      and (u.banned_until is null or u.banned_until <= now())
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  )
$$;
revoke all on function cellproject_private.is_allowed_user() from public, anon;
grant execute on function cellproject_private.is_allowed_user() to authenticated;

create function public.cellproject_authorized() returns boolean
language sql stable security invoker set search_path = '' as $$
  select cellproject_private.is_allowed_user()
$$;
revoke all on function public.cellproject_authorized() from public, anon;
grant execute on function public.cellproject_authorized() to authenticated;

create table public.cellproject_documents (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('cellproject-workspace','cellproject-graph','dynamic_diary-chat','cellproject-kb','cellproject-config','cellproject-locale','dynamic_diary-theme','dynamic_diary-sidebar-collapsed','dynamic_diary:task-view')),
  value text not null check (octet_length(value) <= 33554432),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key(owner_id,key)
);
create table public.cellproject_operations (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id text not null check(length(operation_id) between 1 and 200),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,operation_id)
);
create table public.cellproject_media (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check(length(id) between 1 and 200),
  mime text not null check(mime in ('application/pdf','text/plain','text/markdown','image/png','image/jpeg','image/webp')),
  name text not null check(length(name) <= 1000),
  project_id text,
  created_at_ms bigint,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  size bigint not null check(size between 1 and 10485760) check(mime not like 'image/%' or size<=5242880),
  path text not null,
  primary key(owner_id,id),
  unique(owner_id,path)
);

alter table public.cellproject_documents enable row level security;
alter table public.cellproject_operations enable row level security;
alter table public.cellproject_media enable row level security;
revoke all on public.cellproject_documents, public.cellproject_operations, public.cellproject_media from public, anon;
grant select,insert,update,delete on public.cellproject_documents, public.cellproject_operations, public.cellproject_media to authenticated;
create policy owner_documents on public.cellproject_documents to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()))
with check(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));
create policy owner_operations on public.cellproject_operations to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()))
with check(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));
create policy owner_media on public.cellproject_media to authenticated
using(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()))
with check(owner_id=(select auth.uid()) and (select cellproject_private.is_allowed_user()));

create function cellproject_private.validate_document(p_key text,p_value text) returns void
language plpgsql security invoker set search_path = '' as $$
declare payload jsonb;
begin
  if p_key is null or p_value is null or octet_length(p_value)>33554432 then
    raise exception 'Invalid document' using errcode='22023';
  end if;
  if p_key in ('dynamic_diary-theme','dynamic_diary-sidebar-collapsed','dynamic_diary:task-view') then
    return;
  end if;
  payload := p_value::jsonb;
  if p_key='cellproject-config' and exists (
    select 1 from jsonb_each(coalesce(payload->'state'->'providers','{}'::jsonb)) p
    where coalesce(p.value->>'apiKey','') <> ''
  ) then
    raise exception 'Provider credentials are not document data' using errcode='22023';
  end if;
end $$;
revoke all on function cellproject_private.validate_document(text,text) from public,anon;
grant execute on function cellproject_private.validate_document(text,text) to authenticated;

create function public.cellproject_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'documents',coalesce((select jsonb_agg(jsonb_build_object('key',key,'value',value,'revision',revision) order by key) from public.cellproject_documents),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',id,'mime',mime,'name',name,'projectId',project_id,'createdAt',created_at_ms,'sha256',sha256,'size',size) order by id) from public.cellproject_media),'[]'::jsonb)
  )
$$;
revoke all on function public.cellproject_snapshot() from public,anon;
grant execute on function public.cellproject_snapshot() to authenticated;

create function public.cellproject_write_document(p_key text,p_value text,p_base_revision bigint,p_operation_id text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare request_hash text; existing public.cellproject_operations; current_rev bigint; reply jsonb;
begin
  if not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  perform cellproject_private.validate_document(p_key,p_value);
  if p_base_revision is null or p_base_revision < 0 then raise exception 'Invalid revision' using errcode='22023'; end if;
  request_hash := encode(sha256(convert_to(jsonb_build_array('write',p_key,p_value,p_base_revision)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.cellproject_operations where operation_id=p_operation_id;
  if found then
    if existing.request_hash<>request_hash then raise exception 'Operation conflict' using errcode='P0001'; end if;
    return existing.response;
  end if;
  select revision into current_rev from public.cellproject_documents where key=p_key;
  if coalesce(current_rev,0)<>p_base_revision then raise exception 'Revision conflict' using errcode='P0001'; end if;
  insert into public.cellproject_documents(key,value,revision) values(p_key,p_value,p_base_revision+1)
    on conflict(owner_id,key) do update set value=excluded.value,revision=excluded.revision,updated_at=now();
  reply := jsonb_build_object('revision',p_base_revision+1);
  insert into public.cellproject_operations(operation_id,request_hash,response) values(p_operation_id,request_hash,reply);
  return reply;
end $$;
revoke all on function public.cellproject_write_document(text,text,bigint,text) from public,anon;
grant execute on function public.cellproject_write_document(text,text,bigint,text) to authenticated;

create function public.cellproject_import(p_documents jsonb,p_manifest_hash text,p_operation_id text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare request_hash text; existing public.cellproject_operations; doc jsonb; current_value text; reply jsonb;
begin
  if not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_documents is null or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)>9 or p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid import' using errcode='22023';
  end if;
  if (select count(distinct d->>'key') from jsonb_array_elements(p_documents)d)<>jsonb_array_length(p_documents) then
    raise exception 'Duplicate document' using errcode='22023';
  end if;
  request_hash:=encode(sha256(convert_to(jsonb_build_array('import',p_documents,p_manifest_hash)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.cellproject_operations where operation_id=p_operation_id;
  if found then
    if existing.request_hash<>request_hash then raise exception 'Operation conflict' using errcode='P0001'; end if;
    return existing.response;
  end if;
  for doc in select * from jsonb_array_elements(p_documents) loop
    perform cellproject_private.validate_document(doc->>'key',doc->>'value');
    select value into current_value from public.cellproject_documents where key=doc->>'key';
    if found and current_value<>(doc->>'value') then raise exception 'Import conflict' using errcode='P0001'; end if;
    insert into public.cellproject_documents(key,value) values(doc->>'key',doc->>'value') on conflict do nothing;
  end loop;
  select jsonb_build_object('documents',coalesce(jsonb_agg(jsonb_build_object('key',key,'revision',revision) order by key),'[]'::jsonb)) into reply from public.cellproject_documents
    where key in (select d->>'key' from jsonb_array_elements(p_documents)d);
  insert into public.cellproject_operations(operation_id,request_hash,response) values(p_operation_id,request_hash,reply);
  return reply;
end $$;
revoke all on function public.cellproject_import(jsonb,text,text) from public,anon;
grant execute on function public.cellproject_import(jsonb,text,text) to authenticated;

create function public.cellproject_write_media(p_metadata jsonb,p_operation_id text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare request_hash text; existing public.cellproject_operations; media public.cellproject_media; reply jsonb; expected_path text;
begin
  if not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  expected_path:=auth.uid()::text||'/'||encode(sha256(convert_to(p_metadata->>'id','UTF8')),'hex')||'/'||(p_metadata->>'sha256');
  if (p_metadata->>'path') is distinct from expected_path or (p_metadata->>'sha256') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid media path' using errcode='22023'; end if;
  request_hash:=encode(sha256(convert_to(jsonb_build_array('media',p_metadata)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.cellproject_operations where operation_id=p_operation_id;
  if found then
    if existing.request_hash<>request_hash then raise exception 'Operation conflict' using errcode='P0001'; end if;
    return existing.response;
  end if;
  select * into media from public.cellproject_media where id=p_metadata->>'id';
  if found and (media.sha256<>(p_metadata->>'sha256') or media.size<>(p_metadata->>'size')::bigint or media.mime<>(p_metadata->>'mime') or media.name<>(p_metadata->>'name') or media.project_id is distinct from p_metadata->>'projectId') then raise exception 'Media conflict' using errcode='P0001'; end if;
  if not found then
    if coalesce((select sum(size) from public.cellproject_media),0)+(p_metadata->>'size')::bigint>524288000 then
      raise exception 'Media quota exceeded' using errcode='22023';
    end if;
    if coalesce((select sum(size) from public.cellproject_media where project_id is not distinct from p_metadata->>'projectId'),0)+(p_metadata->>'size')::bigint>52428800 then
      raise exception 'Project media quota exceeded' using errcode='22023';
    end if;
    insert into public.cellproject_media(id,mime,name,project_id,created_at_ms,sha256,size,path)
    values(p_metadata->>'id',p_metadata->>'mime',p_metadata->>'name',p_metadata->>'projectId',(p_metadata->>'createdAt')::bigint,p_metadata->>'sha256',(p_metadata->>'size')::bigint,expected_path);
  end if;
  reply:=jsonb_build_object('id',p_metadata->>'id','sha256',p_metadata->>'sha256','size',(p_metadata->>'size')::bigint);
  insert into public.cellproject_operations(operation_id,request_hash,response) values(p_operation_id,request_hash,reply);
  return reply;
end $$;
revoke all on function public.cellproject_write_media(jsonb,text) from public,anon;
grant execute on function public.cellproject_write_media(jsonb,text) to authenticated;

create function public.cellproject_delete_media(p_id text,p_operation_id text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare request_hash text; existing public.cellproject_operations; reply jsonb := '{"deleted":true}'::jsonb;
begin
  if not cellproject_private.is_allowed_user() then raise exception 'Forbidden' using errcode='42501'; end if;
  request_hash:=encode(sha256(convert_to(jsonb_build_array('deleteMedia',p_id)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.cellproject_operations where operation_id=p_operation_id;
  if found then
    if existing.request_hash<>request_hash then raise exception 'Operation conflict' using errcode='P0001'; end if;
    return existing.response;
  end if;
  delete from public.cellproject_media where id=p_id;
  insert into public.cellproject_operations(operation_id,request_hash,response) values(p_operation_id,request_hash,reply);
  return reply;
end $$;
revoke all on function public.cellproject_delete_media(text,text) from public,anon;
grant execute on function public.cellproject_delete_media(text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cellproject-media','cellproject-media',false,10485760,array['application/pdf','text/plain','text/markdown','image/png','image/jpeg','image/webp']);
create policy cellproject_read_media on storage.objects for select to authenticated
using(bucket_id='cellproject-media' and (storage.foldername(name))[1]=(select auth.uid())::text and (select cellproject_private.is_allowed_user()));
create policy cellproject_insert_media on storage.objects for insert to authenticated
with check(bucket_id='cellproject-media' and (storage.foldername(name))[1]=(select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}/[0-9a-f]{64}$' and (select cellproject_private.is_allowed_user()));
-- Files are immutable: no UPDATE/upsert permission and no client object deletion.
-- Catalog deletion is recoverable while bytes remain retained for backup/restore.

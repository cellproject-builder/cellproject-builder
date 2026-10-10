-- Managed Supabase rejects unqualified DELETE/UPDATE even when RLS scopes rows.
-- Keep explicit ownership predicates and RLS; preserve atomic activation and CAS.
-- Supabase public-schema defaults grant ALL to API roles. Reset inherited grants
-- before applying the intended minimum (GRANT alone never removes privileges).
revoke all on public.dynamic_diary_vaults,public.dynamic_diary_vault_operations,public.dynamic_diary_vault_blobs from public,anon,authenticated,service_role;
grant select,insert,update on public.dynamic_diary_vaults to authenticated;
grant select,insert on public.dynamic_diary_vault_operations,public.dynamic_diary_vault_blobs to authenticated;
-- Storage's final legacy upload executes without a user JWT under service_role.
-- The legacy-write guard needs to see whether this owner has enabled encryption.
grant select on public.dynamic_diary_vaults to service_role;

create or replace function public.dynamic_diary_activate_vault(p_header jsonb,p_manifest jsonb,p_expected_documents jsonb,p_operation_id text) returns jsonb
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
  delete from public.cellproject_documents where owner_id=auth.uid();
  delete from public.cellproject_operations where owner_id=auth.uid();
  insert into public.dynamic_diary_vaults(header,manifest,revision) values(p_header,p_manifest,1);
  insert into public.dynamic_diary_vault_operations(operation_id,request_hash,response) values(p_operation_id,req,reply); return reply;
end $$;

create or replace function public.dynamic_diary_write_vault(p_manifest jsonb,p_base_revision bigint,p_operation_id text) returns jsonb
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
  update public.dynamic_diary_vaults set manifest=p_manifest,revision=revision+1,updated_at=now() where owner_id=auth.uid();
  reply:=jsonb_build_object('revision',rev+1);
  insert into public.dynamic_diary_vault_operations(operation_id,request_hash,response) values(p_operation_id,req,reply); return reply;
end $$;

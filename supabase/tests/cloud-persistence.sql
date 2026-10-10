-- Run inside BEGIN/ROLLBACK after applying the migration in the same transaction.
-- These synthetic Auth records never persist and no email is sent.
do $$
declare test_user uuid:=gen_random_uuid(); test_session uuid:=gen_random_uuid(); a jsonb; b jsonb;
begin
  begin
    insert into auth.users(id,email) values(gen_random_uuid(),'synthetic-denied@example.invalid');
    raise exception 'FAIL: signup should be restricted';
  exception when insufficient_privilege then null; end;
  insert into auth.users(id,email,email_confirmed_at) values(test_user,'wylgnerbossman@gmail.com',null);
  insert into auth.sessions(id,user_id) values(test_session,test_user);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated','session_id',test_session)::text,true);
  execute 'set local role authenticated';
  if public.cellproject_authorized() then raise exception 'FAIL: unconfirmed email allowed'; end if;
  execute 'reset role';
  update auth.users set email_confirmed_at=now() where id=test_user;
  execute 'set local role authenticated';
  if not public.cellproject_authorized() then raise exception 'FAIL: allowed confirmed session denied'; end if;
  a:=public.cellproject_write_document('cellproject-workspace','{"state":{"projects":{},"attachments":["preserved"]},"version":2}',0,'test-write');
  b:=public.cellproject_write_document('cellproject-workspace','{"state":{"projects":{},"attachments":["preserved"]},"version":2}',0,'test-write');
  if a<>b or a->>'revision'<>'1' then raise exception 'FAIL: idempotent replay'; end if;
  begin
    perform public.cellproject_write_document('cellproject-workspace','{}',0,'stale-write');
    raise exception 'FAIL: stale revision accepted' using errcode='22023';
  exception when raise_exception then null; end;
  begin
    perform public.cellproject_write_document('cellproject-kb','{}',0,'test-write');
    raise exception 'FAIL: conflicting operation accepted' using errcode='22023';
  exception when raise_exception then null; end;
  begin
    perform public.cellproject_write_document('cellproject-config','{"state":{"providers":{"openrouter":{"apiKey":"synthetic-secret"}}}}',0,'secret');
    raise exception 'FAIL: config secret accepted';
  exception when invalid_parameter_value then null; end;
  a:=public.cellproject_import('[{"key":"cellproject-kb","value":"{\"state\":{\"documents\":[]},\"version\":2}"}]',repeat('a',64),'test-import');
  b:=public.cellproject_import('[{"key":"cellproject-kb","value":"{\"state\":{\"documents\":[]},\"version\":2}"}]',repeat('a',64),'test-import');
  if a<>b then raise exception 'FAIL: import replay'; end if;
  begin
    perform public.cellproject_import('[{"key":"cellproject-kb","value":"{}"}]',repeat('b',64),'divergent-import');
    raise exception 'FAIL: divergent import accepted' using errcode='22023';
  exception when raise_exception then null; end;
  begin
    update public.cellproject_documents set owner_id=gen_random_uuid();
    raise exception 'FAIL: owner reassignment accepted';
  exception when insufficient_privilege then null; end;
  if jsonb_array_length(public.cellproject_snapshot()->'documents')<>2 then raise exception 'FAIL: snapshot'; end if;
  perform public.cellproject_write_document('dynamic_diary-theme','dark',0,'theme');
  if (select value from public.cellproject_documents where key='dynamic_diary-theme')<>'dark' then raise exception 'FAIL: preference'; end if;
  a:=jsonb_build_object('id','synthetic-media','mime','image/png','name','synthetic.png','projectId','synthetic-project','createdAt',123,'sha256',repeat('a',64),'size',100,'path',test_user::text||'/'||encode(sha256(convert_to('synthetic-media','UTF8')),'hex')||'/'||repeat('a',64));
  b:=public.cellproject_write_media(a,'test-media');
  if b<>public.cellproject_write_media(a,'test-media') then raise exception 'FAIL: media replay'; end if;
  begin
    perform public.cellproject_write_media(a||jsonb_build_object('path','other-owner/path'),'bad-path');
    raise exception 'FAIL: foreign media path accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.cellproject_write_media(a||jsonb_build_object('sha256',repeat('b',64),'path',test_user::text||'/'||encode(sha256(convert_to('synthetic-media','UTF8')),'hex')||'/'||repeat('b',64)),'changed-media');
    raise exception 'FAIL: changed media accepted' using errcode='22023';
  exception when raise_exception then null; end;
  if jsonb_array_length(public.cellproject_snapshot()->'media')<>1 then raise exception 'FAIL: media snapshot'; end if;
  perform public.cellproject_delete_media('synthetic-media','delete-media');
  perform public.cellproject_delete_media('synthetic-media','delete-media');
  if jsonb_array_length(public.cellproject_snapshot()->'media')<>0 then raise exception 'FAIL: media delete'; end if;
  execute 'reset role';
  delete from auth.sessions where id=test_session;
  execute 'set local role authenticated';
  if public.cellproject_authorized() then raise exception 'FAIL: revoked session allowed'; end if;
  if jsonb_array_length(public.cellproject_snapshot()->'documents')<>0 then raise exception 'FAIL: revoked session read'; end if;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform count(*) from public.cellproject_documents;
    raise exception 'FAIL: anonymous read accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $$;

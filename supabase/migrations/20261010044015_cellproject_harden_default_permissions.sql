-- Keep Supabase's automatic RLS event trigger, but remove public RPC execution.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- Explicit denial documents that this admission table has no client write/read path.
create policy deny_client_admission on cellproject_private.allowed_users to authenticated
using(false) with check(false);

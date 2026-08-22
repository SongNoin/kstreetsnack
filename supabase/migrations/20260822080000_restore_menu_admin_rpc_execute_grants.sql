-- Restore the public operator-management RPC ACLs for upgraded projects.
--
-- The Google-session wrappers are intentionally executable only by signed-in
-- users. Reasserting these grants in a follow-up migration repairs ACL drift
-- without exposing the internal implementations or changing any operator data.

begin;

do $verify_menu_admin_wrappers$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.request_menu_admin_access()',
    'public.list_menu_admin_candidates()',
    'public.set_menu_admin_access(uuid,text,boolean,text,boolean,timestamptz)',
    'public.reject_menu_admin_access_request(uuid,timestamptz)',
    'public.delete_menu_admin_access(uuid,text,boolean,timestamptz)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'Required menu admin RPC is missing: %', v_signature
        using errcode = '42883';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = pg_catalog.to_regprocedure(v_signature)
        and procedure.prosecdef
    ) then
      raise exception 'Menu admin RPC must remain SECURITY DEFINER: %', v_signature
        using errcode = '42501';
    end if;
  end loop;
end
$verify_menu_admin_wrappers$;

revoke all on function public.request_menu_admin_access()
from public, anon, authenticated, service_role;
revoke all on function public.list_menu_admin_candidates()
from public, anon, authenticated, service_role;
revoke all on function public.set_menu_admin_access(uuid, text, boolean, text, boolean, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.reject_menu_admin_access_request(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.delete_menu_admin_access(uuid, text, boolean, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.request_menu_admin_access() to authenticated;
grant execute on function public.list_menu_admin_candidates() to authenticated;
grant execute on function public.set_menu_admin_access(uuid, text, boolean, text, boolean, timestamptz)
to authenticated;
grant execute on function public.reject_menu_admin_access_request(uuid, timestamptz)
to authenticated;
grant execute on function public.delete_menu_admin_access(uuid, text, boolean, timestamptz)
to authenticated;

do $verify_menu_admin_execute_acl$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.request_menu_admin_access()',
    'public.list_menu_admin_candidates()',
    'public.set_menu_admin_access(uuid,text,boolean,text,boolean,timestamptz)',
    'public.reject_menu_admin_access_request(uuid,timestamptz)',
    'public.delete_menu_admin_access(uuid,text,boolean,timestamptz)'
  ] loop
    if not pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'Authenticated execute grant was not restored: %', v_signature
        using errcode = '42501';
    end if;

    if pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'Menu admin RPC is executable by an unintended role: %', v_signature
        using errcode = '42501';
    end if;
  end loop;
end
$verify_menu_admin_execute_acl$;

commit;

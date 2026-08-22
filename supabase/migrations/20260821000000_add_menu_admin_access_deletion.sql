-- Allow an active owner to permanently remove an inactive operator record.
--
-- This removes only menu-tool authorization state. The target Auth user and
-- Google identity deliberately remain in auth.users/auth.identities so the
-- person can sign in later and submit a new access request.

begin;

create or replace function public.delete_menu_admin_access(
  p_user_id uuid,
  p_expected_role text,
  p_expected_is_active boolean,
  p_expected_requested_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_existing_role text;
  v_existing_is_active boolean;
  v_existing_requested_at timestamptz;
begin
  -- Reject unauthorised callers before taking the heavyweight serialization
  -- lock. The owner check is repeated after waiting for the lock.
  if v_caller_id is null or not exists (
    select 1
    from public.admin_users as caller
    where caller.user_id = v_caller_id
      and caller.role = 'owner'
      and caller.is_active
  ) then
    raise exception 'Only an active owner may permanently remove menu administration access.'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'A target Auth user is required.' using errcode = '22023';
  end if;
  if p_user_id = v_caller_id then
    raise exception 'An owner cannot permanently remove their own account.'
      using errcode = '42501';
  end if;
  if p_expected_role is null or p_expected_role not in ('owner', 'manager', 'staff') then
    raise exception 'Expected menu administration role must be owner, manager, or staff.'
      using errcode = '22023';
  end if;
  if p_expected_is_active is null then
    raise exception 'Expected menu administration active state is required.'
      using errcode = '22023';
  end if;
  if p_expected_is_active then
    raise exception 'An active operator must be deactivated before permanent removal.'
      using errcode = '55000';
  end if;

  -- request/set/reject/delete all serialize on this same table lock. This also
  -- makes the request-row cleanup below atomic with deleting admin_users.
  lock table public.admin_users in exclusive mode;

  if not exists (
    select 1
    from public.admin_users as caller
    where caller.user_id = v_caller_id
      and caller.role = 'owner'
      and caller.is_active
  ) then
    raise exception 'Owner access changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  select target_admin.role, target_admin.is_active
  into v_existing_role, v_existing_is_active
  from public.admin_users as target_admin
  where target_admin.user_id = p_user_id;

  if not found then
    raise exception 'Menu administration access changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  -- Never let this RPC remove a currently usable account, even if a stale or
  -- malicious client supplied a different expected state.
  if v_existing_is_active then
    raise exception 'An active operator must be deactivated before permanent removal.'
      using errcode = '55000';
  end if;

  select access_request.requested_at
  into v_existing_requested_at
  from public.menu_admin_access_requests as access_request
  where access_request.user_id = p_user_id;

  if v_existing_role is distinct from p_expected_role
     or v_existing_is_active is distinct from p_expected_is_active
     or v_existing_requested_at is distinct from p_expected_requested_at then
    raise exception 'Menu administration access changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  -- Delete only application authorization state. No statement in this RPC
  -- deletes from auth.users or auth.identities.
  delete from public.menu_admin_access_requests as access_request
  where access_request.user_id = p_user_id;

  delete from public.admin_users as target_admin
  where target_admin.user_id = p_user_id;

  if not found then
    raise exception 'Menu administration access changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_menu_admin_access(uuid, text, boolean, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.delete_menu_admin_access(uuid, text, boolean, timestamptz)
to authenticated;

commit;

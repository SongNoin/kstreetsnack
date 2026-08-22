-- Owner-managed access requests and role administration for the menu tool.
--
-- Auth users are never exposed as a general directory. A Google user must first
-- request access for their own UID; owners can then review existing admins plus
-- those explicit requests through a minimal SECURITY DEFINER projection.

begin;

create table if not exists public.menu_admin_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create table if not exists public.menu_admin_access_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  target_user_id uuid not null,
  operation text not null,
  old_role text,
  old_is_active boolean,
  new_role text,
  new_is_active boolean,
  changed_at timestamptz not null default now(),
  constraint menu_admin_access_audit_operation_allowed
    check (operation in ('insert', 'update', 'delete', 'request_rejected')),
  constraint menu_admin_access_audit_old_role_allowed
    check (old_role is null or old_role in ('owner', 'manager', 'staff')),
  constraint menu_admin_access_audit_new_role_allowed
    check (new_role is null or new_role in ('owner', 'manager', 'staff'))
);

alter table public.menu_admin_access_requests enable row level security;
alter table public.menu_admin_access_audit enable row level security;

-- The table has no authenticated policies by design. Browser clients use only
-- the RPCs below; service_role remains available for break-glass maintenance.
revoke all on table public.menu_admin_access_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.menu_admin_access_requests to service_role;
revoke all on table public.menu_admin_access_audit from public, anon, authenticated;
grant select on table public.menu_admin_access_audit to service_role;

-- This migration may be re-applied to a development project that already has
-- the original RPCs. Revoke and remove those shorter overloads first so stale
-- clients cannot bypass the expected-state checks added below.
do $remove_legacy_overloads$
begin
  if pg_catalog.to_regprocedure('public.set_menu_admin_access(uuid,text,boolean)') is not null then
    execute 'revoke all on function public.set_menu_admin_access(uuid, text, boolean) from public, anon, authenticated, service_role';
    execute 'drop function public.set_menu_admin_access(uuid, text, boolean)';
  end if;
  if pg_catalog.to_regprocedure('public.reject_menu_admin_access_request(uuid)') is not null then
    execute 'revoke all on function public.reject_menu_admin_access_request(uuid) from public, anon, authenticated, service_role';
    execute 'drop function public.reject_menu_admin_access_request(uuid)';
  end if;
end
$remove_legacy_overloads$;

create or replace function public.audit_menu_admin_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.menu_admin_access_audit (
    actor_user_id,
    target_user_id,
    operation,
    old_role,
    old_is_active,
    new_role,
    new_is_active,
    changed_at
  ) values (
    auth.uid(),
    case when tg_op = 'DELETE' then old.user_id else new.user_id end,
    pg_catalog.lower(tg_op),
    case when tg_op = 'INSERT' then null else old.role end,
    case when tg_op = 'INSERT' then null else old.is_active end,
    case when tg_op = 'DELETE' then null else new.role end,
    case when tg_op = 'DELETE' then null else new.is_active end,
    pg_catalog.clock_timestamp()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.reject_menu_admin_access_request(
  p_user_id uuid,
  p_expected_requested_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null or not exists (
    select 1
    from public.admin_users as caller
    where caller.user_id = v_caller_id
      and caller.role = 'owner'
      and caller.is_active
  ) then
    raise exception 'Only an active owner may reject menu administration requests.'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = v_caller_id then
    raise exception 'A different target Auth user is required.' using errcode = '22023';
  end if;
  if p_expected_requested_at is null then
    raise exception 'The expected request timestamp is required.' using errcode = '22023';
  end if;

  -- Share the same serialization boundary as request/approval. Recheck the
  -- caller after waiting so a concurrently demoted owner cannot reject a
  -- request using stale authorization.
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

  delete from public.menu_admin_access_requests as access_request
  where access_request.user_id = p_user_id
    and access_request.requested_at is not distinct from p_expected_requested_at;

  if not found then
    raise exception 'The menu administration request changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  insert into public.menu_admin_access_audit (
    actor_user_id,
    target_user_id,
    operation,
    changed_at
  ) values (
    v_caller_id,
    p_user_id,
    'request_rejected',
    pg_catalog.clock_timestamp()
  );

  return true;
end;
$$;

drop trigger if exists admin_users_audit_access_change on public.admin_users;
create trigger admin_users_audit_access_change
after insert or update or delete on public.admin_users
for each row execute function public.audit_menu_admin_access_change();

-- Existing bootstrap migrations allowed owner DML through PostgREST. Keep the
-- owner/self read policy, but make every browser mutation go through the atomic
-- RPC so self-lockout and last-owner checks cannot be bypassed.
drop policy if exists admin_users_owner_insert on public.admin_users;
drop policy if exists admin_users_owner_update on public.admin_users;
drop policy if exists admin_users_owner_delete on public.admin_users;
revoke insert, update, delete on table public.admin_users from authenticated;

create or replace function public.prevent_menu_admin_owner_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removes_active_owner boolean;
begin
  v_removes_active_owner := false;
  if old.role = 'owner' and old.is_active then
    if tg_op = 'DELETE' then
      v_removes_active_owner := true;
    else
      v_removes_active_owner := new.role <> 'owner' or not new.is_active;
    end if;
  end if;

  if not v_removes_active_owner then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Add a defense-in-depth check for ordinary READ COMMITTED privileged writes
  -- and auth.users cascades. The owner RPC's exclusive table lock remains the
  -- authoritative concurrency contract for application mutations.
  perform pg_catalog.pg_advisory_xact_lock(662061563457110138);

  if auth.uid() = old.user_id then
    raise exception 'An owner cannot demote, deactivate, or delete their own account.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.admin_users as another_owner
    where another_owner.role = 'owner'
      and another_owner.is_active
      and another_owner.user_id <> old.user_id
  ) then
    raise exception 'The last active owner cannot be demoted, deactivated, or deleted.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists admin_users_prevent_owner_lockout on public.admin_users;
create trigger admin_users_prevent_owner_lockout
before update or delete on public.admin_users
for each row execute function public.prevent_menu_admin_owner_lockout();

create or replace function public.request_menu_admin_access()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requested_at timestamptz;
begin
  if v_user_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Authentication is required to request menu administration access.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as u
    join auth.identities as i
      on i.user_id = u.id
     and i.provider = 'google'
    where u.id = v_user_id
  ) then
    raise exception 'Only a Google identity may request menu administration access.'
      using errcode = '42501';
  end if;

  -- Serialize request creation with approval and rejection. This lock is taken
  -- only after the cheap authentication/provider checks above, then active state
  -- is read again inside the shared critical section.
  lock table public.admin_users in exclusive mode;

  -- An already-active operator has nothing to request. Remove any stale request
  -- left by an older/concurrent flow and return NULL idempotently.
  if exists (
    select 1
    from public.admin_users as au
    where au.user_id = v_user_id
      and au.is_active
  ) then
    delete from public.menu_admin_access_requests as access_request
    where access_request.user_id = v_user_id;
    return null;
  end if;

  insert into public.menu_admin_access_requests (user_id, requested_at)
  values (v_user_id, pg_catalog.clock_timestamp())
  on conflict (user_id) do update
  set requested_at = excluded.requested_at
  returning requested_at into v_requested_at;

  return v_requested_at;
end;
$$;

create or replace function public.list_menu_admin_candidates()
returns table (
  user_id uuid,
  email text,
  role text,
  is_active boolean,
  has_google_identity boolean,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null or not exists (
    select 1
    from public.admin_users as caller
    where caller.user_id = v_caller_id
      and caller.role = 'owner'
      and caller.is_active
  ) then
    raise exception 'Only an active owner may list menu administration candidates.'
      using errcode = '42501';
  end if;

  return query
  with candidate_ids as (
    select au.user_id
    from public.admin_users as au
    union
    select access_request.user_id
    from public.menu_admin_access_requests as access_request
  )
  select
    u.id as user_id,
    coalesce(u.email, '')::text as email,
    au.role,
    coalesce(au.is_active, false) as is_active,
    exists (
      select 1
      from auth.identities as google_identity
      where google_identity.user_id = u.id
        and google_identity.provider = 'google'
    ) as has_google_identity,
    access_request.requested_at
  from candidate_ids as candidate
  join auth.users as u on u.id = candidate.user_id
  left join public.admin_users as au on au.user_id = candidate.user_id
  left join public.menu_admin_access_requests as access_request
    on access_request.user_id = candidate.user_id
  order by
    case
      when au.user_id is null then 0
      when not au.is_active and access_request.user_id is not null then 1
      else 2
    end,
    access_request.requested_at desc nulls last,
    pg_catalog.lower(coalesce(u.email, '')),
    u.id;
end;
$$;

create or replace function public.set_menu_admin_access(
  p_user_id uuid,
  p_role text,
  p_is_active boolean,
  p_expected_role text,
  p_expected_is_active boolean,
  p_expected_requested_at timestamptz
)
returns table (
  user_id uuid,
  email text,
  role text,
  is_active boolean,
  has_google_identity boolean,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_existing_role text;
  v_existing_active boolean;
  v_existing boolean := false;
  v_has_google_identity boolean;
  v_has_request boolean;
  v_existing_requested_at timestamptz;
begin
  -- Reject non-owners before taking a heavyweight table lock. The same check is
  -- repeated after the lock so a concurrent demotion cannot authorize stale
  -- owner state.
  if v_caller_id is null or not exists (
    select 1
    from public.admin_users as caller
    where caller.user_id = v_caller_id
      and caller.role = 'owner'
      and caller.is_active
  ) then
    raise exception 'Only an active owner may manage menu administration access.'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'A target Auth user is required.' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'manager', 'staff') then
    raise exception 'Menu administration role must be owner, manager, or staff.'
      using errcode = '22023';
  end if;
  if p_is_active is null then
    raise exception 'Menu administration active state is required.' using errcode = '22023';
  end if;
  if p_expected_role is not null and p_expected_role not in ('owner', 'manager', 'staff') then
    raise exception 'Expected menu administration role must be owner, manager, staff, or null.'
      using errcode = '22023';
  end if;
  if p_expected_is_active is null then
    raise exception 'Expected menu administration active state is required.' using errcode = '22023';
  end if;

  if p_user_id = v_caller_id and (p_role <> 'owner' or not p_is_active) then
    raise exception 'An owner cannot demote or deactivate their own account.'
      using errcode = '42501';
  end if;

  -- Serialize all role changes. Besides protecting the last-owner invariant,
  -- this also prevents two owners from approving/deactivating stale state at
  -- the same time.
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

  if not exists (select 1 from auth.users as u where u.id = p_user_id) then
    raise exception 'The target Auth user does not exist.' using errcode = '22023';
  end if;

  select au.role, au.is_active
  into v_existing_role, v_existing_active
  from public.admin_users as au
  where au.user_id = p_user_id;
  v_existing := found;

  select exists (
    select 1
    from auth.identities as i
    where i.user_id = p_user_id
      and i.provider = 'google'
  ) into v_has_google_identity;

  select access_request.requested_at
  into v_existing_requested_at
  from public.menu_admin_access_requests as access_request
  where access_request.user_id = p_user_id;
  v_has_request := found;

  -- Compare the row and request version that the owner actually reviewed. A
  -- NULL expected role denotes a new admin row; in that case role alone is the
  -- existence discriminator and the synthetic list value is_active=false is
  -- intentionally not compared with a nonexistent database row.
  if not (
    (
      (p_expected_role is null and not v_existing)
      or (
        p_expected_role is not null
        and v_existing
        and v_existing_role is not distinct from p_expected_role
        and v_existing_active is not distinct from p_expected_is_active
      )
    )
    and (v_existing_requested_at is not distinct from p_expected_requested_at)
  ) then
    raise exception 'Menu administration access changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  if not v_existing and not v_has_request then
    raise exception 'The target user has not requested menu administration access.'
      using errcode = '22023';
  end if;

  -- Preserve legacy active admins (including the existing owner) even if their
  -- Google identity has not been linked yet. New approvals, reactivations, and
  -- privilege increases must prove a Google identity; legacy admins may still
  -- be left unchanged, demoted, or deactivated safely.
  if (
       not v_existing
       or (not v_existing_active and p_is_active)
       or (
         v_existing_active
         and p_is_active
         and case p_role
           when 'owner' then 3
           when 'manager' then 2
           else 1
         end > case v_existing_role
           when 'owner' then 3
           when 'manager' then 2
           else 1
         end
       )
     )
     and not v_has_google_identity then
    raise exception 'A Google identity is required for approval, reactivation, or privilege increases.'
      using errcode = '22023';
  end if;

  if v_existing
     and v_existing_role = 'owner'
     and v_existing_active
     and (p_role <> 'owner' or not p_is_active)
     and not exists (
       select 1
       from public.admin_users as another_owner
       where another_owner.role = 'owner'
         and another_owner.is_active
         and another_owner.user_id <> p_user_id
     ) then
    raise exception 'The last active owner cannot be demoted or deactivated.'
      using errcode = '55000';
  end if;

  insert into public.admin_users as target_admin (user_id, role, is_active)
  values (p_user_id, p_role, p_is_active)
  on conflict on constraint admin_users_pkey do update
  set role = excluded.role,
      is_active = excluded.is_active
  where target_admin.role is distinct from excluded.role
     or target_admin.is_active is distinct from excluded.is_active;

  -- A successful approval/reactivation consumes the pending request. If this
  -- operator is deactivated later, a fresh login creates a new, distinguishable
  -- reactivation request and timestamp.
  if p_is_active then
    delete from public.menu_admin_access_requests as access_request
    where access_request.user_id = p_user_id;
  end if;

  return query
  select
    u.id as user_id,
    coalesce(u.email, '')::text as email,
    au.role,
    au.is_active,
    v_has_google_identity as has_google_identity,
    access_request.requested_at
  from auth.users as u
  join public.admin_users as au on au.user_id = u.id
  left join public.menu_admin_access_requests as access_request
    on access_request.user_id = u.id
  where u.id = p_user_id;
end;
$$;

revoke all on function public.request_menu_admin_access()
from public, anon, authenticated, service_role;
revoke all on function public.audit_menu_admin_access_change()
from public, anon, authenticated, service_role;
revoke all on function public.prevent_menu_admin_owner_lockout()
from public, anon, authenticated, service_role;
revoke all on function public.list_menu_admin_candidates()
from public, anon, authenticated, service_role;
revoke all on function public.set_menu_admin_access(uuid, text, boolean, text, boolean, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.reject_menu_admin_access_request(uuid, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.request_menu_admin_access() to authenticated;
grant execute on function public.list_menu_admin_candidates() to authenticated;
grant execute on function public.set_menu_admin_access(uuid, text, boolean, text, boolean, timestamptz) to authenticated;
grant execute on function public.reject_menu_admin_access_request(uuid, timestamptz) to authenticated;

commit;

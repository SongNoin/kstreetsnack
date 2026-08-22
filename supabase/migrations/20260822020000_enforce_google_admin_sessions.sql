-- Enforce the Google-only operator contract at the database boundary.
--
-- A row in admin_users is necessary but no longer sufficient: browser calls
-- must come from a live Supabase Auth session whose persisted AMR proves an
-- OAuth sign-in and whose user has a Google identity. This closes the gap where
-- an email/password or email-OTP token for the same UID could otherwise reuse
-- menu-tool privileges.
--
begin;

create or replace function public.is_google_admin_session()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_session_id text := coalesce(v_claims ->> 'session_id', '');
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user_id is null then
    return false;
  end if;

  -- Modern Supabase user sessions carry a canonical session UUID. Requiring
  -- and resolving it through auth.sessions makes a deleted/revoked session
  -- fail closed even if a previously-issued access token has time remaining.
  if v_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  if not exists (
    select 1
    from auth.sessions as auth_session
    where auth_session.id = v_session_id::uuid
      and auth_session.user_id = v_user_id
      and (
        auth_session.not_after is null
        or auth_session.not_after > clock_timestamp()
      )
  ) then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(v_claims -> 'amr') is distinct from 'array' then
    return false;
  end if;

  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_claims -> 'amr') as amr_claim
    where amr_claim ->> 'method' = 'oauth'
  ) then
    return false;
  end if;

  -- app_metadata is signed and server-managed. `provider` is normally Google;
  -- `providers` also supports an existing account that later linked Google.
  if not (
    v_claims #>> '{app_metadata,provider}' = 'google'
    or coalesce(v_claims #> '{app_metadata,providers}', '[]'::jsonb)
       @> '["google"]'::jsonb
  ) then
    return false;
  end if;

  return exists (
    select 1
    from auth.identities as identity
    where identity.user_id = v_user_id
      and identity.provider = 'google'
  );
end;
$$;

create or replace function public.require_google_admin_session()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_google_admin_session() then
    raise exception 'A current Google OAuth session is required for menu administration.'
      using errcode = '42501';
  end if;
end;
$$;

-- Every existing RLS policy and privileged menu RPC already delegates its role
-- decision to current_admin_role()/has_admin_role(). Gating the role lookup here
-- applies the Google-session requirement consistently to CRUD, availability,
-- restore, release creation, deployment requests, and Storage inserts.
create or replace function public.current_admin_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_google_admin_session() then
    return null;
  end if;

  return (
    select admin_user.role
    from public.admin_users as admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.is_active
  );
end;
$$;

create or replace function public.has_admin_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_admin_role() = any(p_roles), false);
$$;

-- The self-read branch previously exposed an admin row to any auth method for
-- the same UID. It now requires the same Google-session proof as every other
-- administrative read.
drop policy if exists admin_users_self_or_owner_read on public.admin_users;
create policy admin_users_self_or_owner_read
on public.admin_users for select
to authenticated
using (
  public.is_google_admin_session()
  and (
    user_id = auth.uid()
    or public.has_admin_role(array['owner'])
  )
);

-- Preserve the public RPC names used by the UI, while moving their original
-- implementations behind non-executable internal names. The wrappers perform
-- the Google-session assertion before the original owner/CAS/locking logic.
-- The existence guards also make a manual SQL Editor retry safe: after the
-- first successful run, the internal implementation is kept and the wrapper
-- below is simply recreated in place.
do $harden_access_implementations$
begin
  if pg_catalog.to_regprocedure('public.request_menu_admin_access_internal()') is null then
    execute 'alter function public.request_menu_admin_access() rename to request_menu_admin_access_internal';
  end if;
  if pg_catalog.to_regprocedure('public.list_menu_admin_candidates_internal()') is null then
    execute 'alter function public.list_menu_admin_candidates() rename to list_menu_admin_candidates_internal';
  end if;
  if pg_catalog.to_regprocedure(
    'public.set_menu_admin_access_internal(uuid,text,boolean,text,boolean,timestamptz)'
  ) is null then
    execute 'alter function public.set_menu_admin_access(uuid, text, boolean, text, boolean, timestamptz) rename to set_menu_admin_access_internal';
  end if;
  if pg_catalog.to_regprocedure(
    'public.reject_menu_admin_access_request_internal(uuid,timestamptz)'
  ) is null then
    execute 'alter function public.reject_menu_admin_access_request(uuid, timestamptz) rename to reject_menu_admin_access_request_internal';
  end if;
  if pg_catalog.to_regprocedure(
    'public.delete_menu_admin_access_internal(uuid,text,boolean,timestamptz)'
  ) is null then
    execute 'alter function public.delete_menu_admin_access(uuid, text, boolean, timestamptz) rename to delete_menu_admin_access_internal';
  end if;
end
$harden_access_implementations$;

revoke all on function public.request_menu_admin_access_internal()
from public, anon, authenticated, service_role;
revoke all on function public.list_menu_admin_candidates_internal()
from public, anon, authenticated, service_role;
revoke all on function public.set_menu_admin_access_internal(uuid, text, boolean, text, boolean, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.reject_menu_admin_access_request_internal(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.delete_menu_admin_access_internal(uuid, text, boolean, timestamptz)
from public, anon, authenticated, service_role;

create or replace function public.request_menu_admin_access()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_google_admin_session();
  return public.request_menu_admin_access_internal();
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
begin
  perform public.require_google_admin_session();
  return query
  select
    candidate.user_id,
    candidate.email,
    candidate.role,
    candidate.is_active,
    candidate.has_google_identity,
    candidate.requested_at
  from public.list_menu_admin_candidates_internal() as candidate;
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
begin
  perform public.require_google_admin_session();
  return query
  select
    changed.user_id,
    changed.email,
    changed.role,
    changed.is_active,
    changed.has_google_identity,
    changed.requested_at
  from public.set_menu_admin_access_internal(
    p_user_id,
    p_role,
    p_is_active,
    p_expected_role,
    p_expected_is_active,
    p_expected_requested_at
  ) as changed;
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
begin
  perform public.require_google_admin_session();
  return public.reject_menu_admin_access_request_internal(
    p_user_id,
    p_expected_requested_at
  );
end;
$$;

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
begin
  perform public.require_google_admin_session();
  return public.delete_menu_admin_access_internal(
    p_user_id,
    p_expected_role,
    p_expected_is_active,
    p_expected_requested_at
  );
end;
$$;

revoke all on function public.is_google_admin_session()
from public, anon, authenticated, service_role;
revoke all on function public.require_google_admin_session()
from public, anon, authenticated, service_role;
revoke all on function public.current_admin_role()
from public, anon, authenticated, service_role;
revoke all on function public.has_admin_role(text[])
from public, anon, authenticated, service_role;
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

grant execute on function public.is_google_admin_session() to authenticated;
grant execute on function public.current_admin_role() to authenticated;
grant execute on function public.has_admin_role(text[]) to authenticated;
grant execute on function public.request_menu_admin_access() to authenticated;
grant execute on function public.list_menu_admin_candidates() to authenticated;
grant execute on function public.set_menu_admin_access(uuid, text, boolean, text, boolean, timestamptz)
to authenticated;
grant execute on function public.reject_menu_admin_access_request(uuid, timestamptz)
to authenticated;
grant execute on function public.delete_menu_admin_access(uuid, text, boolean, timestamptz)
to authenticated;

commit;

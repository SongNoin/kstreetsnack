-- Reapply security-sensitive function definitions for databases that already
-- recorded the original restore and Google-session migrations. Fresh installs
-- receive the same definitions from their original migrations; this follow-up
-- keeps upgraded environments equivalent without editing migration history.

begin;

create or replace function public.prevent_menu_restore_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the nested UPDATE issued by an ON DELETE SET NULL foreign-key trigger
  -- may clear an actor. A direct PATCH must not erase immutable audit history.
  if TG_OP = 'UPDATE'
     and pg_catalog.pg_trigger_depth() > 1
     and TG_TABLE_NAME = 'menu_restore_baselines'
     and to_jsonb(old) -> 'captured_by' <> 'null'::jsonb
     and to_jsonb(new) -> 'captured_by' = 'null'::jsonb
     and (to_jsonb(new) - 'captured_by') = (to_jsonb(old) - 'captured_by') then
    return new;
  end if;

  if TG_OP = 'UPDATE'
     and pg_catalog.pg_trigger_depth() > 1
     and TG_TABLE_NAME = 'menu_restore_audit'
     and to_jsonb(old) -> 'restored_by' <> 'null'::jsonb
     and to_jsonb(new) -> 'restored_by' = 'null'::jsonb
     and (to_jsonb(new) - 'restored_by') = (to_jsonb(old) - 'restored_by') then
    return new;
  end if;

  raise exception 'Menu restore records are immutable.' using errcode = '55000';
end;
$$;

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

revoke all on function public.prevent_menu_restore_record_change()
  from public, anon, authenticated, service_role;
revoke all on function public.is_google_admin_session()
  from public, anon, authenticated, service_role;
grant execute on function public.is_google_admin_session() to authenticated;

commit;

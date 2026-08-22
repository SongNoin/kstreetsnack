-- Connect immutable menu releases to the GitHub Pages deployment pipeline.
-- A browser may request a deployment only through the menu-deploy Edge
-- Function. The function keeps the GitHub credential server-side and uses
-- these RPCs to enforce owner-only requests and stale-callback protection.

begin;

alter table public.menu_releases
  add column if not exists deployment_status text not null default 'not_requested',
  add column if not exists deployment_request_id uuid,
  add column if not exists deployment_requested_at timestamptz,
  add column if not exists deployment_started_at timestamptz,
  add column if not exists deployment_finished_at timestamptz,
  add column if not exists deployment_error text,
  add column if not exists deployment_run_id bigint,
  add column if not exists deployment_run_url text;

alter table public.menu_releases
  drop constraint if exists menu_releases_deployment_status_allowed;

alter table public.menu_releases
  add constraint menu_releases_deployment_status_allowed
  check (deployment_status in ('not_requested', 'queued', 'running', 'succeeded', 'failed'));

create index if not exists menu_releases_deployment_request_idx
  on public.menu_releases (deployment_request_id)
  where deployment_request_id is not null;

comment on column public.menu_releases.deployment_status is
  'GitHub Pages state for this immutable release: not_requested, queued, running, succeeded, or failed.';
comment on column public.menu_releases.deployment_request_id is
  'Per-attempt UUID used to prevent an older workflow callback from overwriting a newer attempt.';

create or replace function public.get_menu_release(p_release_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', mr.snapshot -> 'schema_version',
    'published_at', mr.snapshot -> 'published_at',
    'groups', mr.snapshot -> 'groups'
  )
  from public.menu_releases as mr
  where mr.id = p_release_id
    and mr.deployment_status in ('queued', 'running', 'succeeded');
$$;

create or replace function public.request_menu_deployment(
  p_release_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.menu_releases%rowtype;
  v_current_release_id uuid;
  v_blocking_release_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner']) then
    raise exception 'Only an owner may deploy the public site.'
      using errcode = '42501';
  end if;

  if p_release_id is null or p_request_id is null then
    raise exception 'A release ID and deployment request ID are required.'
      using errcode = '22004';
  end if;

  -- Serialize attempts so two clicks cannot enqueue competing site builds.
  perform pg_catalog.pg_advisory_xact_lock(662061563457110138);

  select ss.current_release_id
  into v_current_release_id
  from public.site_settings as ss
  where ss.id = 1;

  if v_current_release_id is distinct from p_release_id then
    raise exception 'Only the current menu release may be deployed.'
      using errcode = '55000';
  end if;

  select mr.*
  into v_release
  from public.menu_releases as mr
  where mr.id = p_release_id
  for update;

  if not found then
    raise exception 'Menu release not found.' using errcode = 'P0002';
  end if;

  if v_release.deployment_status in ('queued', 'running') then
    if v_release.deployment_request_id = p_request_id then
      return jsonb_build_object(
        'release_id', v_release.id,
        'request_id', v_release.deployment_request_id,
        'status', v_release.deployment_status
      );
    end if;
    if v_release.deployment_status = 'running'
       or coalesce(v_release.deployment_requested_at, '-infinity'::timestamptz)
          >= clock_timestamp() - interval '45 minutes' then
      raise exception 'A deployment is already in progress for this release.'
        using errcode = '55000';
    end if;
    -- A queued workflow that never started can be replaced after the timeout.
    -- Its late running callback sees the new request UUID and fails before it
    -- can build or deploy. A workflow that reached running must first be
    -- reconciled with the GitHub run API by the Edge Function.
  end if;

  -- Only one owner-approved release may be active globally. GitHub's shared
  -- Pages queue serializes it with code/schedule builds; this guard also stops
  -- two different confirmation releases from being queued out of order.
  update public.menu_releases
  set deployment_status = 'failed',
      deployment_finished_at = clock_timestamp(),
      deployment_error = 'The queued deployment expired before its workflow started.'
  where id <> p_release_id
    and deployment_status = 'queued'
    and coalesce(deployment_requested_at, '-infinity'::timestamptz)
        < clock_timestamp() - interval '45 minutes';

  select mr.id
  into v_blocking_release_id
  from public.menu_releases as mr
  where mr.id <> p_release_id
    and mr.deployment_status in ('queued', 'running')
  order by mr.deployment_requested_at nulls first, mr.id
  limit 1
  for update;

  if v_blocking_release_id is not null then
    raise exception 'Another menu deployment is already in progress.'
      using errcode = '55000';
  end if;

  update public.menu_releases
  set deployment_status = 'queued',
      deployment_request_id = p_request_id,
      deployment_requested_at = clock_timestamp(),
      deployment_started_at = null,
      deployment_finished_at = null,
      deployment_error = null,
      deployment_run_id = null,
      deployment_run_url = null
  where id = p_release_id
  returning * into v_release;

  return jsonb_build_object(
    'release_id', v_release.id,
    'request_id', v_release.deployment_request_id,
    'status', v_release.deployment_status
  );
end;
$$;

create or replace function public.update_menu_deployment(
  p_release_id uuid,
  p_request_id uuid,
  p_status text,
  p_run_id bigint default null,
  p_run_url text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.menu_releases%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the deployment service may update deployment state.'
      using errcode = '42501';
  end if;

  if p_status not in ('running', 'succeeded', 'failed') then
    raise exception 'Invalid deployment status.' using errcode = '22023';
  end if;

  select mr.*
  into v_release
  from public.menu_releases as mr
  where mr.id = p_release_id
  for update;

  if not found then
    raise exception 'Menu release not found.' using errcode = 'P0002';
  end if;

  if v_release.deployment_request_id is distinct from p_request_id then
    raise exception 'Stale deployment callback ignored.' using errcode = '55000';
  end if;

  if v_release.deployment_status in ('succeeded', 'failed') then
    if v_release.deployment_status = p_status then
      return jsonb_build_object(
        'release_id', v_release.id,
        'request_id', v_release.deployment_request_id,
        'status', v_release.deployment_status,
        'run_id', v_release.deployment_run_id,
        'run_url', v_release.deployment_run_url,
        'error', v_release.deployment_error
      );
    end if;
    raise exception 'A completed deployment cannot change state.' using errcode = '55000';
  end if;

  if v_release.deployment_status not in ('queued', 'running') then
    raise exception 'The deployment attempt is not active.' using errcode = '55000';
  end if;

  update public.menu_releases
  set deployment_status = p_status,
      deployment_started_at = case
        when p_status = 'running' then coalesce(deployment_started_at, clock_timestamp())
        else deployment_started_at
      end,
      deployment_finished_at = case
        when p_status in ('succeeded', 'failed') then clock_timestamp()
        else null
      end,
      deployment_error = case
        when p_status = 'failed' then left(coalesce(nullif(btrim(p_error), ''), 'GitHub Pages deployment failed.'), 1000)
        else null
      end,
      deployment_run_id = coalesce(p_run_id, deployment_run_id),
      deployment_run_url = coalesce(nullif(btrim(p_run_url), ''), deployment_run_url)
  where id = p_release_id
  returning * into v_release;

  return jsonb_build_object(
    'release_id', v_release.id,
    'request_id', v_release.deployment_request_id,
    'status', v_release.deployment_status,
    'run_id', v_release.deployment_run_id,
    'run_url', v_release.deployment_run_url,
    'error', v_release.deployment_error
  );
end;
$$;

revoke all on function public.get_menu_release(uuid) from public, anon, authenticated;
revoke all on function public.request_menu_deployment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_menu_deployment(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;

grant execute on function public.get_menu_release(uuid) to anon, authenticated, service_role;
grant execute on function public.request_menu_deployment(uuid, uuid) to authenticated, service_role;
grant execute on function public.update_menu_deployment(uuid, uuid, text, bigint, text, text) to service_role;

-- Administrators may observe status through the existing table policy, but no
-- browser role receives UPDATE permission on deployment columns.
grant select (
  deployment_status,
  deployment_request_id,
  deployment_requested_at,
  deployment_started_at,
  deployment_finished_at,
  deployment_error,
  deployment_run_id,
  deployment_run_url
) on public.menu_releases to authenticated;

commit;

-- Separate the latest confirmation snapshot from the release that is actually
-- live on GitHub Pages. Creating a confirmation snapshot must never change the
-- public-menu RPC; only a successful deployment callback may promote it.

begin;

alter table public.site_settings
  add column if not exists live_release_id uuid references public.menu_releases(id) on delete restrict,
  add column if not exists live_updated_at timestamptz;

-- Preserve the release that existing installations currently serve. Fresh
-- installations have no current release yet; publish_initial_menu() below
-- initializes both pointers after the seed transaction completes.
update public.site_settings
set live_release_id = current_release_id,
    live_updated_at = coalesce(live_updated_at, updated_at)
where live_release_id is null
  and current_release_id is not null;

-- Before the pointers were separated, current_release_id was also the source
-- of the production build. Mark that one inherited live release accurately;
-- future confirmation snapshots keep the not_requested default.
update public.menu_releases as mr
set deployment_status = 'succeeded',
    deployment_finished_at = coalesce(mr.deployment_finished_at, clock_timestamp()),
    deployment_error = null
from public.site_settings as ss
where ss.id = 1
  and mr.id = ss.live_release_id
  and mr.deployment_status = 'not_requested';

comment on column public.site_settings.current_release_id is
  'Latest immutable confirmation snapshot. Creating it does not publish the site.';
comment on column public.site_settings.live_release_id is
  'Release currently deployed on GitHub Pages. Only initial seed or a successful deployment transition may change it.';

-- Sold-out status is the narrow real-time exception to catalog releases. The
-- public menu needs only item identity and the boolean state; operational
-- notes and timestamps remain visible to authenticated administrators only.
drop policy if exists menu_availability_public_read on public.menu_availability;
drop policy if exists menu_availability_admin_read on public.menu_availability;
create policy menu_availability_public_read
on public.menu_availability for select
to anon
using (true);
create policy menu_availability_admin_read
on public.menu_availability for select
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']));

revoke select on table public.menu_availability from anon;
revoke select (menu_item_id, is_available, note, updated_at)
  on public.menu_availability from anon;
grant select (menu_item_id, is_available)
  on public.menu_availability to anon;

-- Release snapshots refer to Storage object paths. Those paths are immutable
-- once uploaded: managers create a new random object for an edited photo and
-- publish a new release instead of overwriting an already approved image.
drop policy if exists menu_images_manager_update on storage.objects;
drop policy if exists menu_images_manager_delete on storage.objects;

create or replace function public.get_published_menu()
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
  from public.site_settings as ss
  join public.menu_releases as mr on mr.id = ss.live_release_id
  where ss.id = 1;
$$;

-- Routine push/schedule builds must not rebuild the previous live snapshot
-- while an owner-approved workflow has already deployed a newer snapshot but
-- its final callback is still unresolved. Returning no row makes the
-- production build fail closed; an exact owner deployment uses
-- get_menu_release() instead and is unaffected by this guard.
create or replace function public.get_deployable_published_menu()
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
  from public.site_settings as ss
  join public.menu_releases as mr on mr.id = ss.live_release_id
  where ss.id = 1
    and not exists (
      select 1
      from public.menu_releases as active_deployment
      where active_deployment.deployment_status in ('queued', 'running')
    );
$$;

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

-- Bootstrap is the only path that may make a release live without a GitHub
-- callback. It runs before a site exists and is service-role-only.
create or replace function public.publish_initial_menu()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_release_id uuid;
  v_release_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role may publish the initial menu.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(662061563457110137);

  select ss.current_release_id
  into v_current_release_id
  from public.site_settings as ss
  where ss.id = 1;

  if v_current_release_id is not null
     or exists (select 1 from public.menu_releases) then
    raise exception 'An initial menu release already exists.'
      using errcode = '55000';
  end if;

  v_release_id := public.publish_menu();

  update public.menu_releases
  set deployment_status = 'succeeded',
      deployment_finished_at = clock_timestamp(),
      deployment_error = null
  where id = v_release_id;

  update public.site_settings
  set live_release_id = v_release_id,
      live_updated_at = clock_timestamp()
  where id = 1;

  return v_release_id;
end;
$$;

create or replace function public.promote_succeeded_menu_deployment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Promote only on the first transition to succeeded. Replayed callbacks for
  -- an old release therefore cannot move the live pointer backwards.
  if new.deployment_status = 'succeeded'
     and old.deployment_status is distinct from 'succeeded' then
    update public.site_settings
    set live_release_id = new.id,
        live_updated_at = coalesce(new.deployment_finished_at, clock_timestamp())
    where id = 1;
  end if;

  return new;
end;
$$;

drop trigger if exists promote_succeeded_menu_deployment on public.menu_releases;
create trigger promote_succeeded_menu_deployment
after update of deployment_status on public.menu_releases
for each row
execute function public.promote_succeeded_menu_deployment();

revoke all on function public.get_published_menu() from public, anon, authenticated;
revoke all on function public.get_deployable_published_menu() from public, anon, authenticated;
revoke all on function public.get_menu_release(uuid) from public, anon, authenticated;
revoke all on function public.publish_initial_menu() from public, anon, authenticated;
revoke all on function public.promote_succeeded_menu_deployment() from public, anon, authenticated, service_role;

grant execute on function public.get_published_menu() to anon, authenticated, service_role;
grant execute on function public.get_deployable_published_menu() to anon, authenticated, service_role;
grant execute on function public.get_menu_release(uuid) to anon, authenticated, service_role;
grant execute on function public.publish_initial_menu() to service_role;

commit;

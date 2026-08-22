-- Let a clean database install every migration before initial seed data exists.
-- The immutable pre-test restore point is captured only after publish_initial_menu
-- has created the single, live 80-item release. Existing baselines are returned
-- idempotently and can never be replaced.

begin;

create or replace function public.get_menu_restore_baseline_bootstrap_status()
returns table (
  baseline_key text,
  source_release_id uuid,
  source_release_version bigint,
  item_count integer,
  captured_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the bootstrap service may inspect the menu recovery baseline.'
      using errcode = '42501';
  end if;

  return query
  select
    baseline.baseline_key,
    baseline.source_release_id,
    baseline.source_release_version,
    baseline.item_count,
    baseline.captured_at
  from public.menu_restore_baselines as baseline
  where baseline.baseline_key = 'pre_test_2026_08_21';
end;
$$;

create or replace function public.capture_pretest_menu_restore_baseline(
  p_expected_release_id uuid
)
returns table (
  baseline_key text,
  source_release_id uuid,
  source_release_version bigint,
  item_count integer,
  captured_at timestamptz,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.menu_restore_baselines%rowtype;
  v_release public.menu_releases%rowtype;
  v_current_release_id uuid;
  v_live_release_id uuid;
  v_release_count integer;
  v_section_count integer;
  v_active_section_count integer;
  v_category_count integer;
  v_active_category_count integer;
  v_draft_item_count integer;
  v_active_draft_item_count integer;
  v_availability_count integer;
  v_published_item_count integer;
  v_missing_published_items integer;
  v_draft_snapshot jsonb;
  v_published_snapshot jsonb;
  v_captured_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the bootstrap service may capture the menu recovery baseline.'
      using errcode = '42501';
  end if;

  if p_expected_release_id is null then
    raise exception 'The expected initial release ID is required.' using errcode = '22004';
  end if;

  -- The row and its trigger are immutable, so this optimistic response-loss
  -- reconciliation is safe without taking any heavyweight locks.
  select baseline.*
  into v_existing
  from public.menu_restore_baselines as baseline
  where baseline.baseline_key = 'pre_test_2026_08_21';

  if found then
    if v_existing.source_release_id is distinct from p_expected_release_id then
      raise exception 'The immutable menu recovery baseline belongs to another release.'
        using errcode = '55000';
    end if;

    return query select
      v_existing.baseline_key,
      v_existing.source_release_id,
      v_existing.source_release_version,
      v_existing.item_count,
      v_existing.captured_at,
      false;
    return;
  end if;

  -- Serialize with initial publication and any concurrent retry, then prevent
  -- draft writes while the release and complete business snapshot are checked.
  perform pg_catalog.pg_advisory_xact_lock(662061563457110137);
  lock table public.sections, public.categories, public.menu_items, public.menu_availability
    in share row exclusive mode;
  lock table public.menu_restore_baselines in share row exclusive mode;

  -- A second caller may have completed capture while this one waited.
  select baseline.*
  into v_existing
  from public.menu_restore_baselines as baseline
  where baseline.baseline_key = 'pre_test_2026_08_21';

  if found then
    if v_existing.source_release_id is distinct from p_expected_release_id then
      raise exception 'The immutable menu recovery baseline belongs to another release.'
        using errcode = '55000';
    end if;

    return query select
      v_existing.baseline_key,
      v_existing.source_release_id,
      v_existing.source_release_version,
      v_existing.item_count,
      v_existing.captured_at,
      false;
    return;
  end if;

  select ss.current_release_id, ss.live_release_id
  into v_current_release_id, v_live_release_id
  from public.site_settings as ss
  where ss.id = 1;

  if not found
     or v_current_release_id is distinct from p_expected_release_id
     or v_live_release_id is distinct from p_expected_release_id then
    raise exception 'The expected initial release is not both current and live.'
      using errcode = '40001';
  end if;

  select count(*)::integer
  into v_release_count
  from public.menu_releases;

  if v_release_count <> 1 then
    raise exception 'Recovery baseline bootstrap requires exactly one initial release.'
      using errcode = '55000';
  end if;

  select release.*
  into v_release
  from public.menu_releases as release
  where release.id = p_expected_release_id
  for share;

  if not found then
    raise exception 'The expected initial release does not exist.' using errcode = '55000';
  end if;

  if coalesce((v_release.snapshot ->> 'schema_version')::integer, 0) <> 1
     or pg_catalog.jsonb_typeof(v_release.snapshot -> 'sections') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_release.snapshot -> 'groups') is distinct from 'array' then
    raise exception 'The initial release snapshot schema is invalid.' using errcode = '55000';
  end if;

  select
    count(*)::integer,
    (count(*) filter (where section.archived_at is null))::integer
  into v_section_count, v_active_section_count
  from public.sections as section;

  select
    count(*)::integer,
    (count(*) filter (where category.archived_at is null))::integer
  into v_category_count, v_active_category_count
  from public.categories as category;

  select
    count(*)::integer,
    (count(*) filter (where item.archived_at is null))::integer
  into v_draft_item_count, v_active_draft_item_count
  from public.menu_items as item;

  select count(*)::integer
  into v_availability_count
  from public.menu_availability;

  select count(*)::integer
  into v_published_item_count
  from pg_catalog.jsonb_array_elements(v_release.snapshot -> 'sections') as section_row(value)
  cross join lateral pg_catalog.jsonb_array_elements(
    coalesce(section_row.value -> 'categories', '[]'::jsonb)
  ) as category_row(value)
  cross join lateral pg_catalog.jsonb_array_elements(
    coalesce(category_row.value -> 'items', '[]'::jsonb)
  ) as item_row(value);

  select count(*)::integer
  into v_missing_published_items
  from public.menu_items as item
  join public.categories as category
    on category.id = item.category_id
   and category.archived_at is null
  join public.sections as section
    on section.id = category.section_id
   and section.archived_at is null
  where item.archived_at is null
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_release.snapshot -> 'sections') as section_row(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(section_row.value -> 'categories', '[]'::jsonb)
      ) as category_row(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(category_row.value -> 'items', '[]'::jsonb)
      ) as item_row(value)
      where item_row.value ->> 'id' = item.id::text
    );

  if v_section_count <> 2
     or v_active_section_count <> 2
     or v_category_count <> 13
     or v_active_category_count <> 13
     or v_draft_item_count <> 80
     or v_active_draft_item_count <> 80
     or v_availability_count <> 80
     or v_published_item_count <> 80
     or v_missing_published_items <> 0 then
    raise exception 'Recovery baseline bootstrap requires the exact initial 2/13/80 menu.'
      using
        errcode = '55000',
        detail = pg_catalog.format(
          'sections=%s/%s, categories=%s/%s, items=%s/%s, availability=%s, published=%s, missing=%s',
          v_active_section_count,
          v_section_count,
          v_active_category_count,
          v_category_count,
          v_active_draft_item_count,
          v_draft_item_count,
          v_availability_count,
          v_published_item_count,
          v_missing_published_items
        );
  end if;

  v_captured_at := pg_catalog.clock_timestamp();
  v_draft_snapshot := public.build_menu_draft_snapshot();
  v_published_snapshot := public.build_menu_snapshot(v_captured_at);

  -- No draft mutation may slip into the gap after initial publication. Ignore
  -- only published_at; every normalized and public field, including live
  -- availability, must still match that single initial release.
  if coalesce(v_published_snapshot -> 'sections', '[]'::jsonb)
       <> coalesce(v_release.snapshot -> 'sections', '[]'::jsonb)
     or coalesce(v_published_snapshot -> 'groups', '[]'::jsonb)
       <> coalesce(v_release.snapshot -> 'groups', '[]'::jsonb) then
    raise exception 'The draft changed after the initial release; baseline capture was stopped.'
      using errcode = '40001';
  end if;

  insert into public.menu_restore_baselines (
    baseline_key,
    draft_snapshot,
    published_snapshot,
    source_release_id,
    source_release_version,
    item_count,
    captured_at,
    captured_by
  ) values (
    'pre_test_2026_08_21',
    v_draft_snapshot,
    v_published_snapshot,
    v_release.id,
    v_release.version,
    v_published_item_count,
    v_captured_at,
    auth.uid()
  )
  returning * into v_existing;

  return query select
    v_existing.baseline_key,
    v_existing.source_release_id,
    v_existing.source_release_version,
    v_existing.item_count,
    v_existing.captured_at,
    true;
end;
$$;

revoke all on function public.get_menu_restore_baseline_bootstrap_status()
from public, anon, authenticated, service_role;
revoke all on function public.capture_pretest_menu_restore_baseline(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_menu_restore_baseline_bootstrap_status()
to service_role;
grant execute on function public.capture_pretest_menu_restore_baseline(uuid)
to service_role;

commit;

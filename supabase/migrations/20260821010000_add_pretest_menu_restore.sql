-- Owner-only recovery point for the pre-test 80-item menu.
--
-- If a current release already exists, applying this migration captures the
-- then-current draft and published menu exactly once. On a clean database the
-- schema and restore functions are installed first and capture is deferred to
-- the service-role bootstrap RPC after the initial 80-item seed is published.
-- The baseline cannot be edited or deleted. A restore creates a new immutable
-- release, keeps all previous releases, and records the complete pre-restore
-- draft in an append-only audit row.

begin;

create table if not exists public.menu_draft_state (
  id smallint primary key default 1,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint menu_draft_state_singleton check (id = 1),
  constraint menu_draft_state_revision_positive check (revision > 0)
);

insert into public.menu_draft_state (id, revision)
values (1, 1)
on conflict (id) do nothing;

create table if not exists public.menu_restore_baselines (
  baseline_key text primary key,
  draft_snapshot jsonb not null,
  published_snapshot jsonb not null,
  source_release_id uuid not null references public.menu_releases(id) on delete restrict,
  source_release_version bigint not null,
  item_count integer not null,
  captured_at timestamptz not null default now(),
  captured_by uuid references auth.users(id) on delete set null,
  constraint menu_restore_baselines_key_fixed
    check (baseline_key = 'pre_test_2026_08_21'),
  constraint menu_restore_baselines_draft_object
    check (jsonb_typeof(draft_snapshot) = 'object'),
  constraint menu_restore_baselines_published_object
    check (jsonb_typeof(published_snapshot) = 'object'),
  constraint menu_restore_baselines_expected_item_count
    check (item_count = 80)
);

create table if not exists public.menu_restore_audit (
  request_id uuid primary key,
  baseline_key text not null references public.menu_restore_baselines(baseline_key) on delete restrict,
  restored_at timestamptz not null,
  restored_by uuid references auth.users(id) on delete set null,
  previous_release_id uuid references public.menu_releases(id) on delete restrict,
  restored_release_id uuid not null unique references public.menu_releases(id) on delete restrict,
  expected_draft_revision bigint not null,
  previous_draft_revision bigint not null,
  restored_draft_revision bigint not null,
  before_draft_snapshot jsonb not null,
  restored_item_count integer not null,
  constraint menu_restore_audit_before_snapshot_object
    check (jsonb_typeof(before_draft_snapshot) = 'object'),
  constraint menu_restore_audit_revision_progress
    check (restored_draft_revision > previous_draft_revision),
  constraint menu_restore_audit_item_count_positive
    check (restored_item_count > 0)
);

comment on table public.menu_restore_baselines is
  'Immutable, one-time pre-test menu recovery point. Direct client access is forbidden.';
comment on table public.menu_restore_audit is
  'Append-only owner restore log. before_draft_snapshot preserves the state replaced by a restore.';
comment on column public.menu_restore_baselines.draft_snapshot is
  'Complete draft business state, including archive and live availability state.';
comment on column public.menu_restore_baselines.published_snapshot is
  'Publishable snapshot generated from the captured draft, including live availability.';

create or replace function public.build_menu_draft_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'sections', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'slug', s.slug,
            'name', s.name,
            'description', s.description,
            'sort_order', s.sort_order,
            'archived_at', s.archived_at
          )
          order by s.id
        )
        from public.sections as s
      ),
      '[]'::jsonb
    ),
    'categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'section_id', c.section_id,
            'slug', c.slug,
            'name', c.name,
            'description', c.description,
            'order_note', c.order_note,
            'image_path', c.image_path,
            'cover', c.cover,
            'is_featured', c.is_featured,
            'featured_order', c.featured_order,
            'sort_order', c.sort_order,
            'archived_at', c.archived_at
          )
          order by c.id
        )
        from public.categories as c
      ),
      '[]'::jsonb
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', mi.id,
            'category_id', mi.category_id,
            'slug', mi.slug,
            'name', mi.name,
            'description', mi.description,
            'price', mi.price,
            'image_path', mi.image_path,
            'tag', mi.tag,
            'sort_order', mi.sort_order,
            'archived_at', mi.archived_at
          )
          order by mi.id
        )
        from public.menu_items as mi
      ),
      '[]'::jsonb
    ),
    'availability', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'menu_item_id', ma.menu_item_id,
            'is_available', ma.is_available,
            'note', ma.note
          )
          order by ma.menu_item_id
        )
        from public.menu_availability as ma
      ),
      '[]'::jsonb
    )
  );
$$;

create or replace function public.bump_menu_draft_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.menu_draft_state
  set revision = revision + 1,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where id = 1;

  if not found then
    raise exception 'Menu draft revision state is missing.' using errcode = '55000';
  end if;

  return null;
end;
$$;

drop trigger if exists sections_bump_draft_revision on public.sections;
create trigger sections_bump_draft_revision
after insert or update or delete on public.sections
for each row execute function public.bump_menu_draft_revision();

drop trigger if exists categories_bump_draft_revision on public.categories;
create trigger categories_bump_draft_revision
after insert or update or delete on public.categories
for each row execute function public.bump_menu_draft_revision();

drop trigger if exists menu_items_bump_draft_revision on public.menu_items;
create trigger menu_items_bump_draft_revision
after insert or update or delete on public.menu_items
for each row execute function public.bump_menu_draft_revision();

drop trigger if exists menu_availability_bump_draft_revision on public.menu_availability;
create trigger menu_availability_bump_draft_revision
after insert or update or delete on public.menu_availability
for each row execute function public.bump_menu_draft_revision();

create or replace function public.prevent_menu_restore_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `ON DELETE SET NULL` on the actor columns is the only permitted update.
  -- Supabase Auth may retain the immutable snapshot while deleting the user
  -- who created it; every business field must remain byte-for-byte identical.
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

drop trigger if exists menu_restore_baselines_immutable on public.menu_restore_baselines;
create trigger menu_restore_baselines_immutable
before update or delete on public.menu_restore_baselines
for each row execute function public.prevent_menu_restore_record_change();

drop trigger if exists menu_restore_audit_immutable on public.menu_restore_audit;
create trigger menu_restore_audit_immutable
before update or delete on public.menu_restore_audit
for each row execute function public.prevent_menu_restore_record_change();

do $$
declare
  v_release public.menu_releases%rowtype;
  v_draft_snapshot jsonb;
  v_published_snapshot jsonb;
  v_captured_at timestamptz;
  v_published_item_count integer;
  v_active_draft_item_count integer;
  v_missing_published_items integer;
begin
  if not exists (
    select 1
    from public.menu_restore_baselines as baseline
    where baseline.baseline_key = 'pre_test_2026_08_21'
  ) then
    select mr.*
    into v_release
    from public.site_settings as ss
    join public.menu_releases as mr on mr.id = ss.current_release_id
    where ss.id = 1;

    if not found then
      raise notice 'Pre-test baseline capture deferred until the initial menu seed is published.';
      return;
    end if;

    if coalesce((v_release.snapshot ->> 'schema_version')::integer, 0) <> 1 then
      raise exception 'The current release schema is not supported for the pre-test baseline.'
        using errcode = '55000';
    end if;

    select count(*)::integer
    into v_published_item_count
    from jsonb_array_elements(coalesce(v_release.snapshot -> 'sections', '[]'::jsonb)) as section_row(value)
    cross join lateral jsonb_array_elements(coalesce(section_row.value -> 'categories', '[]'::jsonb)) as category_row(value)
    cross join lateral jsonb_array_elements(coalesce(category_row.value -> 'items', '[]'::jsonb)) as item_row(value);

    select count(*)::integer
    into v_active_draft_item_count
    from public.menu_items as mi
    join public.categories as c on c.id = mi.category_id and c.archived_at is null
    join public.sections as s on s.id = c.section_id and s.archived_at is null
    where mi.archived_at is null;

    select count(*)::integer
    into v_missing_published_items
    from public.menu_items as mi
    join public.categories as c on c.id = mi.category_id and c.archived_at is null
    join public.sections as s on s.id = c.section_id and s.archived_at is null
    where mi.archived_at is null
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(v_release.snapshot -> 'sections', '[]'::jsonb)) as section_row(value)
        cross join lateral jsonb_array_elements(coalesce(section_row.value -> 'categories', '[]'::jsonb)) as category_row(value)
        cross join lateral jsonb_array_elements(coalesce(category_row.value -> 'items', '[]'::jsonb)) as item_row(value)
        where item_row.value ->> 'id' = mi.id::text
      );

    if v_published_item_count <> 80
       or v_active_draft_item_count <> 80
       or v_missing_published_items <> 0 then
      raise exception 'Pre-test baseline capture requires the matching current 80-item menu.'
        using
          errcode = '55000',
          detail = pg_catalog.format(
            'published=%s, active_draft=%s, missing_from_release=%s',
            v_published_item_count,
            v_active_draft_item_count,
            v_missing_published_items
          );
    end if;

    v_captured_at := clock_timestamp();
    v_draft_snapshot := public.build_menu_draft_snapshot();
    -- Sold-out state is live and can legitimately differ from the older
    -- release JSON. Capture the effective current draft as the public recovery
    -- payload so availability is restored intentionally, not accidentally.
    v_published_snapshot := public.build_menu_snapshot(v_captured_at);

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
    );
  end if;
end;
$$;

create or replace function public.get_menu_restore_status()
returns table (
  baseline_key text,
  captured_at timestamptz,
  baseline_source_release_id uuid,
  baseline_source_release_version bigint,
  baseline_item_count integer,
  current_release_id uuid,
  current_release_version bigint,
  draft_revision bigint,
  is_draft_at_baseline boolean,
  is_published_at_baseline boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_admin_role(array['owner']) then
    raise exception 'Only an active owner may view the menu recovery point.'
      using errcode = '42501';
  end if;

  return query
  select
    baseline.baseline_key,
    baseline.captured_at,
    baseline.source_release_id,
    baseline.source_release_version,
    baseline.item_count,
    ss.current_release_id,
    current_release.version,
    draft_state.revision,
    public.build_menu_draft_snapshot() = baseline.draft_snapshot,
    coalesce(current_release.snapshot -> 'groups', '[]'::jsonb)
      = coalesce(baseline.published_snapshot -> 'groups', '[]'::jsonb)
  from public.menu_restore_baselines as baseline
  join public.menu_draft_state as draft_state on draft_state.id = 1
  join public.site_settings as ss on ss.id = 1
  left join public.menu_releases as current_release on current_release.id = ss.current_release_id
  where baseline.baseline_key = 'pre_test_2026_08_21';
end;
$$;

create or replace function public.get_menu_restore_result(p_request_id uuid)
returns table (
  request_id uuid,
  restored_release_id uuid,
  restored_at timestamptz,
  draft_revision bigint,
  baseline_source_release_id uuid,
  restored_item_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_admin_role(array['owner']) then
    raise exception 'Only an active owner may view menu recovery results.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'A recovery request id is required.' using errcode = '22004';
  end if;

  return query
  select
    audit.request_id,
    audit.restored_release_id,
    audit.restored_at,
    audit.restored_draft_revision,
    baseline.source_release_id,
    audit.restored_item_count
  from public.menu_restore_audit as audit
  join public.menu_restore_baselines as baseline on baseline.baseline_key = audit.baseline_key
  where audit.request_id = p_request_id;
end;
$$;

create or replace function public.restore_pretest_menu(
  p_request_id uuid,
  p_expected_current_release_id uuid,
  p_expected_draft_revision bigint
)
returns table (
  request_id uuid,
  restored_release_id uuid,
  restored_at timestamptz,
  draft_revision bigint,
  baseline_source_release_id uuid,
  restored_item_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_baseline public.menu_restore_baselines%rowtype;
  v_existing_audit public.menu_restore_audit%rowtype;
  v_current_release_id uuid;
  v_current_draft_revision bigint;
  v_restored_draft_revision bigint;
  v_before_draft_snapshot jsonb;
  v_restored_snapshot jsonb;
  v_restored_release_id uuid;
  v_restored_at timestamptz;
begin
  if v_caller_id is null or not public.has_admin_role(array['owner']) then
    raise exception 'Only an active owner may restore the pre-test menu.'
      using errcode = '42501';
  end if;

  if p_request_id is null
     or p_expected_current_release_id is null
     or p_expected_draft_revision is null then
    raise exception 'Recovery request id, release id, and draft revision are required.'
      using errcode = '22004';
  end if;

  -- A repeated request id is an idempotent response-loss reconciliation.
  select audit.*
  into v_existing_audit
  from public.menu_restore_audit as audit
  where audit.request_id = p_request_id;

  if found then
    return query
    select
      v_existing_audit.request_id,
      v_existing_audit.restored_release_id,
      v_existing_audit.restored_at,
      v_existing_audit.restored_draft_revision,
      baseline.source_release_id,
      v_existing_audit.restored_item_count
    from public.menu_restore_baselines as baseline
    where baseline.baseline_key = v_existing_audit.baseline_key;
    return;
  end if;

  -- Share the publication lock, then wait for in-flight draft writers before
  -- taking the revision row. New writers remain blocked until this transaction
  -- has restored both draft and publication state.
  perform pg_catalog.pg_advisory_xact_lock(662061563457110137);
  lock table public.sections, public.categories, public.menu_items, public.menu_availability
    in share row exclusive mode;

  -- Two callers can observe a missing audit row before either acquires the
  -- publication lock. Recheck after serialization so the second identical
  -- request returns the first result instead of failing the revision CAS.
  select audit.*
  into v_existing_audit
  from public.menu_restore_audit as audit
  where audit.request_id = p_request_id;

  if found then
    return query
    select
      v_existing_audit.request_id,
      v_existing_audit.restored_release_id,
      v_existing_audit.restored_at,
      v_existing_audit.restored_draft_revision,
      baseline.source_release_id,
      v_existing_audit.restored_item_count
    from public.menu_restore_baselines as baseline
    where baseline.baseline_key = v_existing_audit.baseline_key;
    return;
  end if;

  select baseline.*
  into v_baseline
  from public.menu_restore_baselines as baseline
  where baseline.baseline_key = 'pre_test_2026_08_21'
  for share;

  if not found then
    raise exception 'The pre-test menu recovery point is missing.' using errcode = '55000';
  end if;

  select ss.current_release_id
  into v_current_release_id
  from public.site_settings as ss
  where ss.id = 1
  for update;

  if not found then
    raise exception 'Site release settings are missing.' using errcode = '55000';
  end if;

  select draft_state.revision
  into v_current_draft_revision
  from public.menu_draft_state as draft_state
  where draft_state.id = 1
  for update;

  if not found then
    raise exception 'Menu draft revision state is missing.' using errcode = '55000';
  end if;

  if v_current_release_id is distinct from p_expected_current_release_id
     or v_current_draft_revision is distinct from p_expected_draft_revision then
    raise exception 'Menu state changed after review; reload before restoring.'
      using
        errcode = '40001',
        detail = pg_catalog.format(
          'current_release=%s, expected_release=%s, current_revision=%s, expected_revision=%s',
          v_current_release_id,
          p_expected_current_release_id,
          v_current_draft_revision,
          p_expected_draft_revision
        );
  end if;

  v_before_draft_snapshot := public.build_menu_draft_snapshot();
  v_restored_at := clock_timestamp();

  -- Temporarily archive dependencies so every baseline relationship can be
  -- rebuilt without exposing an invalid intermediate state outside this tx.
  update public.menu_items
  set archived_at = coalesce(archived_at, v_restored_at);

  update public.categories
  set archived_at = coalesce(archived_at, v_restored_at);

  update public.sections
  set archived_at = coalesce(archived_at, v_restored_at);

  -- Free every unique slug before replaying the immutable baseline. This also
  -- handles records deleted and later recreated under an old baseline slug.
  update public.sections
  set slug = 'restore-temp-' || replace(id::text, '-', '');

  update public.categories
  set slug = 'restore-temp-' || replace(id::text, '-', '');

  update public.menu_items
  set slug = 'restore-temp-' || replace(id::text, '-', '');

  delete from public.menu_items as mi
  where not exists (
    select 1
    from jsonb_to_recordset(v_baseline.draft_snapshot -> 'items') as baseline_item(id uuid)
    where baseline_item.id = mi.id
  );

  insert into public.sections (
    id, slug, name, description, sort_order, archived_at
  )
  select
    baseline_section.id,
    baseline_section.slug,
    baseline_section.name,
    baseline_section.description,
    baseline_section.sort_order,
    baseline_section.archived_at
  from jsonb_to_recordset(v_baseline.draft_snapshot -> 'sections') as baseline_section(
    id uuid,
    slug text,
    name jsonb,
    description jsonb,
    sort_order integer,
    archived_at timestamptz
  )
  on conflict (id) do update
  set slug = excluded.slug,
      name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at;

  insert into public.categories (
    id,
    section_id,
    slug,
    name,
    description,
    order_note,
    image_path,
    cover,
    is_featured,
    featured_order,
    sort_order,
    archived_at
  )
  select
    baseline_category.id,
    baseline_category.section_id,
    baseline_category.slug,
    baseline_category.name,
    baseline_category.description,
    baseline_category.order_note,
    baseline_category.image_path,
    baseline_category.cover,
    baseline_category.is_featured,
    baseline_category.featured_order,
    baseline_category.sort_order,
    baseline_category.archived_at
  from jsonb_to_recordset(v_baseline.draft_snapshot -> 'categories') as baseline_category(
    id uuid,
    section_id uuid,
    slug text,
    name jsonb,
    description jsonb,
    order_note jsonb,
    image_path text,
    cover boolean,
    is_featured boolean,
    featured_order integer,
    sort_order integer,
    archived_at timestamptz
  )
  on conflict (id) do update
  set section_id = excluded.section_id,
      slug = excluded.slug,
      name = excluded.name,
      description = excluded.description,
      order_note = excluded.order_note,
      image_path = excluded.image_path,
      cover = excluded.cover,
      is_featured = excluded.is_featured,
      featured_order = excluded.featured_order,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at;

  insert into public.menu_items (
    id,
    category_id,
    slug,
    name,
    description,
    price,
    image_path,
    tag,
    sort_order,
    archived_at
  )
  select
    baseline_item.id,
    baseline_item.category_id,
    baseline_item.slug,
    baseline_item.name,
    baseline_item.description,
    baseline_item.price,
    baseline_item.image_path,
    baseline_item.tag,
    baseline_item.sort_order,
    baseline_item.archived_at
  from jsonb_to_recordset(v_baseline.draft_snapshot -> 'items') as baseline_item(
    id uuid,
    category_id uuid,
    slug text,
    name jsonb,
    description jsonb,
    price jsonb,
    image_path text,
    tag text,
    sort_order integer,
    archived_at timestamptz
  )
  on conflict (id) do update
  set category_id = excluded.category_id,
      slug = excluded.slug,
      name = excluded.name,
      description = excluded.description,
      price = excluded.price,
      image_path = excluded.image_path,
      tag = excluded.tag,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at;

  insert into public.menu_availability (menu_item_id, is_available, note)
  select
    baseline_availability.menu_item_id,
    baseline_availability.is_available,
    baseline_availability.note
  from jsonb_to_recordset(v_baseline.draft_snapshot -> 'availability') as baseline_availability(
    menu_item_id uuid,
    is_available boolean,
    note jsonb
  )
  on conflict (menu_item_id) do update
  set is_available = excluded.is_available,
      note = excluded.note;

  delete from public.categories as c
  where not exists (
    select 1
    from jsonb_to_recordset(v_baseline.draft_snapshot -> 'categories') as baseline_category(id uuid)
    where baseline_category.id = c.id
  );

  delete from public.sections as s
  where not exists (
    select 1
    from jsonb_to_recordset(v_baseline.draft_snapshot -> 'sections') as baseline_section(id uuid)
    where baseline_section.id = s.id
  );

  if public.build_menu_draft_snapshot() <> v_baseline.draft_snapshot then
    raise exception 'The restored draft did not match the immutable recovery point.'
      using errcode = '55000';
  end if;

  v_restored_snapshot := public.build_menu_snapshot(v_restored_at);

  -- Availability is deliberately included: public groups must match sold-out
  -- state as well as item/category content before a new release is selected.
  if coalesce(v_restored_snapshot -> 'groups', '[]'::jsonb)
       <> coalesce(v_baseline.published_snapshot -> 'groups', '[]'::jsonb) then
    raise exception 'The restored public menu did not match the recovery point.'
      using errcode = '55000';
  end if;

  insert into public.menu_releases (snapshot, published_at, published_by)
  values (v_restored_snapshot, v_restored_at, v_caller_id)
  returning id into v_restored_release_id;

  update public.site_settings
  set current_release_id = v_restored_release_id,
      updated_at = v_restored_at
  where id = 1;

  select draft_state.revision
  into v_restored_draft_revision
  from public.menu_draft_state as draft_state
  where draft_state.id = 1;

  insert into public.menu_restore_audit (
    request_id,
    baseline_key,
    restored_at,
    restored_by,
    previous_release_id,
    restored_release_id,
    expected_draft_revision,
    previous_draft_revision,
    restored_draft_revision,
    before_draft_snapshot,
    restored_item_count
  ) values (
    p_request_id,
    v_baseline.baseline_key,
    v_restored_at,
    v_caller_id,
    v_current_release_id,
    v_restored_release_id,
    p_expected_draft_revision,
    v_current_draft_revision,
    v_restored_draft_revision,
    v_before_draft_snapshot,
    v_baseline.item_count
  );

  return query
  select
    p_request_id,
    v_restored_release_id,
    v_restored_at,
    v_restored_draft_revision,
    v_baseline.source_release_id,
    v_baseline.item_count;
end;
$$;

alter table public.menu_draft_state enable row level security;
alter table public.menu_restore_baselines enable row level security;
alter table public.menu_restore_audit enable row level security;

revoke all on table public.menu_draft_state from public, anon, authenticated, service_role;
revoke all on table public.menu_restore_baselines from public, anon, authenticated, service_role;
revoke all on table public.menu_restore_audit from public, anon, authenticated, service_role;

revoke all on function public.build_menu_draft_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.bump_menu_draft_revision() from public, anon, authenticated, service_role;
revoke all on function public.prevent_menu_restore_record_change() from public, anon, authenticated, service_role;
revoke all on function public.get_menu_restore_status() from public, anon, authenticated, service_role;
revoke all on function public.get_menu_restore_result(uuid) from public, anon, authenticated, service_role;
revoke all on function public.restore_pretest_menu(uuid, uuid, bigint) from public, anon, authenticated, service_role;

grant execute on function public.get_menu_restore_status() to authenticated;
grant execute on function public.get_menu_restore_result(uuid) to authenticated;
grant execute on function public.restore_pretest_menu(uuid, uuid, bigint) to authenticated;

commit;

-- K Street Snack menu administration schema.
--
-- Draft menu data stays private to authenticated administrators. Public clients
-- receive an immutable release through get_published_menu() and may overlay the
-- small menu_availability table for immediate sold-out updates.

begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.is_complete_localized_text(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(p_value) = 'object'
    and p_value ?& array['pl', 'en', 'ko']
    and nullif(btrim(p_value ->> 'pl'), '') is not null
    and nullif(btrim(p_value ->> 'en'), '') is not null
    and nullif(btrim(p_value ->> 'ko'), '') is not null;
$$;

create or replace function public.is_optional_localized_text(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_value = '{}'::jsonb
    or (
      jsonb_typeof(p_value) = 'object'
      and p_value ?& array['pl', 'en', 'ko']
      and jsonb_typeof(p_value -> 'pl') = 'string'
      and jsonb_typeof(p_value -> 'en') = 'string'
      and jsonb_typeof(p_value -> 'ko') = 'string'
    );
$$;

create table if not exists public.sections (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint sections_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint sections_name_localized check (public.is_complete_localized_text(name)),
  constraint sections_description_localized check (public.is_optional_localized_text(description)),
  constraint sections_sort_order_nonnegative check (sort_order >= 0)
);

create table if not exists public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  section_id uuid not null references public.sections(id) on delete restrict,
  slug text not null unique,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  order_note jsonb not null default '{}'::jsonb,
  image_path text not null,
  cover boolean not null default false,
  is_featured boolean not null default false,
  featured_order integer,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_name_localized check (public.is_complete_localized_text(name)),
  constraint categories_description_localized check (public.is_optional_localized_text(description)),
  constraint categories_order_note_localized check (public.is_optional_localized_text(order_note)),
  constraint categories_image_path_length check (length(image_path) between 1 and 512),
  constraint categories_image_path_is_relative check (image_path !~ '^(https?:)?//'),
  constraint categories_sort_order_nonnegative check (sort_order >= 0),
  constraint categories_featured_order_nonnegative check (featured_order is null or featured_order >= 0)
);

create table if not exists public.menu_items (
  id uuid primary key default extensions.gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug text not null,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  price jsonb not null,
  image_path text,
  tag text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint menu_items_category_slug_unique unique (category_id, slug),
  constraint menu_items_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint menu_items_name_localized check (public.is_complete_localized_text(name)),
  constraint menu_items_description_localized check (public.is_optional_localized_text(description)),
  constraint menu_items_price_localized check (public.is_complete_localized_text(price)),
  constraint menu_items_image_path_length check (image_path is null or length(image_path) between 1 and 512),
  constraint menu_items_image_path_is_relative check (image_path is null or image_path !~ '^(https?:)?//'),
  constraint menu_items_tag_allowed check (
    tag is null or tag in ('spicy', 'mild-spicy', 'very-spicy', 'hot', 'ice')
  ),
  constraint menu_items_sort_order_nonnegative check (sort_order >= 0)
);

create table if not exists public.menu_availability (
  menu_item_id uuid primary key references public.menu_items(id) on delete cascade,
  is_available boolean not null default true,
  note jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint menu_availability_note_localized check (public.is_optional_localized_text(note))
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint admin_users_role_allowed check (role in ('owner', 'manager', 'staff'))
);

create table if not exists public.menu_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  version bigint generated always as identity unique,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  constraint menu_releases_snapshot_is_object check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists public.site_settings (
  id smallint primary key default 1,
  current_release_id uuid references public.menu_releases(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);

insert into public.site_settings (id)
values (1)
on conflict (id) do nothing;

comment on column public.sections.name is 'Localized object with non-empty pl, en, and ko strings.';
comment on column public.categories.description is 'Empty object or localized object with pl, en, and ko strings.';
comment on column public.categories.image_path is 'static:<filename> or a menu-images bucket-relative object path.';
comment on column public.menu_items.price is 'Localized display-price object with non-empty pl, en, and ko strings.';
comment on column public.menu_items.image_path is 'Optional static:<filename> or menu-images bucket-relative object path.';
comment on table public.menu_releases is 'Immutable published menu snapshots. Only publish_menu() may insert rows.';

create index if not exists categories_active_order_idx
  on public.categories (section_id, sort_order, created_at, id)
  where archived_at is null;

create index if not exists categories_featured_idx
  on public.categories (featured_order, sort_order, id)
  where archived_at is null and is_featured;

create index if not exists menu_items_active_order_idx
  on public.menu_items (category_id, sort_order, created_at, id)
  where archived_at is null;

create index if not exists sections_active_order_idx
  on public.sections (sort_order, created_at, id)
  where archived_at is null;

create or replace function public.set_content_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    -- Auth user deletion may set one or both actor FKs to NULL. Preserve that
    -- referential action only when every non-actor field is unchanged; normal
    -- content updates still keep the original creator and refresh updater data.
    if pg_catalog.pg_trigger_depth() > 1
       and (to_jsonb(new) - array['created_by', 'updated_by']::text[])
         = (to_jsonb(old) - array['created_by', 'updated_by']::text[])
       and (
         (old.created_by is not null and new.created_by is null)
         or (old.updated_by is not null and new.updated_by is null)
       )
       and (new.created_by is null or new.created_by is not distinct from old.created_by)
       and (new.updated_by is null or new.updated_by is not distinct from old.updated_by) then
      return new;
    end if;

    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists sections_set_audit_fields on public.sections;
create trigger sections_set_audit_fields
before insert or update on public.sections
for each row execute function public.set_content_audit_fields();

drop trigger if exists categories_set_audit_fields on public.categories;
create trigger categories_set_audit_fields
before insert or update on public.categories
for each row execute function public.set_content_audit_fields();

drop trigger if exists menu_items_set_audit_fields on public.menu_items;
create trigger menu_items_set_audit_fields
before insert or update on public.menu_items
for each row execute function public.set_content_audit_fields();

drop trigger if exists admin_users_set_audit_fields on public.admin_users;
create trigger admin_users_set_audit_fields
before insert or update on public.admin_users
for each row execute function public.set_content_audit_fields();

create or replace function public.prevent_category_archival_with_active_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and exists (
    select 1
    from public.menu_items as mi
    where mi.category_id = new.id
      and mi.archived_at is null
  ) then
    raise exception 'Category cannot be archived while it contains active menu items.'
      using
        errcode = '23514',
        hint = 'Archive every active menu item in the category first.';
  end if;

  return new;
end;
$$;

drop trigger if exists categories_prevent_archive_with_active_items on public.categories;
create trigger categories_prevent_archive_with_active_items
before update of archived_at on public.categories
for each row execute function public.prevent_category_archival_with_active_items();

create or replace function public.require_active_category_for_active_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is null then
    perform 1
    from public.categories as c
    where c.id = new.category_id
      and c.archived_at is null
    for share;

    if not found then
      raise exception 'Active menu items must belong to an active category.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists menu_items_require_active_category on public.menu_items;
create trigger menu_items_require_active_category
before insert or update of category_id, archived_at on public.menu_items
for each row execute function public.require_active_category_for_active_item();

create or replace function public.set_availability_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists menu_availability_set_audit_fields on public.menu_availability;
create trigger menu_availability_set_audit_fields
before insert or update on public.menu_availability
for each row execute function public.set_availability_audit_fields();

create or replace function public.create_default_menu_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.menu_availability (menu_item_id)
  values (new.id)
  on conflict (menu_item_id) do nothing;
  return new;
end;
$$;

drop trigger if exists menu_items_create_default_availability on public.menu_items;
create trigger menu_items_create_default_availability
after insert on public.menu_items
for each row execute function public.create_default_menu_availability();

create or replace function public.current_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select au.role
  from public.admin_users as au
  where au.user_id = auth.uid()
    and au.is_active;
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

alter table public.sections enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_availability enable row level security;
alter table public.admin_users enable row level security;
alter table public.menu_releases enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists sections_admin_read on public.sections;
drop policy if exists sections_manager_insert on public.sections;
drop policy if exists sections_manager_update on public.sections;
drop policy if exists sections_manager_delete on public.sections;
drop policy if exists categories_admin_read on public.categories;
drop policy if exists categories_manager_insert on public.categories;
drop policy if exists categories_manager_update on public.categories;
drop policy if exists categories_manager_delete on public.categories;
drop policy if exists menu_items_admin_read on public.menu_items;
drop policy if exists menu_items_manager_insert on public.menu_items;
drop policy if exists menu_items_manager_update on public.menu_items;
drop policy if exists menu_items_manager_delete on public.menu_items;
drop policy if exists menu_availability_public_read on public.menu_availability;
drop policy if exists menu_availability_admin_insert on public.menu_availability;
drop policy if exists menu_availability_admin_update on public.menu_availability;
drop policy if exists menu_availability_manager_delete on public.menu_availability;
drop policy if exists admin_users_self_or_owner_read on public.admin_users;
drop policy if exists admin_users_owner_insert on public.admin_users;
drop policy if exists admin_users_owner_update on public.admin_users;
drop policy if exists admin_users_owner_delete on public.admin_users;
drop policy if exists menu_releases_admin_read on public.menu_releases;
drop policy if exists site_settings_admin_read on public.site_settings;

create policy sections_admin_read
on public.sections for select
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']));

create policy sections_manager_insert
on public.sections for insert
to authenticated
with check (public.has_admin_role(array['owner', 'manager']));

create policy sections_manager_update
on public.sections for update
to authenticated
using (public.has_admin_role(array['owner', 'manager']))
with check (public.has_admin_role(array['owner', 'manager']));

create policy sections_manager_delete
on public.sections for delete
to authenticated
using (public.has_admin_role(array['owner', 'manager']));

create policy categories_admin_read
on public.categories for select
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']));

create policy menu_items_admin_read
on public.menu_items for select
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']));

create policy menu_items_manager_insert
on public.menu_items for insert
to authenticated
with check (public.has_admin_role(array['owner', 'manager']));

create policy menu_items_manager_update
on public.menu_items for update
to authenticated
using (public.has_admin_role(array['owner', 'manager']))
with check (public.has_admin_role(array['owner', 'manager']));

create policy menu_items_manager_delete
on public.menu_items for delete
to authenticated
using (public.has_admin_role(array['owner', 'manager']));

create policy menu_availability_public_read
on public.menu_availability for select
to anon, authenticated
using (true);

create policy menu_availability_admin_insert
on public.menu_availability for insert
to authenticated
with check (public.has_admin_role(array['owner', 'manager', 'staff']));

create policy menu_availability_admin_update
on public.menu_availability for update
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']))
with check (public.has_admin_role(array['owner', 'manager', 'staff']));

create policy menu_availability_manager_delete
on public.menu_availability for delete
to authenticated
using (public.has_admin_role(array['owner', 'manager']));

create policy admin_users_self_or_owner_read
on public.admin_users for select
to authenticated
using (user_id = auth.uid() or public.has_admin_role(array['owner']));

create policy admin_users_owner_insert
on public.admin_users for insert
to authenticated
with check (public.has_admin_role(array['owner']));

create policy admin_users_owner_update
on public.admin_users for update
to authenticated
using (public.has_admin_role(array['owner']))
with check (public.has_admin_role(array['owner']));

create policy admin_users_owner_delete
on public.admin_users for delete
to authenticated
using (public.has_admin_role(array['owner']));

create policy menu_releases_admin_read
on public.menu_releases for select
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']));

create policy site_settings_admin_read
on public.site_settings for select
to authenticated
using (public.has_admin_role(array['owner', 'manager', 'staff']));

create or replace function public.build_menu_snapshot(p_published_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with item_collections as (
    select
      mi.category_id,
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', mi.id,
            'slug', mi.slug,
            'name', mi.name,
            'description', nullif(mi.description, '{}'::jsonb),
            'price', mi.price,
            'image_path', mi.image_path,
            'tag', mi.tag,
            'sort_order', mi.sort_order,
            'availability', jsonb_strip_nulls(
              jsonb_build_object(
                'is_available', coalesce(ma.is_available, true),
                'note', nullif(coalesce(ma.note, '{}'::jsonb), '{}'::jsonb),
                'updated_at', ma.updated_at
              )
            )
          )
        )
        order by mi.sort_order, mi.created_at, mi.id
      ) as normalized_items,
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', mi.id,
            'name', jsonb_build_array(mi.name ->> 'pl', mi.name ->> 'en', mi.name ->> 'ko'),
            'price', jsonb_build_array(mi.price ->> 'pl', mi.price ->> 'en', mi.price ->> 'ko'),
            'tag', mi.tag,
            'image', mi.image_path,
            'availability', case
              when coalesce(ma.is_available, true) then 'available'
              else 'sold_out'
            end
          )
        )
        order by mi.sort_order, mi.created_at, mi.id
      ) as public_items
    from public.menu_items as mi
    left join public.menu_availability as ma on ma.menu_item_id = mi.id
    where mi.archived_at is null
    group by mi.category_id
  ),
  category_payloads as (
    select
      c.section_id,
      c.sort_order,
      c.created_at,
      c.id as category_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'name', c.name,
          'description', nullif(c.description, '{}'::jsonb),
          'order_note', nullif(c.order_note, '{}'::jsonb),
          'image_path', c.image_path,
          'cover', c.cover,
          'is_featured', c.is_featured,
          'featured_order', c.featured_order,
          'sort_order', c.sort_order,
          'items', coalesce(ic.normalized_items, '[]'::jsonb)
        )
      ) as normalized_category,
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', c.slug,
          'title', jsonb_build_array(c.name ->> 'pl', c.name ->> 'en', c.name ->> 'ko'),
          'subtitle', jsonb_build_array(
            coalesce(nullif(btrim(c.description ->> 'pl'), ''), c.name ->> 'pl'),
            coalesce(nullif(btrim(c.description ->> 'en'), ''), c.name ->> 'en'),
            coalesce(nullif(btrim(c.description ->> 'ko'), ''), c.name ->> 'ko')
          ),
          'orderNote', case
            when nullif(btrim(c.order_note ->> 'pl'), '') is not null
             and nullif(btrim(c.order_note ->> 'en'), '') is not null
             and nullif(btrim(c.order_note ->> 'ko'), '') is not null
            then jsonb_build_array(c.order_note ->> 'pl', c.order_note ->> 'en', c.order_note ->> 'ko')
            else null
          end,
          'image', c.image_path,
          'cover', case when c.cover then true else null end,
          'items', coalesce(ic.public_items, '[]'::jsonb)
        )
      ) as public_category
    from public.categories as c
    left join item_collections as ic on ic.category_id = c.id
    where c.archived_at is null
  ),
  section_payloads as (
    select
      s.sort_order,
      s.created_at,
      s.id as section_id,
      jsonb_build_object(
        'id', s.id,
        'slug', s.slug,
        'name', s.name,
        'description', nullif(s.description, '{}'::jsonb),
        'sort_order', s.sort_order,
        'categories', coalesce(
          (
            select jsonb_agg(cp.normalized_category order by cp.sort_order, cp.created_at, cp.category_id)
            from category_payloads as cp
            where cp.section_id = s.id
          ),
          '[]'::jsonb
        )
      ) as normalized_section,
      coalesce(
        (
          select jsonb_agg(cp.public_category order by cp.sort_order, cp.created_at, cp.category_id)
          from category_payloads as cp
          where cp.section_id = s.id
        ),
        '[]'::jsonb
      ) as public_group
    from public.sections as s
    where s.archived_at is null
  )
  select jsonb_build_object(
    'schema_version', 1,
    'published_at', p_published_at,
    'sections', coalesce(
      jsonb_agg(sp.normalized_section order by sp.sort_order, sp.created_at, sp.section_id),
      '[]'::jsonb
    ),
    'groups', coalesce(
      jsonb_agg(sp.public_group order by sp.sort_order, sp.created_at, sp.section_id),
      '[]'::jsonb
    )
  )
  from section_payloads as sp;
$$;

create or replace function public.get_published_menu()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select mr.snapshot
  from public.site_settings as ss
  join public.menu_releases as mr on mr.id = ss.current_release_id
  where ss.id = 1;
$$;

create or replace function public.publish_menu()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published_at timestamptz;
  v_release_id uuid;
  v_snapshot jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may publish the menu.'
      using errcode = '42501';
  end if;

  -- Serialize publications so current_release_id always follows release order.
  perform pg_catalog.pg_advisory_xact_lock(662061563457110137);

  v_published_at := clock_timestamp();
  v_snapshot := public.build_menu_snapshot(v_published_at);

  insert into public.menu_releases (snapshot, published_at, published_by)
  values (v_snapshot, v_published_at, auth.uid())
  returning id into v_release_id;

  insert into public.site_settings (id, current_release_id, updated_at)
  values (1, v_release_id, v_published_at)
  on conflict (id) do update
  set current_release_id = excluded.current_release_id,
      updated_at = excluded.updated_at;

  return v_release_id;
end;
$$;

create or replace function public.publish_initial_menu()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_release_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the service role may publish the initial menu.'
      using errcode = '42501';
  end if;

  -- Make concurrent initial seed attempts converge before either can publish.
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

  return public.publish_menu();
end;
$$;

create or replace function public.create_menu_item(
  p_category_id uuid,
  p_name jsonb,
  p_description jsonb,
  p_price jsonb,
  p_image_path text,
  p_tag text,
  p_sort_order integer,
  p_is_available boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_active_end integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may create menu items.'
      using errcode = '42501';
  end if;

  -- p_sort_order remains in the RPC signature for deployed-client compatibility.
  -- The database owns ordering and serializes all writes through the parent row.
  perform c.id
  from public.categories as c
  where c.id = p_category_id
    and c.archived_at is null
  for update;

  if not found then
    raise exception 'Active target category not found.' using errcode = 'P0002';
  end if;

  perform mi.id
  from public.menu_items as mi
  where mi.category_id = p_category_id
  order by mi.id
  for update;

  select count(*)::integer
  into v_active_end
  from public.menu_items as mi
  where mi.category_id = p_category_id
    and mi.archived_at is null;

  v_item_id := extensions.gen_random_uuid();
  insert into public.menu_items (
    id, category_id, slug, name, description, price, image_path, tag, sort_order
  ) values (
    v_item_id,
    p_category_id,
    'menu-' || replace(v_item_id::text, '-', ''),
    p_name,
    p_description,
    p_price,
    p_image_path,
    p_tag,
    v_active_end
  );

  -- Keep active records first and append the new item at the active boundary.
  with normalized as (
    select
      mi.id,
      (
        row_number() over (
          order by
            case
              when mi.id = v_item_id then 1
              when mi.archived_at is null then 0
              else 2
            end,
            mi.sort_order,
            mi.created_at,
            mi.id
        ) - 1
      )::integer as sort_order
    from public.menu_items as mi
    where mi.category_id = p_category_id
  )
  update public.menu_items as mi
  set sort_order = normalized.sort_order
  from normalized
  where mi.id = normalized.id
    and mi.sort_order is distinct from normalized.sort_order;

  insert into public.menu_availability (menu_item_id, is_available)
  values (v_item_id, p_is_available)
  on conflict (menu_item_id) do update
  set is_available = excluded.is_available;

  return v_item_id;
end;
$$;

create or replace function public.update_menu_item(
  p_item_id uuid,
  p_category_id uuid,
  p_name jsonb,
  p_description jsonb,
  p_price jsonb,
  p_image_path text,
  p_tag text,
  p_sort_order integer,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_category_id uuid;
  v_locked_category_id uuid;
  v_current_archived_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may update menu items.'
      using errcode = '42501';
  end if;

  select mi.category_id
  into v_current_category_id
  from public.menu_items as mi
  where mi.id = p_item_id;

  if not found then
    raise exception 'Menu item not found.' using errcode = 'P0002';
  end if;

  if p_category_id is null then
    raise exception 'Target category is required.' using errcode = '22004';
  end if;

  -- Lock both parents in UUID order so cross-category moves serialize with reorder RPCs.
  perform c.id
  from public.categories as c
  where c.id = any(array[v_current_category_id, p_category_id])
  order by c.id
  for update;

  if v_current_category_id <> p_category_id then
    perform 1
    from public.categories as c
    where c.id = p_category_id
      and c.archived_at is null;

    if not found then
      raise exception 'Active target category not found.' using errcode = 'P0002';
    end if;

    -- Lock both complete sibling sets in a deterministic order before the move.
    perform mi.id
    from public.menu_items as mi
    where mi.category_id = any(array[v_current_category_id, p_category_id])
    order by mi.category_id, mi.id
    for update;
  end if;

  select mi.category_id, mi.archived_at
  into v_locked_category_id, v_current_archived_at
  from public.menu_items as mi
  where mi.id = p_item_id
  for update;

  if not found then
    raise exception 'Menu item not found.' using errcode = 'P0002';
  end if;

  if v_locked_category_id <> v_current_category_id then
    raise exception 'Menu item changed categories concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  -- p_sort_order is intentionally ignored so a stale edit form cannot undo a
  -- concurrent reorder. A parent move is placed at the destination boundary.
  update public.menu_items
  set category_id = p_category_id,
      name = p_name,
      description = p_description,
      price = p_price,
      image_path = p_image_path,
      tag = p_tag
  where id = p_item_id;

  if not found then
    raise exception 'Menu item not found.' using errcode = 'P0002';
  end if;

  if v_current_category_id <> p_category_id then
    with normalized as (
      select
        mi.id,
        (
          row_number() over (
            order by
              case when mi.archived_at is null then 0 else 1 end,
              mi.sort_order,
              mi.created_at,
              mi.id
          ) - 1
        )::integer as sort_order
      from public.menu_items as mi
      where mi.category_id = v_current_category_id
    )
    update public.menu_items as mi
    set sort_order = normalized.sort_order
    from normalized
    where mi.id = normalized.id
      and mi.sort_order is distinct from normalized.sort_order;

    with normalized as (
      select
        mi.id,
        (
          row_number() over (
            order by
              case
                when mi.id = p_item_id and v_current_archived_at is null then 1
                when mi.archived_at is null then 0
                when mi.id = p_item_id then 3
                else 2
              end,
              mi.sort_order,
              mi.created_at,
              mi.id
          ) - 1
        )::integer as sort_order
      from public.menu_items as mi
      where mi.category_id = p_category_id
    )
    update public.menu_items as mi
    set sort_order = normalized.sort_order
    from normalized
    where mi.id = normalized.id
      and mi.sort_order is distinct from normalized.sort_order;
  end if;

  insert into public.menu_availability (menu_item_id, is_available)
  values (p_item_id, p_is_available)
  on conflict (menu_item_id) do update
  set is_available = excluded.is_available;
end;
$$;

create or replace function public.set_menu_item_archived(
  p_item_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_locked_category_id uuid;
  v_current_archived_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may archive or restore menu items.'
      using errcode = '42501';
  end if;

  if p_archived is null then
    raise exception 'Archive state is required.' using errcode = '22004';
  end if;

  select mi.category_id
  into v_category_id
  from public.menu_items as mi
  where mi.id = p_item_id;

  if not found then
    raise exception 'Menu item not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.categories as c
  where c.id = v_category_id
  for update;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  perform mi.id
  from public.menu_items as mi
  where mi.category_id = v_category_id
  order by mi.id
  for update;

  select mi.category_id, mi.archived_at
  into v_locked_category_id, v_current_archived_at
  from public.menu_items as mi
  where mi.id = p_item_id
  for update;

  if not found then
    raise exception 'Menu item not found.' using errcode = 'P0002';
  end if;

  if v_locked_category_id <> v_category_id then
    raise exception 'Menu item changed categories concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  if p_archived = (v_current_archived_at is not null) then
    return;
  end if;

  if not p_archived then
    perform 1
    from public.categories as c
    where c.id = v_category_id
      and c.archived_at is null;

    if not found then
      raise exception 'A menu item cannot be restored into an archived category.'
        using errcode = '23514';
    end if;
  end if;

  update public.menu_items
  set archived_at = case
        when p_archived then coalesce(archived_at, clock_timestamp())
        else null
      end
  where id = p_item_id;

  -- Preserve the full-list contract used by reorder RPCs: active records first,
  -- then archived records. The transitioned row is appended to its new group.
  with normalized as (
    select
      mi.id,
      (
        row_number() over (
          order by
            case
              when not p_archived and mi.id = p_item_id then 1
              when not p_archived and mi.archived_at is null then 0
              when not p_archived then 2
              when p_archived and mi.archived_at is null then 0
              when p_archived and mi.id = p_item_id then 2
              else 1
            end,
            mi.sort_order,
            mi.created_at,
            mi.id
        ) - 1
      )::integer as sort_order
    from public.menu_items as mi
    where mi.category_id = v_category_id
  )
  update public.menu_items as mi
  set sort_order = normalized.sort_order
  from normalized
  where mi.id = normalized.id
    and mi.sort_order is distinct from normalized.sort_order;
end;
$$;

create or replace function public.create_menu_category(
  p_section_id uuid,
  p_name jsonb,
  p_description jsonb,
  p_order_note jsonb,
  p_image_path text,
  p_cover boolean,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_active_end integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may create menu categories.'
      using errcode = '42501';
  end if;

  -- p_sort_order remains in the RPC signature for deployed-client compatibility.
  -- The database owns ordering and serializes all writes through the parent row.
  perform s.id
  from public.sections as s
  where s.id = p_section_id
    and s.archived_at is null
  for update;

  if not found then
    raise exception 'Active section not found.' using errcode = 'P0002';
  end if;

  perform c.id
  from public.categories as c
  where c.section_id = p_section_id
  order by c.id
  for update;

  select count(*)::integer
  into v_active_end
  from public.categories as c
  where c.section_id = p_section_id
    and c.archived_at is null;

  v_category_id := extensions.gen_random_uuid();
  insert into public.categories (
    id,
    section_id,
    slug,
    name,
    description,
    order_note,
    image_path,
    cover,
    sort_order
  ) values (
    v_category_id,
    p_section_id,
    'category-' || replace(v_category_id::text, '-', ''),
    p_name,
    p_description,
    p_order_note,
    p_image_path,
    p_cover,
    v_active_end
  );

  -- Keep active records first and append the new category at the active boundary.
  with normalized as (
    select
      c.id,
      (
        row_number() over (
          order by
            case
              when c.id = v_category_id then 1
              when c.archived_at is null then 0
              else 2
            end,
            c.sort_order,
            c.created_at,
            c.id
        ) - 1
      )::integer as sort_order
    from public.categories as c
    where c.section_id = p_section_id
  )
  update public.categories as c
  set sort_order = normalized.sort_order
  from normalized
  where c.id = normalized.id
    and c.sort_order is distinct from normalized.sort_order;

  return v_category_id;
end;
$$;

create or replace function public.update_menu_category(
  p_category_id uuid,
  p_section_id uuid,
  p_name jsonb,
  p_description jsonb,
  p_order_note jsonb,
  p_image_path text,
  p_cover boolean,
  p_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_section_id uuid;
  v_locked_section_id uuid;
  v_current_archived_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may update menu categories.'
      using errcode = '42501';
  end if;

  select c.section_id
  into v_current_section_id
  from public.categories as c
  where c.id = p_category_id;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  if p_section_id is null then
    raise exception 'Target section is required.' using errcode = '22004';
  end if;

  -- Lock both parents in UUID order so cross-section moves serialize with reorder RPCs.
  perform s.id
  from public.sections as s
  where s.id = any(array[v_current_section_id, p_section_id])
  order by s.id
  for update;

  if v_current_section_id <> p_section_id then
    perform 1
    from public.sections as s
    where s.id = p_section_id
      and s.archived_at is null;

    if not found then
      raise exception 'Active target section not found.' using errcode = 'P0002';
    end if;

    -- Lock both complete sibling sets in a deterministic order before the move.
    perform c.id
    from public.categories as c
    where c.section_id = any(array[v_current_section_id, p_section_id])
    order by c.id
    for update;
  end if;

  select c.section_id, c.archived_at
  into v_locked_section_id, v_current_archived_at
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  if v_locked_section_id <> v_current_section_id then
    raise exception 'Menu category changed sections concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  -- p_sort_order is intentionally ignored so a stale edit form cannot undo a
  -- concurrent reorder. A parent move is placed at the destination boundary.
  update public.categories
  set section_id = p_section_id,
      name = p_name,
      description = p_description,
      order_note = p_order_note,
      image_path = p_image_path,
      cover = p_cover
  where id = p_category_id;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  if v_current_section_id <> p_section_id then
    with normalized as (
      select
        c.id,
        (
          row_number() over (
            order by
              case when c.archived_at is null then 0 else 1 end,
              c.sort_order,
              c.created_at,
              c.id
          ) - 1
        )::integer as sort_order
      from public.categories as c
      where c.section_id = v_current_section_id
    )
    update public.categories as c
    set sort_order = normalized.sort_order
    from normalized
    where c.id = normalized.id
      and c.sort_order is distinct from normalized.sort_order;

    with normalized as (
      select
        c.id,
        (
          row_number() over (
            order by
              case
                when c.id = p_category_id and v_current_archived_at is null then 1
                when c.archived_at is null then 0
                when c.id = p_category_id then 3
                else 2
              end,
              c.sort_order,
              c.created_at,
              c.id
          ) - 1
        )::integer as sort_order
      from public.categories as c
      where c.section_id = p_section_id
    )
    update public.categories as c
    set sort_order = normalized.sort_order
    from normalized
    where c.id = normalized.id
      and c.sort_order is distinct from normalized.sort_order;
  end if;
end;
$$;

create or replace function public.set_menu_category_archived(
  p_category_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section_id uuid;
  v_locked_section_id uuid;
  v_current_archived_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may archive or restore menu categories.'
      using errcode = '42501';
  end if;

  if p_archived is null then
    raise exception 'Archive state is required.' using errcode = '22004';
  end if;

  select c.section_id
  into v_section_id
  from public.categories as c
  where c.id = p_category_id;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  -- Parent-first locking matches the batch reorder RPC and avoids deadlocks.
  perform 1
  from public.sections as s
  where s.id = v_section_id
  for update;

  if not found then
    raise exception 'Menu section not found.' using errcode = 'P0002';
  end if;

  perform c.id
  from public.categories as c
  where c.section_id = v_section_id
  order by c.id
  for update;

  select c.section_id, c.archived_at
  into v_locked_section_id, v_current_archived_at
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  if v_locked_section_id <> v_section_id then
    raise exception 'Menu category changed sections concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  if p_archived = (v_current_archived_at is not null) then
    return;
  end if;

  if not p_archived then
    perform 1
    from public.sections as s
    where s.id = v_section_id
      and s.archived_at is null;

    if not found then
      raise exception 'A category cannot be restored into an archived section.'
        using errcode = '23514';
    end if;
  end if;

  update public.categories
  set archived_at = case
        when p_archived then coalesce(archived_at, clock_timestamp())
        else null
      end
  where id = p_category_id;

  -- Preserve the full-list contract used by reorder RPCs: active records first,
  -- then archived records. The transitioned row is appended to its new group.
  with normalized as (
    select
      c.id,
      (
        row_number() over (
          order by
            case
              when not p_archived and c.id = p_category_id then 1
              when not p_archived and c.archived_at is null then 0
              when not p_archived then 2
              when p_archived and c.archived_at is null then 0
              when p_archived and c.id = p_category_id then 2
              else 1
            end,
            c.sort_order,
            c.created_at,
            c.id
        ) - 1
      )::integer as sort_order
    from public.categories as c
    where c.section_id = v_section_id
  )
  update public.categories as c
  set sort_order = normalized.sort_order
  from normalized
  where c.id = normalized.id
    and c.sort_order is distinct from normalized.sort_order;
end;
$$;

create or replace function public.delete_menu_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may permanently delete menu categories.'
      using errcode = '42501';
  end if;

  perform 1
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.menu_items as mi
    where mi.category_id = p_category_id
  ) then
    raise exception 'Category cannot be deleted while it is referenced by menu items.'
      using
        errcode = '23503',
        hint = 'Permanently delete or move every referenced menu item first.';
  end if;

  delete from public.categories
  where id = p_category_id;
end;
$$;

-- Remove the earlier two-argument reorder contract when this schema is replayed
-- against a development database that already received a draft migration.
drop function if exists public.reorder_menu_categories(uuid, jsonb);
drop function if exists public.reorder_menu_items(uuid, jsonb);
drop function if exists public.parse_sort_order_batch(jsonb);

create or replace function public.parse_reorder_ids(p_ids jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_entity_id uuid;
  v_ids uuid[] := array[]::uuid[];
begin
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then
    raise exception 'Reorder IDs must be a JSON array.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_ids) > 5000 then
    raise exception 'Reorder payload is too large.' using errcode = '54000';
  end if;

  for v_entry in
    select entry.value
    from jsonb_array_elements(p_ids) as entry(value)
  loop
    if jsonb_typeof(v_entry) <> 'string' then
      raise exception 'Every reorder ID must be a UUID string.' using errcode = '22023';
    end if;

    begin
      v_entity_id := (v_entry #>> '{}')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Reorder payload contains an invalid UUID.' using errcode = '22023';
    end;

    if array_position(v_ids, v_entity_id) is not null then
      raise exception 'Reorder payload contains a duplicate id: %.', v_entity_id
        using errcode = '22023';
    end if;

    v_ids := array_append(v_ids, v_entity_id);
  end loop;

  return v_ids;
end;
$$;

create or replace function public.reorder_menu_categories(
  p_section_id uuid,
  p_expected_ids jsonb,
  p_ordered_ids jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_ids uuid[];
  v_ordered_ids uuid[];
  v_current_ids uuid[];
  v_scope_count integer;
  v_matched_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may reorder menu categories.'
      using errcode = '42501';
  end if;

  v_expected_ids := public.parse_reorder_ids(p_expected_ids);
  v_ordered_ids := public.parse_reorder_ids(p_ordered_ids);

  perform 1
  from public.sections as s
  where s.id = p_section_id
  for update;

  if not found then
    raise exception 'Menu section not found.' using errcode = 'P0002';
  end if;

  perform c.id
  from public.categories as c
  where c.section_id = p_section_id
  order by c.id
  for update;

  select
    coalesce(
      array_agg(c.id order by c.sort_order, c.created_at, c.id),
      array[]::uuid[]
    ),
    count(*)::integer
  into v_current_ids, v_scope_count
  from public.categories as c
  where c.section_id = p_section_id;

  if cardinality(v_expected_ids) <> v_scope_count then
    raise exception 'Expected category order is incomplete; reload and retry.'
      using errcode = '40001';
  end if;

  select count(*)::integer
  into v_matched_count
  from public.categories as c
  where c.section_id = p_section_id
    and c.id = any(v_expected_ids);

  if v_matched_count <> v_scope_count then
    raise exception 'Expected category order contains an id outside this section; reload and retry.'
      using errcode = '40001';
  end if;

  if cardinality(v_ordered_ids) <> v_scope_count then
    raise exception 'Desired category order is incomplete; reload and retry.'
      using errcode = '40001';
  end if;

  select count(*)::integer
  into v_matched_count
  from public.categories as c
  where c.section_id = p_section_id
    and c.id = any(v_ordered_ids);

  if v_matched_count <> v_scope_count then
    raise exception 'Desired category order contains an id outside this section; reload and retry.'
      using errcode = '40001';
  end if;

  if v_current_ids = v_ordered_ids then
    return;
  end if;

  if v_current_ids <> v_expected_ids then
    raise exception 'Category order changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  with desired as (
    select
      ordered.id,
      (ordered.position - 1)::integer as sort_order
    from unnest(v_ordered_ids) with ordinality as ordered(id, position)
  )
  update public.categories as c
  set sort_order = desired.sort_order
  from desired
  where c.id = desired.id
    and c.section_id = p_section_id
    and c.sort_order is distinct from desired.sort_order;
end;
$$;

create or replace function public.reorder_menu_items(
  p_category_id uuid,
  p_expected_ids jsonb,
  p_ordered_ids jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_ids uuid[];
  v_ordered_ids uuid[];
  v_current_ids uuid[];
  v_scope_count integer;
  v_matched_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may reorder menu items.'
      using errcode = '42501';
  end if;

  v_expected_ids := public.parse_reorder_ids(p_expected_ids);
  v_ordered_ids := public.parse_reorder_ids(p_ordered_ids);

  perform 1
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Menu category not found.' using errcode = 'P0002';
  end if;

  perform mi.id
  from public.menu_items as mi
  where mi.category_id = p_category_id
  order by mi.id
  for update;

  select
    coalesce(
      array_agg(mi.id order by mi.sort_order, mi.created_at, mi.id),
      array[]::uuid[]
    ),
    count(*)::integer
  into v_current_ids, v_scope_count
  from public.menu_items as mi
  where mi.category_id = p_category_id;

  if cardinality(v_expected_ids) <> v_scope_count then
    raise exception 'Expected menu item order is incomplete; reload and retry.'
      using errcode = '40001';
  end if;

  select count(*)::integer
  into v_matched_count
  from public.menu_items as mi
  where mi.category_id = p_category_id
    and mi.id = any(v_expected_ids);

  if v_matched_count <> v_scope_count then
    raise exception 'Expected menu item order contains an id outside this category; reload and retry.'
      using errcode = '40001';
  end if;

  if cardinality(v_ordered_ids) <> v_scope_count then
    raise exception 'Desired menu item order is incomplete; reload and retry.'
      using errcode = '40001';
  end if;

  select count(*)::integer
  into v_matched_count
  from public.menu_items as mi
  where mi.category_id = p_category_id
    and mi.id = any(v_ordered_ids);

  if v_matched_count <> v_scope_count then
    raise exception 'Desired menu item order contains an id outside this category; reload and retry.'
      using errcode = '40001';
  end if;

  if v_current_ids = v_ordered_ids then
    return;
  end if;

  if v_current_ids <> v_expected_ids then
    raise exception 'Menu item order changed concurrently; reload and retry.'
      using errcode = '40001';
  end if;

  with desired as (
    select
      ordered.id,
      (ordered.position - 1)::integer as sort_order
    from unnest(v_ordered_ids) with ordinality as ordered(id, position)
  )
  update public.menu_items as mi
  set sort_order = desired.sort_order
  from desired
  where mi.id = desired.id
    and mi.category_id = p_category_id
    and mi.sort_order is distinct from desired.sort_order;
end;
$$;

revoke all on table public.sections from anon, authenticated;
revoke all on table public.categories from anon, authenticated;
revoke all on table public.menu_items from anon, authenticated;
revoke all on table public.menu_availability from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.menu_releases from anon, authenticated;
revoke all on table public.site_settings from anon, authenticated;

grant select, insert, update, delete on table public.sections to authenticated;
grant select on table public.categories to authenticated;
grant select on table public.menu_items to authenticated;
grant select, insert, update, delete on table public.admin_users to authenticated;
grant select on table public.menu_releases to authenticated;
grant select on table public.site_settings to authenticated;

grant select, insert, update, delete on table public.sections to service_role;
grant select, insert, update, delete on table public.categories to service_role;
grant select, insert, update, delete on table public.menu_items to service_role;
grant select, insert, update, delete on table public.menu_availability to service_role;
grant select, insert, update, delete on table public.admin_users to service_role;
grant select on table public.menu_releases to service_role;
grant select on table public.site_settings to service_role;

grant select (menu_item_id, is_available, note, updated_at) on public.menu_availability to authenticated;
grant insert (menu_item_id, is_available, note) on public.menu_availability to authenticated;
grant update (is_available, note) on public.menu_availability to authenticated;
grant delete on table public.menu_availability to authenticated;
grant select (menu_item_id, is_available, note, updated_at) on public.menu_availability to anon;

revoke all on function public.is_complete_localized_text(jsonb) from public, anon, authenticated;
revoke all on function public.is_optional_localized_text(jsonb) from public, anon, authenticated;
revoke all on function public.set_content_audit_fields() from public, anon, authenticated;
revoke all on function public.prevent_category_archival_with_active_items() from public, anon, authenticated;
revoke all on function public.require_active_category_for_active_item() from public, anon, authenticated;
revoke all on function public.set_availability_audit_fields() from public, anon, authenticated;
revoke all on function public.create_default_menu_availability() from public, anon, authenticated;
revoke all on function public.current_admin_role() from public, anon, authenticated;
revoke all on function public.has_admin_role(text[]) from public, anon, authenticated;
revoke all on function public.build_menu_snapshot(timestamptz) from public, anon, authenticated;
revoke all on function public.get_published_menu() from public, anon, authenticated;
revoke all on function public.publish_menu() from public, anon, authenticated;
revoke all on function public.publish_initial_menu() from public, anon, authenticated;
revoke all on function public.create_menu_item(uuid, jsonb, jsonb, jsonb, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.update_menu_item(uuid, uuid, jsonb, jsonb, jsonb, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.set_menu_item_archived(uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_menu_category(uuid, jsonb, jsonb, jsonb, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.update_menu_category(uuid, uuid, jsonb, jsonb, jsonb, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.set_menu_category_archived(uuid, boolean) from public, anon, authenticated;
revoke all on function public.delete_menu_category(uuid) from public, anon, authenticated;
revoke all on function public.parse_reorder_ids(jsonb) from public, anon, authenticated;
revoke all on function public.reorder_menu_categories(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reorder_menu_items(uuid, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.is_complete_localized_text(jsonb) to authenticated, service_role;
grant execute on function public.is_optional_localized_text(jsonb) to authenticated, service_role;
grant execute on function public.current_admin_role() to authenticated;
grant execute on function public.has_admin_role(text[]) to authenticated;
grant execute on function public.get_published_menu() to anon, authenticated, service_role;
grant execute on function public.publish_menu() to authenticated, service_role;
grant execute on function public.publish_initial_menu() to service_role;
grant execute on function public.create_menu_item(uuid, jsonb, jsonb, jsonb, text, text, integer, boolean) to authenticated, service_role;
grant execute on function public.update_menu_item(uuid, uuid, jsonb, jsonb, jsonb, text, text, integer, boolean) to authenticated, service_role;
grant execute on function public.set_menu_item_archived(uuid, boolean) to authenticated, service_role;
grant execute on function public.create_menu_category(uuid, jsonb, jsonb, jsonb, text, boolean, integer) to authenticated, service_role;
grant execute on function public.update_menu_category(uuid, uuid, jsonb, jsonb, jsonb, text, boolean, integer) to authenticated, service_role;
grant execute on function public.set_menu_category_archived(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_menu_category(uuid) to authenticated, service_role;
grant execute on function public.reorder_menu_categories(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.reorder_menu_items(uuid, jsonb, jsonb) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_images_public_read on storage.objects;
drop policy if exists menu_images_manager_insert on storage.objects;
drop policy if exists menu_images_manager_update on storage.objects;
drop policy if exists menu_images_manager_delete on storage.objects;

create policy menu_images_public_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'menu-images');

create policy menu_images_manager_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'menu-images'
  and public.has_admin_role(array['owner', 'manager'])
);

create policy menu_images_manager_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'menu-images'
  and public.has_admin_role(array['owner', 'manager'])
)
with check (
  bucket_id = 'menu-images'
  and public.has_admin_role(array['owner', 'manager'])
);

create policy menu_images_manager_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'menu-images'
  and public.has_admin_role(array['owner', 'manager'])
);

commit;

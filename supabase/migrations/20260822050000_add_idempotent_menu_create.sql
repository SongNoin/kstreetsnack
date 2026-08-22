-- Make category/item creation safe to retry after a committed HTTP response is
-- lost. The browser generates one request UUID per open create form. A private,
-- append-only ledger binds that UUID to the caller, exact create payload, and
-- resulting entity so the same request can only replay the same operation.

begin;

create table if not exists public.menu_create_requests (
  request_id uuid primary key,
  entity_type text not null check (entity_type in ('category', 'item')),
  entity_id uuid not null,
  requested_by uuid,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

comment on table public.menu_create_requests is
  'Private append-only idempotency ledger for menu/category create RPCs.';

create or replace function public.prevent_menu_create_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Menu create request records are immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists menu_create_requests_immutable on public.menu_create_requests;
create trigger menu_create_requests_immutable
before update or delete on public.menu_create_requests
for each row execute function public.prevent_menu_create_request_change();

alter table public.menu_create_requests enable row level security;
revoke all on table public.menu_create_requests from public, anon, authenticated, service_role;

create or replace function public.create_menu_item_idempotent(
  p_request_id uuid,
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
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_existing public.menu_create_requests%rowtype;
  v_item_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may create menu items.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'A create request ID is required.' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'category_id', p_category_id,
    'name', p_name,
    'description', p_description,
    'price', p_price,
    'image_path', p_image_path,
    'tag', p_tag,
    'is_available', p_is_available
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('menu-item-create:' || p_request_id::text, 0)
  );

  select request.*
  into v_existing
  from public.menu_create_requests as request
  where request.request_id = p_request_id;

  if found then
    if v_existing.entity_type <> 'item'
       or v_existing.requested_by is distinct from v_actor
       or v_existing.request_payload is distinct from v_payload then
      raise exception 'The create request ID was already used for different menu data.'
        using errcode = '40001';
    end if;
    if not exists (
      select 1 from public.menu_items as item where item.id = v_existing.entity_id
    ) then
      raise exception 'The menu created by this request no longer exists.'
        using errcode = '55000';
    end if;
    return v_existing.entity_id;
  end if;

  v_item_id := public.create_menu_item(
    p_category_id,
    p_name,
    p_description,
    p_price,
    p_image_path,
    p_tag,
    p_sort_order,
    p_is_available
  );

  insert into public.menu_create_requests (
    request_id, entity_type, entity_id, requested_by, request_payload
  ) values (
    p_request_id, 'item', v_item_id, v_actor, v_payload
  );

  return v_item_id;
end;
$$;

create or replace function public.create_menu_category_idempotent(
  p_request_id uuid,
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
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_existing public.menu_create_requests%rowtype;
  v_category_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_admin_role(array['owner', 'manager']) then
    raise exception 'Only an owner or manager may create menu categories.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'A create request ID is required.' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'section_id', p_section_id,
    'name', p_name,
    'description', p_description,
    'order_note', p_order_note,
    'image_path', p_image_path,
    'cover', p_cover
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('menu-category-create:' || p_request_id::text, 0)
  );

  select request.*
  into v_existing
  from public.menu_create_requests as request
  where request.request_id = p_request_id;

  if found then
    if v_existing.entity_type <> 'category'
       or v_existing.requested_by is distinct from v_actor
       or v_existing.request_payload is distinct from v_payload then
      raise exception 'The create request ID was already used for different category data.'
        using errcode = '40001';
    end if;
    if not exists (
      select 1 from public.categories as category where category.id = v_existing.entity_id
    ) then
      raise exception 'The category created by this request no longer exists.'
        using errcode = '55000';
    end if;
    return v_existing.entity_id;
  end if;

  v_category_id := public.create_menu_category(
    p_section_id,
    p_name,
    p_description,
    p_order_note,
    p_image_path,
    p_cover,
    p_sort_order
  );

  insert into public.menu_create_requests (
    request_id, entity_type, entity_id, requested_by, request_payload
  ) values (
    p_request_id, 'category', v_category_id, v_actor, v_payload
  );

  return v_category_id;
end;
$$;

-- Remove the non-idempotent browser entry points. The wrappers above remain
-- able to call them as their owner, while all remote callers must supply a
-- stable request UUID.
revoke all on function public.create_menu_item(
  uuid, jsonb, jsonb, jsonb, text, text, integer, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.create_menu_category(
  uuid, jsonb, jsonb, jsonb, text, boolean, integer
) from public, anon, authenticated, service_role;

revoke all on function public.create_menu_item_idempotent(
  uuid, uuid, jsonb, jsonb, jsonb, text, text, integer, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.create_menu_category_idempotent(
  uuid, uuid, jsonb, jsonb, jsonb, text, boolean, integer
) from public, anon, authenticated, service_role;

grant execute on function public.create_menu_item_idempotent(
  uuid, uuid, jsonb, jsonb, jsonb, text, text, integer, boolean
) to authenticated, service_role;
grant execute on function public.create_menu_category_idempotent(
  uuid, uuid, jsonb, jsonb, jsonb, text, boolean, integer
) to authenticated, service_role;

commit;

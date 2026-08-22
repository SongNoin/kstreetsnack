-- Keep audit actor fields compatible with their ON DELETE SET NULL foreign
-- keys without allowing an ordinary content update to rewrite audit history.

begin;

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

commit;

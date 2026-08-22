-- Fail a GitHub dispatch only while its request is still queued. This makes a
-- lost dispatch response safe: either this compare-and-set wins and a late
-- workflow stops at its running callback, or the running callback wins and the
-- Edge Function cannot overwrite it with a terminal failure.

begin;

create or replace function public.fail_queued_menu_deployment(
  p_release_id uuid,
  p_request_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the deployment service may fail a queued deployment.'
      using errcode = '42501';
  end if;

  -- Serialize behind request_menu_deployment. If its HTTP response timed out
  -- while the transaction was still running, this cleanup must wait for that
  -- commit before deciding whether the exact queued UUID exists.
  perform pg_catalog.pg_advisory_xact_lock(662061563457110138);

  update public.menu_releases
  set deployment_status = 'failed',
      deployment_finished_at = clock_timestamp(),
      deployment_error = left(
        coalesce(nullif(btrim(p_error), ''), 'GitHub workflow dispatch failed.'),
        1000
      )
  where id = p_release_id
    and deployment_request_id = p_request_id
    and deployment_status = 'queued';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.fail_queued_menu_deployment(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_queued_menu_deployment(uuid, uuid, text)
  to service_role;

commit;

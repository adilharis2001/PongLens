-- my_storage_state returns a column called breakdown, and the snapshot
-- table has a column called breakdown. Inside a PL/pgSQL function the
-- returned column is a variable, so an unqualified "breakdown" in the body
-- was ambiguous and every call failed with 42702, which the upload gate
-- reads as "could not check your allowance" and refuses. Live for about
-- 25 minutes on 2026-09-14 before the first Account page load found it.
-- Same body as 20260914230000, with the reference qualified.

drop function if exists public.my_storage_state();

create function public.my_storage_state()
returns table (
  storage_limit_bytes    bigint,
  daily_upload_limit     int,
  used_bytes             bigint,
  uploads_today          int,
  active_jobs            int,
  pending_request        boolean,
  base_limit_bytes       bigint,
  entitlement_bytes      bigint,
  entitlement_expires_at timestamptz,
  held_bytes             bigint,
  snapshot_at            timestamptz,
  breakdown              jsonb
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  perform public._ensure_quota(v_me);
  return query
  with ent as (
    select coalesce(sum(e.bytes), 0)::bigint as bytes,
           min(e.expires_at) as next_expiry
    from public.storage_entitlements e
    where e.user_id = v_me and e.expires_at > now()
  ),
  snap as (
    select s.measured_at as measured_at, s.breakdown as kinds
    from public.storage_snapshots s
    where s.user_id = v_me
  )
  select
    q.storage_limit_bytes + ent.bytes,
    q.daily_upload_limit,
    public._storage_used_bytes(v_me),
    ((select count(*) from public.matches m
      where m.user_id = v_me and m.raw_path is not null
        and m.created_at >= date_trunc('day', now()))
     + (select count(*) from public.jobs j
        where j.user_id = v_me
          and ((j.kind = 'deadspace_cut' and j.options ->> 'match_id' is null)
               or j.kind = 'youtube_import')
          and j.created_at >= date_trunc('day', now())))::int,
    (select count(*) from public.jobs j
     where j.user_id = v_me
       and j.status in ('queued', 'processing')
       and j.kind not in ('reclip', 'content_check'))::int,
    exists (select 1 from public.quota_requests r
            where r.user_id = v_me and r.status = 'pending'),
    q.storage_limit_bytes,
    ent.bytes,
    ent.next_expiry,
    0::bigint,
    (select sn.measured_at from snap sn),
    coalesce((select sn.kinds from snap sn), '{}'::jsonb)
  from public.user_quotas q, ent
  where q.user_id = v_me;
end;
$$;

revoke execute on function public.my_storage_state() from public, anon;
grant execute on function public.my_storage_state() to authenticated;

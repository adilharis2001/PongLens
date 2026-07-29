-- 049: explicit match-level placement lifecycle and one owner-requested retry.
--
-- Placement generation is an optional sub-result of match processing. Keep it
-- separate from matches.status so a usable match remains ready when placement
-- calibration fails. The retry RPC owns the count and queue write atomically;
-- browser clients never receive direct update access to these columns.

alter table public.matches
  add column placement_status text not null default 'not_requested',
  add column placement_retry_count smallint not null default 0,
  add column placement_mapped_points integer not null default 0,
  add column placement_failure_code text,
  add column placement_retry_expires_at timestamptz,
  add column placement_retry_job_id uuid references public.jobs(id)
    on delete set null;

alter table public.matches
  add constraint matches_placement_status_check check (
    placement_status in (
      'not_requested', 'processing', 'ready',
      'retry_available', 'retrying', 'final_failed'
    )
  ),
  add constraint matches_placement_retry_count_check
    check (placement_retry_count between 0 and 1),
  add constraint matches_placement_mapped_points_check
    check (placement_mapped_points >= 0);

-- Preserve current behavior for existing data without unexpectedly granting a
-- retry. Historical placement requests whose output is not drawable become a
-- final failure because their raw source retention cannot be guaranteed.
with placement_rollup as (
  select
    m.id,
    coalesce(bool_or(
      coalesce((j.options->>'placement')::boolean, false)
    ), false) as requested,
    count(p.id) filter (
      where jsonb_path_exists(
        coalesce(p.placement, '{}'::jsonb),
        '$.hypotheses.*.shots[*] ? (@.landing != null || @.terminal != null)'
      )
      or case
        when jsonb_typeof(p.placement->'bounces') = 'array'
          then jsonb_array_length(p.placement->'bounces') > 0
        else false
      end
    )::integer as mapped_points
  from public.matches m
  left join public.jobs j on j.id = m.job_id
  left join public.points p on p.match_id = m.id
  group by m.id
)
update public.matches m
set placement_mapped_points = r.mapped_points,
    placement_status = case
      when r.mapped_points > 0 then 'ready'
      when r.requested is false then 'not_requested'
      else 'final_failed'
    end,
    placement_failure_code = case
      when r.mapped_points = 0 and r.requested then 'historical_unavailable'
      else null
    end
from placement_rollup r
where r.id = m.id;

create or replace function public.request_placement_retry(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.user_id <> auth.uid() then
    raise exception 'not owner' using errcode = '42501';
  end if;
  if v_match.placement_status = 'retrying' then
    raise exception 'placement retry already queued' using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'retry_available' then
    raise exception 'placement retry unavailable' using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement retry already used' using errcode = '23514';
  end if;
  if v_match.placement_retry_expires_at is null
     or v_match.placement_retry_expires_at <= now() then
    update public.matches
    set placement_status = 'final_failed',
        placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  -- The existing jobs_enqueue trigger sends this row to pgmq in the same
  -- transaction. If either write fails, neither the job nor lifecycle change
  -- is committed.
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'placement_retry', 'queued', null,
          'Placement retry',
          jsonb_build_object('match_id', p_match_id))
  returning id into v_job_id;

  update public.matches
  set placement_status = 'retrying',
      placement_retry_count = 1,
      placement_retry_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_retry(uuid) from public, anon;
grant execute on function public.request_placement_retry(uuid)
  to authenticated;

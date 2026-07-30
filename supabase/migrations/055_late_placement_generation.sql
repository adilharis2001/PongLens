-- 055: permit a single owner-requested placement generation while the source
-- recording remains within its 30-day retention deadline.

alter table public.matches
  add column placement_generation_job_id uuid references public.jobs(id)
    on delete set null;

-- Pre-rollout not_requested and retry_available rows can only receive a
-- deadline when their original source was created recently enough that the
-- raw recording is reliably retained. The deadline itself is always exactly
-- 30 days after the source job was created.
update public.matches m
set placement_retry_expires_at = j.created_at + interval '30 days'
from public.jobs j
where j.id = m.job_id
  and m.placement_status = 'not_requested'
  and m.placement_retry_count = 0
  and m.placement_generation_job_id is null
  and j.created_at >= now() - interval '7 days';

update public.matches m
set placement_retry_expires_at = j.created_at + interval '30 days'
from public.jobs j
where j.id = m.job_id
  and m.placement_status = 'retry_available'
  and m.placement_retry_count = 0
  and j.created_at >= now() - interval '7 days';

create or replace function public.request_placement_generation(
  p_match_id uuid
)
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
  if v_match.status <> 'ready' then
    raise exception 'match is not ready' using errcode = 'P0001';
  end if;
  if v_match.placement_status = 'processing'
     or v_match.placement_generation_job_id is not null then
    raise exception 'placement generation already queued'
      using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'not_requested' then
    raise exception 'placement generation unavailable'
      using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement generation already used'
      using errcode = '23514';
  end if;
  if v_match.placement_retry_expires_at is null
     or v_match.placement_retry_expires_at <= now() then
    update public.matches
    set placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  insert into public.jobs (
    user_id, kind, status, input_path, original_name, options
  )
  values (auth.uid(), 'placement_generate', 'queued', null,
    'Placement generation', jsonb_build_object('match_id', p_match_id)
  )
  returning id into v_job_id;

  update public.matches
  set placement_status = 'processing',
      placement_generation_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_generation(uuid)
  from public, anon;
grant execute on function public.request_placement_generation(uuid)
  to authenticated;

-- Placement RPCs already lock and authorize their match. Stamp the version
-- at enqueue, not worker claim: a queued attempt must never attach itself to
-- a cut published later. Reclip/reel RPCs already carry this identity.
create or replace function public.stamp_placement_job_version()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_version uuid;
begin
  if new.kind not in ('placement_generate','placement_retry') then return new; end if;
  select active_processing_version_id into v_version from public.matches
  where id=(new.options->>'match_id')::uuid and user_id=new.user_id for share;
  if v_version is null then
    raise exception 'placement job has no owned processing version' using errcode='23514';
  end if;
  new.options:=new.options||jsonb_build_object('processing_version_id',v_version);
  return new;
end $$;
revoke all on function public.stamp_placement_job_version() from public,anon,authenticated;
create trigger jobs_stamp_placement_version before insert on public.jobs
for each row execute function public.stamp_placement_job_version();

-- Only the still-recorded attempt can be recovered safely. Activation clears
-- these pointers, so no abandoned pre-publication job is assigned a new cut.
update public.jobs j set options=j.options||jsonb_build_object(
  'processing_version_id',m.active_processing_version_id)
from public.matches m
where j.kind in ('placement_generate','placement_retry')
  and j.status in ('queued','processing')
  and j.user_id=m.user_id and j.options->>'match_id'=m.id::text
  and not (j.options ? 'processing_version_id')
  and ((j.kind='placement_generate' and m.placement_generation_job_id=j.id)
    or (j.kind='placement_retry' and m.placement_retry_job_id=j.id));

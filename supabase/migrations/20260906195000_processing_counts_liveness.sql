-- The hub card could not tell "not wired up" from "broken".
--
-- admin_processing_counts answered one question about liveness — is any
-- Mac worker beating right now — and the /admin card turned a No into
-- "Not reporting", in the accent colour, next to a worker that was
-- processing a job perfectly well at the time. That is the worst failure
-- available to a status page: it cried wolf on healthy work, and the
-- owner read it as an outage.
--
-- Two more facts fix it, and both are already in the tables:
--
--   moving        any job a worker has touched in the last three minutes:
--                 one in flight advancing its progress, or one it has just
--                 finished or failed. Nothing but a worker writes those
--                 rows, so movement is proof something is running.
--                 Stillness proves nothing — a dead space cut ticks every
--                 twenty seconds, but placement writes 5, 20, 100 and
--                 stands still for hours while perfectly healthy — so this
--                 is only ever read as evidence FOR life, never against.
--
--                 Finished jobs are included deliberately. Restricted to
--                 jobs in flight, this went false for the few seconds
--                 between one job ending and the next starting, and the
--                 card flicked to an alarm each time the worker got
--                 something DONE. 'queued' and 'cancelled' are excluded
--                 because the app writes those too, and this has to stay
--                 a signal only a worker can produce.
--
--   ever_reported whether any Mac worker has ever sent a beat. A pulse row
--                 is inserted on a worker's first beat and updated forever
--                 after, so no row at all means this worker has never once
--                 reported. It cannot have "stopped": it never started.
--                 Silence from a worker that has never spoken is a setup
--                 gap, not a fault, and must not be coloured like one.
--
-- Nothing else changes: same name, same shape plus two booleans, same
-- is_admin() re-check.

create or replace function public.admin_processing_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object(
    'queued', count(*) filter (where j.status = 'queued'),
    'running', count(*) filter (where j.status = 'processing'),
    'oldest_wait_s', coalesce(
      extract(epoch from now() - min(j.created_at)
              filter (where j.status = 'queued')), 0)::int,
    -- Whether anything on the Mac is beating at all. A silent worker with
    -- an empty queue is still the thing worth putting on the hub.
    'reporting', exists (
      select 1 from public.worker_pulse p
       where p.host = 'mac' and p.beat_at > now() - interval '90 seconds'),
    -- Proof of life that does not need the worker to report anything.
    -- Kept in step with JOB_MOVED_S in processingView.ts. Its own EXISTS
    -- rather than a filter on the outer query, which sees only queued and
    -- processing rows and so could never see a job just finished.
    'moving', exists (
      select 1 from public.jobs j2
       where j2.status in ('processing', 'done', 'failed')
         and j2.updated_at > now() - interval '180 seconds'),
    -- Has a Mac worker ever spoken here at all?
    'ever_reported', exists (
      select 1 from public.worker_pulse p where p.host = 'mac')
  ) into v
  from public.jobs j
  where j.status in ('queued', 'processing');
  return v;
end;
$$;

revoke execute on function public.admin_processing_counts() from public;
grant execute on function public.admin_processing_counts() to authenticated;

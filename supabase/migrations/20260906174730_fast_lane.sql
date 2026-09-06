-- A second queue for the jobs a person is waiting on.
--
-- Every job kind shared one pgmq queue and one worker process, first in
-- first out. A re-cut of one rally (seconds of work) queued behind a
-- forty-minute upload whenever someone else had just uploaded, and a share
-- render queued behind both. This adds 'jobs_fast' and routes 'reclip'
-- jobs and the vertical share renders (reel scope 'v:...') to it — once
-- app_config.reclip_lane says 'fast'.
--
-- The switch defaults to 'main' on purpose: a queue with no process
-- reading it is a queue nobody drains. Start the second worker
-- (worker.py --lane fast; see worker/README.md "Fast lane") and only then
-- set reclip_lane = 'fast'. Setting it back to 'main' is the rollback.

do $$
begin
  perform pgmq.create('jobs_fast');
exception when others then
  null;   -- already exists
end $$;

insert into public.app_config (key, value)
values ('reclip_lane', 'main')
on conflict (key) do nothing;

create or replace function public.enqueue_job()
returns trigger
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_queue text := 'jobs';
  v_lane text;
begin
  if new.kind = 'reclip'
     or (new.kind = 'reel' and coalesce(new.options->>'scope', '') like 'v:%')
  then
    select value into v_lane from public.app_config where key = 'reclip_lane';
    if v_lane = 'fast' then
      v_queue := 'jobs_fast';
    end if;
  end if;
  perform pgmq.send(
    v_queue,
    jsonb_build_object(
      'job_id', new.id,
      'user_id', new.user_id,
      'kind', new.kind,
      'input_path', new.input_path,
      'options', new.options
    ),
    case when new.kind in ('deadspace_cut', 'youtube_import') then 60
         when new.kind = 'reclip' then 5
         else 0 end
  );
  return new;
end;
$$;

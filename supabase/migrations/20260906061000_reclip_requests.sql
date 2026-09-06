-- Re-cut requests move into the database.
--
-- A timing edit (Split, Join, Adjust, Insert, Unsplit, a restore of an
-- edited point) leaves rows with edited = true, and the worker's 'reclip'
-- job re-cuts every such point's clip file. Until now the APPS asked for
-- that job: the web waited four seconds after the last edit and inserted a
-- jobs row, iOS inserted one immediately, both only if none was queued.
-- Three ways that lost the request, each seen in the reads of 2026-09-06:
--   * reload or close the web page within four seconds of an edit and the
--     timer died with it — the card sat on "Updating clip" until some later
--     edit happened to queue a job;
--   * a three-way split that failed on its second RPC returned before the
--     enqueue line on iOS, leaving the created halves flagged with no job;
--   * the insert was try?-swallowed on iOS and unchecked on the web, so a
--     refused row (offline, RLS) was silent.
-- And the dedupe only looked at 'queued', so every edit made while a job
-- was already processing queued another full run.
--
-- Now a trigger on points requests the job whenever a row ends up edited
-- and not deleted after a timing change. One queued reclip per match is
-- enforced by a unique partial index (the insert is ON CONFLICT DO
-- NOTHING), and the queue message carries a five-second delay so a burst
-- of edits becomes one job. The worker re-checks at the end of a run and
-- requests another pass for anything that changed while it was cutting.
-- No client inserts a reclip job any more, so the jobs insert policy
-- narrows to the one kind an API route still inserts as the user.

create unique index if not exists jobs_one_queued_reclip_per_match
  on public.jobs ((options->>'match_id'))
  where kind = 'reclip' and status = 'queued';

create or replace function public.request_reclip(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.matches where id = p_match_id;
  if v_user is null then
    return;   -- a deleted match has nothing to re-cut
  end if;
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (v_user, 'reclip', 'queued', null, 'Clip update',
          jsonb_build_object('match_id', p_match_id))
  on conflict ((options->>'match_id'))
    where kind = 'reclip' and status = 'queued'
    do nothing;
end;
$$;

revoke execute on function public.request_reclip(uuid) from public, anon,
  authenticated;
-- The worker's direct connection and the trigger below call it; nothing
-- client-facing needs to.

create or replace function public.request_reclip_for_point()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.edited and not new.deleted
     and new.t0 is not null and new.t1 is not null then
    perform public.request_reclip(new.match_id);
  end if;
  return null;
end;
$$;

drop trigger if exists points_request_reclip on public.points;
create trigger points_request_reclip
  after insert or update of t0, t1, edited, deleted, tight_start, tight_end
  on public.points
  for each row
  when (new.edited and not new.deleted)
  execute function public.request_reclip_for_point();

-- Reclips get a short queue delay so the burst of edits a player makes in
-- one sitting becomes one job. Uploads and imports keep their sixty
-- seconds of options-editing grace (022/024); everything else stays
-- immediate.
create or replace function public.enqueue_job()
returns trigger
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.send(
    'jobs',
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

-- The jobs insert policy checked only user_id, so a signed-in client could
-- insert any kind with any input path: a 'deadspace_cut' pointing at an
-- arbitrary object, a 'content_check' for another user's match, a
-- 'youtube_import' that skipped the route's limits. Every kind but one is
-- now inserted by a SECURITY DEFINER function or by the worker; the
-- YouTube import route still inserts as the user, so it stays allowed.
drop policy if exists "Users can create own jobs" on public.jobs;
create policy "Users can create own jobs"
  on public.jobs for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and kind = 'youtube_import'
  );

-- Anything already flagged with no job waiting for it (the lost requests
-- above) gets one now.
insert into public.jobs (user_id, kind, status, input_path, original_name,
                         options)
select m.user_id, 'reclip', 'queued', null, 'Clip update',
       jsonb_build_object('match_id', m.id)
from public.matches m
where exists (
        select 1 from public.points p
        where p.match_id = m.id and p.edited and not p.deleted
          and p.t0 is not null and p.t1 is not null)
  and not exists (
        select 1 from public.jobs j
        where j.kind = 'reclip' and j.status in ('queued', 'processing')
          and j.options->>'match_id' = m.id::text)
on conflict ((options->>'match_id'))
  where kind = 'reclip' and status = 'queued'
  do nothing;

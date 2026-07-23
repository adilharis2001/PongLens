-- YouTube imports get the same 60s enqueue grace as direct uploads (022).
-- The import form now collects the processing options AFTER submit (parity
-- with the upload card), so the editing window opens at queue time. The
-- worker re-reads jobs.options after the yt-dlp download finishes — the
-- true cutoff — so most videos get minutes of grace from the download
-- alone; the 60s delay guarantees a floor even for an instantly-downloaded
-- Short picked up by an idle worker. reclip / reel stay immediate: the
-- user is waiting on the result.
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
         else 0 end
  );
  return new;
end;
$$;

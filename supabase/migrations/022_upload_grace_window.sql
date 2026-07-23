-- Upload grace window: direct uploads ('deadspace_cut') enqueue with a 60s
-- pgmq delay so the upload form's processing toggles (points / placement /
-- strictness) stay usable for a beat after a fast upload completes. The
-- worker reads options fresh from the jobs row at pickup (get_job_options
-- is row-first since this change), so edits inside the window are honored.
-- Other kinds submit with final options and stay immediate:
--   youtube_import — options are chosen before Import
--   reclip / reel  — user is waiting on the result
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
    case when new.kind = 'deadspace_cut' then 60 else 0 end
  );
  return new;
end;
$$;

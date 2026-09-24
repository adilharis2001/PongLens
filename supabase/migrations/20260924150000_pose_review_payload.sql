-- Keep prior review payloads valid; only this frozen pose run may use version 2.
-- The importer validates the full v2 shape, source hashes and ranking gates.
-- Human labels, earlier suggestions, grants and RLS policies are unchanged.
alter table public.point_ending_suggestions
  drop constraint point_ending_suggestions_check;

alter table public.point_ending_suggestions
  add constraint point_ending_suggestions_check check (
    jsonb_typeof(payload) = 'object'
    and payload->>'runId' = run_id
    and (
      payload->>'version' = '1'
      or coalesce((
        run_id = 'pose-last-bounce-20260924-v1'
        and payload->'version' = '2'::jsonb
        and jsonb_typeof(payload->'ranking') = 'object'
      ), false)
    )
  );

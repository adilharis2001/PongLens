-- A deleted match takes its waiting follow-up jobs with it.
--
-- 2026-09-25: Adil deleted two freshly hand-cut matches (e759484a,
-- e92439f4) minutes after they published. Their detailed analysis and
-- highlights, queued automatically on publish, were still waiting on the
-- hand lane; they ran against a match that no longer existed, failed
-- ("placement attempt match not found", "no match_reels row"), and every
-- failure emailed the admin an "[Action needed]".
--
-- The worker already skips a job whose row reads 'cancelled' and archives
-- its queue message silently (process_job's claim refuses cancelled rows),
-- so marking the match's QUEUED follow-ups cancelled at delete time is the
-- whole fix, with no worker release. Only follow-ups that cost the player
-- nothing: detailed analysis, placement retries, reels and clip re-cuts.
-- Processing, hand cuts and re-cuts keep their own refund paths untouched.
--
-- Never allowed to stop a delete: any error here is swallowed.
create or replace function public._cancel_followups_of_deleted_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.jobs
       set status = 'cancelled',
           progress = 100
     where status = 'queued'
       and kind in ('placement_generate', 'placement_retry', 'reel', 'reclip')
       and options->>'match_id' = old.id::text;
  exception when others then
    raise warning 'cancel follow-ups of deleted match % failed: %', old.id, sqlerrm;
  end;
  return old;
end;
$$;

revoke all on function public._cancel_followups_of_deleted_match() from public, anon, authenticated;

drop trigger if exists matches_cancel_followups_on_delete on public.matches;
create trigger matches_cancel_followups_on_delete
  before delete on public.matches
  for each row execute function public._cancel_followups_of_deleted_match();

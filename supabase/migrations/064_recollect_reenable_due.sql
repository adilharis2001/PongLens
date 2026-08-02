-- 064: re-enabling Recollect must not hide everything for a day.
--
-- The re-enable backfill queued every lesson with first_due_at = now() + 1
-- day, and complete_recollect_job copies that straight onto each item's
-- next_due_at. The tab only shows items whose next_due_at has passed — so
-- after turning Recollect back on you waited out the whole processing run
-- only to be told there is nothing to revisit, for the next 24 hours,
-- however old the lessons were.
--
-- The ordinary path never did this. enqueue_recollect_source defaults to
-- `v_lesson.created_at + interval '1 day'` — a day after the LESSON, which
-- for anything older than a day is already in the past and therefore due.
-- This lines the re-enable up with it: turning the feature back on restores
-- what you had rather than starting a fresh 24-hour wait.
--
-- Everything else in the function is unchanged from 059, which is the
-- definition in force — NOT 058. 058 and 059 both replace this function and
-- differ only in the processor version; copying the wrong one silently
-- downgrades every future re-enable to v2.
create or replace function public.set_recollect_enabled(
  p_owner_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_disabled boolean := false;
  v_queued integer := 0;
begin
  select not enabled into v_was_disabled
  from public.recollect_preferences
  where user_id = p_owner_id;
  v_was_disabled := coalesce(v_was_disabled, false);

  insert into public.recollect_preferences (user_id, enabled, updated_at)
  values (p_owner_id, p_enabled, now())
  on conflict (user_id) do update
  set enabled = excluded.enabled, updated_at = now();

  if not p_enabled then
    delete from public.recollect_jobs where user_id = p_owner_id;
    delete from public.recollect_items where user_id = p_owner_id;
    return jsonb_build_object('enabled', false, 'queued', 0);
  end if;

  if v_was_disabled then
    insert into public.recollect_jobs (
      user_id, lesson_id, content_hash, processor_version, first_due_at
    )
    select
      l.user_id,
      l.id,
      encode(
        extensions.digest(convert_to(l.transcript, 'UTF8'), 'sha256'),
        'hex'
      ),
      -- Must track RECOLLECT_PROCESSOR_VERSION. 059 moved this to v3, and
      -- recollectMigration.test.ts pins the newest migration to it.
      'recollect-v3',
      -- Was now() + interval '1 day'. Dated from the LESSON, same as
      -- enqueue_recollect_source.
      l.created_at + interval '1 day'
    from public.lessons l
    where l.user_id = p_owner_id and l.kind in ('lesson', 'practice')
    on conflict (lesson_id, content_hash, processor_version) do nothing;
    get diagnostics v_queued = row_count;
  end if;

  return jsonb_build_object('enabled', true, 'queued', v_queued);
end;
$$;

revoke execute on function public.set_recollect_enabled(uuid, boolean)
  from public;
grant execute on function public.set_recollect_enabled(uuid, boolean)
  to service_role;

-- Jobs queued by the old backfill and not yet finished carry the bad date.
-- They have produced no items yet (that happens on completion), so moving
-- the date now is enough to spare them the same 24-hour blackout.
update public.recollect_jobs j
set first_due_at = l.created_at + interval '1 day',
    updated_at = now()
from public.lessons l
where l.id = j.lesson_id
  and j.status in ('queued', 'processing', 'failed')
  and j.first_due_at > l.created_at + interval '1 day';

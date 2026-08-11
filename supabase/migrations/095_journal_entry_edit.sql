-- 095: journal entries become editable — and deleting one stops its ghost
-- living on in Recollect.
--
-- The edit itself needs no schema: PATCH /api/lesson rewrites the row and
-- re-enqueues Recollect, whose (lesson_id, content_hash, processor_version)
-- uniqueness already makes re-enqueueing an edited transcript a new job and
-- re-saving an unchanged one a no-op. Ask reads the live tables, so an
-- edit is in the next answer with no work at all.
--
-- Deletion is the gap. recollect_jobs and recollect_item_sources cascade
-- when a lesson goes, but recollect_items has no FK to lessons — an item
-- distilled from a deleted entry survives with zero source rows, and its
-- reminder keeps firing for words the player explicitly removed. Deleting
-- the entry is the player saying "this content is gone"; reminders built
-- only from it must go with it.
--
-- An item that ALSO has sources in other lessons keeps living, which is
-- right: the advice is still written down somewhere.

create or replace function public.prune_orphaned_recollect_items(
  p_user_id uuid
)
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from recollect_items i
     where i.user_id = p_user_id
       and not exists (
         select 1 from recollect_item_sources s where s.item_id = i.id
       )
    returning 1
  )
  select count(*)::integer from gone;
$$;

-- Service role only, like every other recollect writer.
revoke all on function public.prune_orphaned_recollect_items(uuid)
  from public, anon, authenticated;

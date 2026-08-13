-- 101: QA reports stay off the public board.
--
-- The tester files bugs through the same /feedback page every player uses,
-- and a tester's repro notes are not community feedback. Left alone they
-- would sit in the vote ranking next to feature requests, from an account
-- no other player recognises.
--
-- Enforced on the row, not by convention. A "[BUG]" prefix in the title
-- works right up until the one time it is forgotten, and by then the
-- report is public. is_qa() already knows who the tester is.
--
-- Enforced on the way in, not in the read. visibility = 'private' is the
-- switch the whole feedback system already respects: feedback_board
-- filters on it, the select policy keeps private rows to their author and
-- the admin, and feedback_toggle_vote refuses to vote on one. Setting it
-- at write time means nothing else has to learn about the QA role.
--
-- feedback_board then re-admits those rows for the author and the admin,
-- so the QA "Mine" filter still lists them and triage stays on the page
-- rather than in the database. Narrowly: QA rows only, so a declined
-- duplicate (which also goes private) stays hidden the way it does today.

-- ---------------------------------------------------------------------------
-- The write-time forcing.
--
-- INSERT always. UPDATE only when the author is the one updating, which
-- covers feedback_apply_assist() reshaping the row moments after the
-- insert (it is SECURITY DEFINER but auth.uid() is still the owner). An
-- admin update is deliberately left alone, so a QA-found bug can still be
-- promoted onto the board by hand if it turns out the players want it.
-- ---------------------------------------------------------------------------
create or replace function public._feedback_qa_private()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_qa(new.user_id)
     and (tg_op = 'INSERT' or new.user_id = (select auth.uid()))
  then
    new.visibility := 'private';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_items_qa_private on public.feedback_items;

create trigger feedback_items_qa_private
  before insert or update on public.feedback_items
  for each row execute function public._feedback_qa_private();

-- Anything the tester filed before this migration.
update public.feedback_items
   set visibility = 'private'
 where visibility = 'board'
   and public.is_qa(user_id);

-- ---------------------------------------------------------------------------
-- feedback_board — 092's shape plus `hidden`, and the re-admit clause.
--
-- Dropped rather than replaced: the return type gains a column, and
-- Postgres will not replace a function's signature in place.
-- ---------------------------------------------------------------------------
drop function if exists public.feedback_board(text);

create function public.feedback_board(p_sort text default 'top')
returns table (
  id            uuid,
  user_id       uuid,
  title         text,
  body          text,
  type          text,
  status        text,
  qa            jsonb,
  vote_count    integer,
  created_at    timestamptz,
  author_name   text,
  author_avatar text,
  voted         boolean,
  attachments   jsonb,
  severity      text,
  environment   jsonb,
  hidden        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
  select
    i.id, i.user_id, i.title, i.body, i.type, i.status, i.qa,
    i.vote_count, i.created_at,
    split_part(coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      split_part(u.email::text, '@', 1),
      'Player'), ' ', 1) as author_name,
    coalesce(u.raw_user_meta_data ->> 'avatar_url',
             u.raw_user_meta_data ->> 'picture') as author_avatar,
    exists (select 1 from public.feedback_votes v
            where v.item_id = i.id and v.user_id = auth.uid()) as voted,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.attachments else '[]'::jsonb end as attachments,
    i.severity,
    case when i.user_id = auth.uid() or public.is_admin()
         then i.environment else null end as environment,
    i.visibility <> 'board' as hidden
  from public.feedback_items i
  join auth.users u on u.id = i.user_id
  where i.visibility = 'board'
     or (public.is_qa(i.user_id)
         and (i.user_id = auth.uid() or public.is_admin()))
  order by
    case when p_sort = 'top' then i.vote_count end desc,
    i.created_at desc
  limit 200;
end;
$$;

revoke all on function public.feedback_board(text) from public, anon;
grant execute on function public.feedback_board(text) to authenticated;

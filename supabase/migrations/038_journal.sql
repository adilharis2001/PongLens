-- 038: the Journal (Improve -> Journal restructure).
--
--  * lessons.kind — the lessons table becomes the journal's long-form
--    store: 'lesson' (coaching content, distills to takeaways) and
--    'practice' (the player's own journal entries: drills, reflections).
--    Same shape, same author-only RLS; kind picks the card style.
--  * focus_points — the pinned "Working on" list: 3-5 active cues,
--    retired (not deleted) when they become habit, so the retired set is
--    a quiet record of what got fixed.
--  * entry_tags — tags attach to journal entries as well as points, so a
--    tag search yields footage AND writing. Same owner-keyed vocabulary.

alter table public.lessons
  add column kind text not null default 'lesson'
  check (kind in ('lesson', 'practice'));

create table public.focus_points (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 1 and 120),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create index focus_points_user_idx on public.focus_points (user_id, created_at);

alter table public.focus_points enable row level security;
create policy "Authors manage own focus points"
  on public.focus_points for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.focus_points from anon;
grant select, insert, update, delete on public.focus_points to authenticated;

create table public.entry_tags (
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lesson_id, tag_id)
);
create index entry_tags_tag_id_idx on public.entry_tags (tag_id);

alter table public.entry_tags enable row level security;
-- Entries are private to their author, so entry tag rows are too; the tag
-- must come from the author's own vocabulary.
create policy "Authors manage own entry tags"
  on public.entry_tags for all
  to authenticated
  using (
    exists (
      select 1 from public.lessons l
      where l.id = entry_tags.lesson_id
        and l.user_id = (select auth.uid())
    )
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.lessons l
      where l.id = entry_tags.lesson_id
        and l.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tags t
      where t.id = entry_tags.tag_id
        and t.owner_id = (select auth.uid())
    )
  );
revoke all on public.entry_tags from anon;
grant select, insert, delete on public.entry_tags to authenticated;

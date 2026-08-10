-- 088: the backlog — the operator's own working list for the whole project.
--
-- Not a product feature and never will be. This is the one place where
-- "redo the OG image", "email the clubs in Dubai" and "fix the cut
-- anchoring" sit in the same list, because they compete for the same
-- evenings. It is the Journal's Working On card grown up: same idea (jot
-- it, tick it, keep what you ticked), sized for a project instead of
-- three cues.
--
-- Access is is_admin() and nothing else. No sharing, no assignment, no
-- collaborators, no comments. The moment a second person needs a row
-- here, this is the wrong table and the feature should be rebuilt as a
-- real one rather than have owners bolted on.

create table public.backlog_items (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references auth.users (id) on delete cascade,
  title      text not null
             check (char_length(btrim(title)) between 1 and 200),
  -- The free-text body: the paragraph that would otherwise be lost in a
  -- notes app. Empty by default — a captured idea is allowed to be one
  -- line, and asking for detail at capture time is how capture stops
  -- happening.
  notes      text not null default '',
  -- The kind of work, as typed. Free text on purpose: this list is
  -- marketing and outreach as much as it is code, and an enum would need
  -- a migration every time a new kind of work appears. The UI suggests
  -- what is already in use; it never restricts. '' = untagged.
  tag        text not null default '' check (char_length(tag) <= 40),
  -- Priority, not progress: what you would pick up if an evening opened.
  -- 'done' is a lane rather than a boolean so one column answers both
  -- "where does this render" and "is it finished".
  lane       text not null default 'next'
             check (lane in ('now', 'next', 'later', 'done')),
  -- When you mean to do it. Null = someday, and null is the default:
  -- a backlog that demands a date at capture time stops being the place
  -- ideas land. The timeline reads this column and only this column.
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at    timestamptz,
  -- done_at and the lane can never disagree. The trigger below maintains
  -- done_at, so this constraint is a guard on hand-edits, not a burden
  -- the client has to satisfy.
  constraint backlog_done_at_matches_lane
    check ((lane = 'done') = (done_at is not null))
);

comment on table public.backlog_items is
  'The admin''s project backlog. Personal, single-user by design; RLS is '
  'is_admin() plus authorship.';

-- The two reads the page makes: everything open (grouped by lane, then by
-- when), and the done pile newest first.
create index backlog_items_open_idx
  on public.backlog_items (author_id, lane, target_date nulls last, created_at desc)
  where lane <> 'done';
create index backlog_items_done_idx
  on public.backlog_items (author_id, done_at desc)
  where lane = 'done';

create trigger backlog_items_set_updated_at
  before update on public.backlog_items
  for each row execute function public.set_updated_at();

-- Stamp done_at from the lane so the client only ever writes one field.
-- Re-opening an item clears it; re-ticking an already-done item keeps the
-- original completion time rather than bumping it on an unrelated edit.
create or replace function public.backlog_stamp_done()
returns trigger
language plpgsql
as $$
begin
  if new.lane = 'done' and coalesce(old.lane, '') <> 'done' then
    new.done_at = now();
  elsif new.lane <> 'done' then
    new.done_at = null;
  end if;
  return new;
end;
$$;

create trigger backlog_items_stamp_done
  before insert or update of lane on public.backlog_items
  for each row execute function public.backlog_stamp_done();

-- ---------------------------------------------------------------------------
-- RLS: the admin, on their own rows. Both halves are required — authorship
-- alone would open the table to every signed-in account the moment a row
-- was written under another id, and is_admin() alone would let a future
-- second admin read this one's notebook.
-- ---------------------------------------------------------------------------
alter table public.backlog_items enable row level security;

create policy "Admin manages own backlog"
  on public.backlog_items for all
  to authenticated
  using (author_id = (select auth.uid()) and public.is_admin())
  with check (author_id = (select auth.uid()) and public.is_admin());

revoke all on public.backlog_items from anon;
grant select, insert, update, delete on public.backlog_items to authenticated;

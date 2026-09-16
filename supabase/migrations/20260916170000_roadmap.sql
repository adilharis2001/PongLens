-- The roadmap: what is planned, what is being built, what shipped.
--
-- Adil's call (2026-09-16): the board gets a Roadmap tab beside the
-- feedback, and a public page anyone can be sent. Visibility into what
-- is coming is part of why a player trusts a young product with their
-- footage. He keeps it by hand from /admin/roadmap, which replaces the
-- old /admin/backlog (a personal working list he no longer uses; its
-- tables stay, this is a new one).
--
-- Deliberately small. Three stages, a title, one sentence, an optional
-- date and link. No votes, no comments: those belong to the board, and a
-- roadmap entry may point at the board post it came from.
--
-- Readable by anyone, signed in or not — /roadmap is a public page.
-- Written by the admin only. is_admin() appears only in the write
-- policies, which anon never reaches (it holds no insert, update or
-- delete grant), so the "no is_admin() where anon is subject to it"
-- rule from migration 107 is respected.

create table if not exists public.roadmap_items (
  id               uuid primary key default gen_random_uuid(),
  title            text not null
                   check (char_length(btrim(title)) between 1 and 120),
  -- One sentence on what it means for a player.
  description      text not null default ''
                   check (char_length(description) <= 400),
  stage            text not null
                   check (stage in ('planned', 'building', 'shipped')),
  -- Order within a stage, smallest first.
  position         int not null default 0,
  -- Shipped entries carry when. Shown as month and year.
  shipped_at       date,
  -- Where to try it: an in-app path or a guide.
  link             text check (link is null or link ~ '^(/|https://)'),
  -- The board post this grew from, when there is one.
  feedback_item_id uuid references public.feedback_items (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists roadmap_items_stage_idx
  on public.roadmap_items (stage, position, created_at);

alter table public.roadmap_items enable row level security;

drop policy if exists "Anyone can read the roadmap" on public.roadmap_items;
create policy "Anyone can read the roadmap"
  on public.roadmap_items for select
  to anon, authenticated
  using (true);

drop policy if exists "Admin adds to the roadmap" on public.roadmap_items;
create policy "Admin adds to the roadmap"
  on public.roadmap_items for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admin updates the roadmap" on public.roadmap_items;
create policy "Admin updates the roadmap"
  on public.roadmap_items for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admin removes from the roadmap" on public.roadmap_items;
create policy "Admin removes from the roadmap"
  on public.roadmap_items for delete
  to authenticated
  using (public.is_admin());

grant select on public.roadmap_items to anon, authenticated;
grant insert, update, delete on public.roadmap_items to authenticated;

create or replace function public._roadmap_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists roadmap_items_touch on public.roadmap_items;
create trigger roadmap_items_touch
  before update on public.roadmap_items
  for each row execute function public._roadmap_touch();

-- ---------------------------------------------------------------------------
-- The first entries, as Adil gave them (2026-09-16), plus the major
-- features shipped over the last month. Dates are the month the feature
-- reached players; the roadmap shows month and year only.
-- ---------------------------------------------------------------------------
insert into public.roadmap_items (title, description, stage, position, shipped_at) values
  ('Cleaner point cuts',
   'Sharper detection of where each point ends, with the ball tosses between points trimmed out of the cut.',
   'building', 1, null),
  ('More match analysis cards',
   'Third-ball attack, rally win percentage, movement and rally speed, each as its own card in your match analysis.',
   'planned', 1, null),
  ('Automatic match scoring',
   'The score worked out from the video when a match is uploaded, so you no longer tap each point.',
   'planned', 2, null),
  ('Comment threads on the feedback board',
   'Reply under any post, see the maker''s answer pinned to it, and follow what is being built.',
   'shipped', 1, date '2026-09-16'),
  ('Match analysis deck',
   'Your scored match as one deck of cards on the match page, also on the coach view and share links.',
   'shipped', 2, date '2026-09-15'),
  ('Lesson video recaps',
   'Upload a video of a lesson and get a ten-minute recap of what the coach taught.',
   'shipped', 3, date '2026-09-08'),
  ('Instant clip edits',
   'Adjust, split or join points and the clip follows straight away, with the file catching up in the background.',
   'shipped', 4, date '2026-09-06'),
  ('Serve placement maps',
   'Where each serve landed, drawn on the table from your side.',
   'shipped', 5, date '2026-08-23'),
  ('Automatic highlights',
   'A highlights reel cut from your best rallies, with a version sized for Instagram.',
   'shipped', 6, date '2026-08-20');

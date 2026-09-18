-- Deleting the sample match removes it from YOUR library, nobody else's.
--
-- The sample is one shared row (20260918030000), so a real delete is out of
-- the question: it would take the demo away from every account at once, and
-- the delete policy refuses it anyway. This table is the per-account answer:
-- one row saying "this account is done with the sample". The apps read it
-- and stop showing the match; Account -> Support still links to it, which is
-- how somebody who deletes it by accident gets it back.
--
-- Nothing is removed from storage, and no other account notices.

create table if not exists public.sample_match_dismissals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now()
);

comment on table public.sample_match_dismissals is
  'One row per account that dismissed the sample match. Hides it for that account only.';

alter table public.sample_match_dismissals enable row level security;

drop policy if exists "Own dismissal is readable" on public.sample_match_dismissals;
create policy "Own dismissal is readable"
  on public.sample_match_dismissals
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Dismiss the sample for yourself" on public.sample_match_dismissals;
create policy "Dismiss the sample for yourself"
  on public.sample_match_dismissals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Undo your own dismissal" on public.sample_match_dismissals;
create policy "Undo your own dismissal"
  on public.sample_match_dismissals
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.sample_match_dismissals to authenticated;

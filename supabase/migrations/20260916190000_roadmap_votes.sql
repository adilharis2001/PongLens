-- Votes on the roadmap, and three more entries.
--
-- Adil's call (2026-09-16): players can vote up or down on what is in
-- development and what is planned, so the order of the roadmap can be
-- argued with. Shipped entries take no votes: there is nothing left to
-- decide about them, and a score under a finished feature reads as a
-- review rather than a request.
--
--  * roadmap_votes — one row per (entry, voter), value +1 or -1.
--  * roadmap_items.score — the sum, kept by trigger, readable by anyone
--    with the rest of the row (the public page shows it, read-only).
--  * roadmap_vote(entry, value) — the only write path. Pressing the same
--    arrow again clears the vote; pressing the other flips it. Refuses a
--    shipped entry.

alter table public.roadmap_items
  add column if not exists score int not null default 0;

comment on column public.roadmap_items.score is
  'Sum of roadmap_votes.value for this entry, kept by trigger. Meaningless once shipped.';

create table if not exists public.roadmap_votes (
  item_id    uuid not null references public.roadmap_items (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create index if not exists roadmap_votes_user_idx on public.roadmap_votes (user_id);

alter table public.roadmap_votes enable row level security;

-- You can see how you voted; nobody sees how anyone else did. The total
-- is on the entry.
drop policy if exists "Own roadmap votes" on public.roadmap_votes;
create policy "Own roadmap votes"
  on public.roadmap_votes for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.roadmap_votes from anon;
revoke insert, update, delete on public.roadmap_votes from authenticated;
grant select on public.roadmap_votes to authenticated;

-- Recomputed from the rows rather than nudged up and down, so the score
-- can never drift from the votes it summarises.
create or replace function public._roadmap_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid := coalesce(new.item_id, old.item_id);
begin
  update public.roadmap_items
     set score = (select coalesce(sum(v.value), 0)::int
                    from public.roadmap_votes v where v.item_id = v_item)
   where id = v_item;
  return null;
end;
$$;

drop trigger if exists roadmap_votes_score on public.roadmap_votes;
create trigger roadmap_votes_score
  after insert or update or delete on public.roadmap_votes
  for each row execute function public._roadmap_score();

-- ---------------------------------------------------------------------------
-- roadmap_vote — press up, press down, press again to take it back
-- ---------------------------------------------------------------------------
create or replace function public.roadmap_vote(p_item uuid, p_value int)
returns table (score int, my_vote int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_stage text;
  v_cur   int;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_value not in (-1, 0, 1) then
    raise exception 'vote must be -1, 0 or 1' using errcode = '23514';
  end if;

  select i.stage into v_stage from public.roadmap_items i where i.id = p_item;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;
  if v_stage = 'shipped' then
    raise exception 'shipped entries take no votes' using errcode = '42501';
  end if;

  select v.value into v_cur
    from public.roadmap_votes v
   where v.item_id = p_item and v.user_id = v_me;

  if p_value = 0 or v_cur = p_value then
    delete from public.roadmap_votes v
     where v.item_id = p_item and v.user_id = v_me;
  else
    insert into public.roadmap_votes (item_id, user_id, value)
    values (p_item, v_me, p_value)
    on conflict (item_id, user_id) do update set value = excluded.value;
  end if;

  return query
  select i.score,
         coalesce((select v.value::int from public.roadmap_votes v
                    where v.item_id = p_item and v.user_id = v_me), 0)
    from public.roadmap_items i
   where i.id = p_item;
end;
$$;

revoke all on function public.roadmap_vote(uuid, int) from public, anon;
grant execute on function public.roadmap_vote(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Three more entries, as Adil gave them (2026-09-16). The Android app is
-- last on purpose: lower priority, his words.
-- ---------------------------------------------------------------------------
insert into public.roadmap_items (title, description, stage, position) values
  ('Faster match processing',
   'Bringing the time it takes to process a match down from the 45 minutes it averages today.',
   'building', 2),
  ('App Store release',
   'PongLens on the App Store, so you can install it without TestFlight.',
   'planned', 3),
  ('Android app',
   'The same app for Android phones.',
   'planned', 4);

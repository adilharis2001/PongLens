-- 046: player profiles — who the player is at the table.
--
-- One row per user, created (possibly all-null) when onboarding is
-- completed or skipped; row PRESENCE is what tells the middleware not to
-- send the user through onboarding again. Fields are the sport's
-- standard vocabulary, all optional:
--
--   handedness  right | left            — feeds FH/BH labeling on the
--                                         user's half of placement maps
--   grip        shakehand | penhold
--   fh_rubber / bh_rubber               — rubber TYPE (the analytical
--               inverted | short_pips |   part; long pips or anti often
--               long_pips | anti          means a defensive game)
--   fh_rubber_name / bh_rubber_name     — optional free-text model
--   style       attacker | all_round | defender
--
-- Coaches get an all-null row automatically (they are here to review
-- someone else's matches); the same fields are editable later from
-- Account -> Player profile if they also play.
--
-- RLS: the owner, plus any ACCEPTED coach of the owner (a coach reads
-- the player's handedness to label their maps the right way around).

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handedness text check (handedness in ('right', 'left')),
  grip text check (grip in ('shakehand', 'penhold')),
  fh_rubber text
    check (fh_rubber in ('inverted', 'short_pips', 'long_pips', 'anti')),
  bh_rubber text
    check (bh_rubber in ('inverted', 'short_pips', 'long_pips', 'anti')),
  fh_rubber_name text check (char_length(fh_rubber_name) <= 80),
  bh_rubber_name text check (char_length(bh_rubber_name) <= 80),
  style text check (style in ('attacker', 'all_round', 'defender')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_profiles enable row level security;

create policy "Owners manage own profile"
  on public.player_profiles
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Accepted coaches can view player profiles"
  on public.player_profiles
  for select
  using (
    exists (
      select 1
      from public.coach_links cl
      where cl.coach_id = (select auth.uid())
        and cl.player_id = player_profiles.user_id
        and cl.status = 'accepted'
    )
  );

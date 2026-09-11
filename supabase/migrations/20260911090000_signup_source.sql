-- 2026-09-11: ask a new account how it found us, and keep the answer.
--
-- Nothing in the product has ever recorded where a signup came from. Coach
-- outreach, the club pages, the landing video and search all end at the same
-- undifferentiated /login, so the only honest answer to "is the outreach
-- working" has been a shrug.
--
-- Its own table rather than columns on player_profiles, for one reason that
-- matters: an accepted coach can SELECT their student's whole profile row
-- (046), and a student who answered "a coach" and typed somebody else's name
-- should not have that read back by the coach they are working with now. This
-- is business data, so the audience is the owner and the admin, and nobody
-- else.
--
--   source  one of the ten the apps offer. The list is written down once, in
--           ios/Tests/fixtures/signup-sources.json, and both apps are tested
--           against it — a value this check rejects would fail the write at
--           the end of onboarding, where there is nothing useful to say.
--   detail  the free half: a coach's name, a friend's name, which club, or
--           where "other" was. Optional, always: a blank name still tells us
--           a coach sent them, which is the part we act on.
--
-- Asked once, of accounts that arrive on their own. A coach who comes in
-- through a player's invite is never asked, because the invite already
-- answered the question.

create table if not exists public.signup_sources (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  source     text not null check (source in (
    'coach',      -- a coach told them
    'player',     -- a friend or another player
    'club',       -- their club or academy
    'search',     -- Google or another search engine
    'youtube',
    'instagram',
    'tiktok',
    'forum',      -- Reddit or a table tennis forum
    'event',      -- a tournament or an event
    'other'
  )),
  detail     text check (char_length(detail) <= 120),
  created_at timestamptz not null default now()
);

alter table public.signup_sources enable row level security;

-- The owner writes their own answer and can read it back. Update is allowed
-- so that an onboarding retried after a failed write lands on its feet rather
-- than colliding with the primary key; there is no screen that edits it.
create policy "Owners read their own signup source"
  on public.signup_sources for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners write their own signup source"
  on public.signup_sources for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners correct their own signup source"
  on public.signup_sources for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The whole point of collecting it. `to authenticated` on purpose: EXECUTE on
-- is_admin() is granted to authenticated and not to anon, so an anon-visible
-- policy calling it fails the read outright instead of returning false (107).
-- anon has no grant on this table at all, so anon never reaches a policy here.
create policy "Admin reads every signup source"
  on public.signup_sources for select to authenticated
  using (public.is_admin());

revoke all on public.signup_sources from anon, authenticated;
grant select, insert, update on public.signup_sources to authenticated;
grant all on public.signup_sources to service_role;

comment on table public.signup_sources is
  'How each account says it found PongLens, asked once during onboarding. '
  'One row per user; the answer list lives in '
  'ios/Tests/fixtures/signup-sources.json and is shared by both apps.';

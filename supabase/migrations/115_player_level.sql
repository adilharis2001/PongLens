-- 115 — ask a player what level they play at.
--
-- Deliberately not a rating. USATT points mean nothing to a player in
-- Europe or China, national ranking scales do not convert, and a number is
-- a wall in front of the beginner we most want to keep. These five are the
-- words players everywhere already use about themselves, and they are a
-- single tap.
--
-- Nullable and unconstrained-by-default in the sense that matters: an
-- account that skips onboarding, a coach who never answers, and every row
-- that already exists all stay valid. The check only stops a typo becoming
-- a sixth category.
--
-- It rides in with the onboarding trim (UP-17). The flow used to ask eight
-- questions before letting anyone near an upload, and the plan was to move
-- them all into a checklist — which Adil rightly killed: a left-hander who
-- never fills it in gets worse analysis forever, and a checklist item is
-- precisely the thing nobody completes. So the questions that change our
-- output (handedness, grip) stay in the flow, level joins them, and the
-- gear questions move to Account where they belong.

alter table public.player_profiles
  add column if not exists level text;

alter table public.player_profiles
  drop constraint if exists player_profiles_level_check;

alter table public.player_profiles
  add constraint player_profiles_level_check
  check (
    level is null
    or level in ('beginner', 'intermediate', 'advanced', 'advanced_pro', 'national')
  );

comment on column public.player_profiles.level is
  'Self-reported playing level. Deliberately words, not a rating: '
  'beginner | intermediate | advanced | advanced_pro | national.';

-- 143 — end an unscored point when the rally ends, not when a tap would.
--
-- points_v2.rally_end_ev has always computed two numbers. The padded one
-- becomes t1; the other — the last bounce on the user's own table inside
-- the rally's crossing chain — was used once to test whether the next
-- serve was a new point, and then discarded. The padding between them is
-- TAIL_AFTER_BOUNCE = 2.6s, and the comment above that constant says what
-- it is for: "His winner click lands 1.45s after the last table bounce."
--
-- The tail exists to catch a tap. A match nobody scores has no tap to
-- catch, and carries 2.6 seconds of ball-retrieval per point for nothing.
-- Measured over 423 points on six matches, trimming to the observed end
-- plus half a second takes retention from 79% to 66%.
--
-- Stored in CUT seconds, the clock playback runs on, so no reader has to
-- redo the conversion. The source-second twin lives in match.json; only
-- the cut one is needed here. Null wherever the ending was not observed —
-- a fallback card with no crossing chain, the first half of a split card,
-- an end-on match, any v1 point — because a missing ending must never be
-- read as an early one.
--
-- Full record: docs/superpowers/specs/2026-08-27-unscored-rally-end.md

alter table public.points
  add column if not exists rally_end_cut_s numeric;

comment on column public.points.rally_end_cut_s is
  'Cut-seconds position of the last observed moment of the rally: the last '
  'bounce on the user''s own table inside the point''s crossing chain. Null '
  'when no such bounce was seen. Worker-written, client-read — it is '
  'deliberately absent from the authenticated UPDATE grants. Used to end '
  'playback on UNSCORED points, where there is no winner tap to clamp to.';

-- Deliberately NO grant for authenticated UPDATE. Every column the client
-- writes needs one (see 129), and every column it must NOT write needs the
-- absence of one. This is measured by the worker and nothing else may move
-- it.

insert into public.app_config (key, value)
values
  -- The kill switch. Ships off: the column has to be backfilled and the
  -- buffer calibrated against hand-marked endings before anyone sees this.
  ('unscored_rally_end', 'off'),
  -- Seconds added to the observed ending before playback stops. Started
  -- at 0.5 to make the trims visibly aggressive for review; Adil watched
  -- them and called it too tight, so 1.25. Still a judgement from footage
  -- rather than a calibrated number - the spec's 60-point hand-marking is
  -- what would make it one. Changing it is one UPDATE and needs no
  -- deploy, which is the whole reason it is a config row and not a
  -- constant.
  ('unscored_rally_end_buffer_s', '1.25')
on conflict (key) do nothing;

-- The anon read allow-list, restated in full. 107 made app_config
-- allow-listed rather than blanket-readable, and 138 and 140 set the
-- mechanic: drop the policy, recreate it with every public key named.
-- There is no incremental form. Both new keys are read by the share page,
-- which serves anon, so both belong here.
--
-- The admin's own policy is separate and stays that way: EXECUTE on
-- is_admin() is granted to authenticated but not anon, so naming it in
-- this policy would fail every anonymous read outright with 42501 rather
-- than falling through to false.
drop policy if exists "Public app config is readable" on public.app_config;

create policy "Public app config is readable"
  on public.app_config for select
  to anon, authenticated
  using (key = any (array[
    'support_email',
    'commerce_enabled',
    'coach_reviews_enabled',
    'review_included_minutes',
    'review_fee_mode',
    'review_fee_percent',
    'review_fee_fixed_cents',
    'minute_packs',
    'storage_packs',
    'sponsored_packs',
    'sponsored_free_credits',
    'free_processing_minutes',
    'default_storage_bytes',
    'placement_serves_only',
    'instagram_sharing',
    'instagram_render',
    'tap_end_playback',
    'game_end_detection',
    'unscored_rally_end',
    'unscored_rally_end_buffer_s'
  ]));

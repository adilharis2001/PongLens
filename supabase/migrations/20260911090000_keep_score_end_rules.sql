-- Two end-of-playback rules, each behind its own switch.
--
-- 1. keep_score_full_card. In Keep score, a point that already carries a
--    winner tap plays its whole card instead of stopping half a second
--    after the tap. You tap a point, move on, realise later it should have
--    been split, and go back to its circle — and the trim built from your
--    own tap is now hiding the part you came back to look at. Every other
--    surface (watch, share, coach review, reels) keeps the tap trim: there
--    the tap is the answer, not a thing you are still deciding.
--
-- 2. rally_end_respects_card. The unscored rally trim stops cutting inside
--    the cushion the worker already left. The body assembler closes a card
--    1.5 s after it sees the ball go dead; playback then trimmed AGAIN to
--    the dead ball plus 0.4 s, taking about 1.47 s more off. Measured on
--    Julian (73 points) and Yu Yu Lin (86) on 2026-09-11. The two rules
--    were built from opposite ends and compounded: the flag that says "the
--    ball was clearly watched stopping" is set by the worker BECAUSE it
--    closed the card on the ball, so the signal meaning "already trimmed"
--    was being read as "safe to trim more".
--
-- Both default on, because both are corrections. Turning either off is one
-- update and needs no build.
insert into public.app_config (key, value)
values ('keep_score_full_card', 'on'),
       ('rally_end_respects_card', 'on')
on conflict (key) do nothing;

-- The allow-list, rebuilt from the LIVE policy plus the two new keys. It is
-- restated whole every time because it is an allow-list: a key absent from
-- it is admin-only, and the failure that way is a value missing from a page,
-- which someone sees. The other way it is a value on the public API.
drop policy if exists "Public app config is readable" on public.app_config;
create policy "Public app config is readable"
  on public.app_config for select
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
    'sponsored_reviews_enabled',
    'free_processing_minutes',
    'default_storage_bytes',
    'placement_serves_only',
    'instagram_sharing',
    'instagram_render',
    'iap_enabled',
    'device_reclip',
    'game_end_detection',
    'tap_end_playback',
    'unscored_rally_end',
    'unscored_rally_end_buffer_s',
    'unscored_rally_end_tight_buffer_s',
    'keep_score_full_card',
    'rally_end_respects_card'
  ]));

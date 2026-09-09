-- Two things, and the second is the one that matters.
--
-- 1. A rally we WATCHED stop can be cut harder than one we lost. Playback
--    keeps a fixed 1.75s after points.rally_end_cut_s on an unscored point,
--    which is protection against an end we are not sure of; where the ball
--    was tracked to its last shot that margin is just the players walking,
--    the one thing a freshly processed match is meant to have removed
--    (Adil, 2026-09-09). The app decides which a point is from evidence the
--    worker already writes (points.highlight_evidence: end_source,
--    connected_crossings, max_crossing_gap_s), so nothing is reprocessed and
--    every match ever cut is covered. Unset or unparseable reads as the wide
--    tail, never as zero: a failed fetch must not truncate a rally.
--
-- 2. FOUR PLAYBACK KEYS HAVE BEEN INVISIBLE SINCE 149. app_config is
--    allow-listed for anon reads (107) and the whole list is rewritten each
--    time, so a migration that forgets a key silently removes it. 140 added
--    game_end_detection and 143 added tap_end_playback, unscored_rally_end
--    and unscored_rally_end_buffer_s; 149_apple_iap recreated the policy
--    without any of them, and 170 and 20260906174708 copied that list
--    forward. `getConfigValue` reads with the anon key, so all four have
--    been returning null ever since and every reader has been falling back
--    to its default: tap-end trimming OFF, unscored rally-end trimming OFF,
--    game-end detection OFF -- while app_config has said 'on' for all three
--    and the admin page has shown them on.
--
--    Nothing failed loudly because every fallback is the pre-feature
--    behaviour. That is the trap in this table: a missing key looks exactly
--    like a switched-off feature.
--
--    The list below is taken from the LIVE policy, not from the last
--    migration file, because the file and the database had drifted.
insert into public.app_config (key, value)
values ('unscored_rally_end_tight_buffer_s', '0.4')
on conflict (key) do nothing;

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
    'sponsored_reviews_enabled',
    'free_processing_minutes',
    'default_storage_bytes',
    'placement_serves_only',
    'instagram_sharing',
    'instagram_render',
    'iap_enabled',
    'device_reclip',
    -- restored (140, 143), lost in 149
    'game_end_detection',
    'tap_end_playback',
    'unscored_rally_end',
    'unscored_rally_end_buffer_s',
    -- new
    'unscored_rally_end_tight_buffer_s'
  ]));

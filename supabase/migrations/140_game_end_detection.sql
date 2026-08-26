-- Game-end detection (side-change) indicator flag — 2026-08-26
--
-- One flag gates the whole feature, applied at READ time on both the
-- worker and the app (the 132 placement_serves_only pattern): the worker
-- checks it before running the post-ready side-change stage, and the
-- match page checks it before drawing the "Game end detected" divider.
-- Rollback is one UPDATE; nothing stored has to change.
--
-- The evidence itself lands in matches.match_structure (051), replacing
-- the retired RTMPose v1 artifacts (both stored v1 rows are status
-- 'failed' — the 2026-07-30 rollback's runtime errors, worthless). The
-- v2 stage NEVER touches first_server / first_server_source; the 051
-- user-authority rules are unaffected.
--
-- game_end_detection_config exists for threshold overrides (a JSON
-- object merged over worker/side_change.py DEFAULT_CONFIG) and stays
-- admin-only: it is tuning surface, not something a page renders.

insert into public.app_config (key, value)
values ('game_end_detection', 'off')
on conflict (key) do nothing;

-- The anon read allow-list is recreated WHOLE each time it changes
-- (the 107 rule: a key is private until listed). This list was copied
-- from the LIVE pg_policy on 2026-08-26 (matching 138), then
-- game_end_detection appended: the app reads the flag through the anon
-- PostgREST path in src/lib/config.ts, so it must be listed.
drop policy if exists "Public app config is readable" on public.app_config;
create policy "Public app config is readable"
  on public.app_config for select
  using (key in (
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
    'game_end_detection'
  ));

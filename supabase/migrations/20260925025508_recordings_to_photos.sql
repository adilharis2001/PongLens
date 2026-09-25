-- Recordings saved to Photos (spec 2026-09-24 hand cut on iPhone, section 6).
--
-- The iPhone app saves every finished in-app recording to the player's
-- Photos library when recording stops, independent of the upload. Today a
-- recording only reaches Photos when its upload fails for good. That
-- changes behaviour for everyone who records in the app, so it rolls out
-- behind one row:
--
--  * app_config.recordings_to_photos  'off' | 'admins' | 'on'
--      off     today's behaviour for everyone
--      admins  only accounts that pass public.hand_cut_enabled(auth.uid()),
--              which is the two admin accounts while hand_cut is 'off'
--      on      every account
--    Seeded 'admins'. An unreadable or unknown value reads as 'off' in the
--    app, so a build that cannot reach the config behaves like the build
--    before the flag existed.
--
-- The app composes 'admins' itself from the existing hand_cut_enabled RPC,
-- so the only thing the database needs is the value, on the public
-- allow-list so the app can read it as `authenticated`. The list below is
-- the live one (read from pg_policy on 2026-09-24, identical to
-- 20260915000000_consent_and_age.sql) plus the new key.
--
-- The same builds keep a working copy of the video on the phone for
-- accounts that can hand cut; that is local to the device and needs no
-- database change.

insert into public.app_config (key, value)
values ('recordings_to_photos', 'admins')
on conflict (key) do nothing;

drop policy if exists "Public app config is readable" on public.app_config;

create policy "Public app config is readable"
  on public.app_config for select
  using (
    key = any (array[
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
      'rally_end_respects_card',
      'purchases_enabled',
      'recollect_enabled',
      'terms_version',
      'ai_consent_version',
      'recordings_to_photos'
    ])
  );

-- 136 — two switches for Instagram sharing.
--
--  * instagram_sharing  'on' | 'off'
--      The kill switch the 135 spec called for and 135 did not ship. The
--      feature lives in a TestFlight build, so without this there is no way
--      to stop it misbehaving short of shipping another one.
--
--  * instagram_render   'server' | 'device'
--      Which renderer runs. Both exist in parallel: render_story in
--      worker.py, and StoryRenderer.swift on the phone. They take the same
--      crop window and draw the same bands, so the output should be
--      indistinguishable — the difference is where the work happens and
--      what it costs.
--
--      'server'  the Mac renders; ~5s end to end since the poll came down
--                to 2s, works on every phone identically, one
--                implementation of the artwork.
--      'device'  the phone renders; ~3-4s on recent silicon, an estimated
--                4-7s on an A13 (iPhone 11, the oldest chip iOS 26 runs
--                on), no queue, no dependency on the Mac being awake.
--
-- Server stays the default. On-device is the one that has never run on a
-- real handset, and this is how it gets tried without shipping a build to
-- find out.
--
-- Both keys join the 107 allow-list: the app reads them as `authenticated`
-- and a key absent from that list is admin-only, so without this the app
-- would read nothing and silently fall back.

insert into public.app_config (key, value) values
  ('instagram_sharing', 'on'),
  ('instagram_render', 'server')
on conflict (key) do nothing;

drop policy if exists "Public app config is readable" on public.app_config;

create policy "Public app config is readable"
  on public.app_config for select
  to anon, authenticated
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
      'free_processing_minutes',
      'default_storage_bytes',
      'placement_serves_only',
      'instagram_sharing',
      'instagram_render'
    ])
  );

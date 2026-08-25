-- 138: scored points end at the winner tap plus half a second.
--
-- scored_at_cut_s (067) is the playhead at the winner tap — the owner
-- saying "this point was decided by here", once per scored point. The
-- 2026-08-25 study measured what sits between that tap and the footage a
-- point currently keeps: median 1.4s per point, ~25% of a fully scored
-- match's cut video, almost all of it ball retrieval and walking
-- (docs/research/2026-08-25-tap-end-shave.md).
--
-- The rule itself lives in the clients and the reel route
-- (playhead.effectiveEnd / Playhead.effectiveEnd): a CLAMP,
-- min(padded end, tap + 0.5s), applied at read time. This key is its
-- kill switch. 'on' = tapped points end at the tap everywhere (watch
-- players, highlight picks, rendered exports); anything else = the
-- padded-end behavior exactly as before, on every surface at once, no
-- deploy. Exports self-heal on rollback too: the reel route re-derives
-- its manifest per request, so stored renders go stale and re-render
-- with whichever ends the flag dictates.
--
-- Allow-listed for anon (107 pattern): the clients read it with the anon
-- key, and it is a boolean about playback, not a secret. Remember the
-- rule that came with 107 — a key is private until named here.

insert into public.app_config (key, value)
values ('tap_end_playback', 'on')
on conflict (key) do nothing;

-- The one public-read policy, recreated with the new key. Copied from
-- the LIVE definition (pg_policy, 2026-08-25) rather than the last
-- migration file that touched it, per the live-drift rule.
drop policy if exists "Public app config is readable" on public.app_config;
create policy "Public app config is readable"
  on public.app_config for select to anon, authenticated
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
    'tap_end_playback'
  ]));

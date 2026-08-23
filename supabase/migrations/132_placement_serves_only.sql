-- 132 — the switch for serve-only placement maps.
--
-- Placement maps become serve placement maps: the Serves/Rally control
-- goes away, rally landings stop being drawn, and the trust rule behind
-- them is replaced with one built for serves. On a fully scored 98-point
-- match that moves the map from 12 points to 79.
--
-- Why a flag at all. The rule is applied at READ time, over placement
-- JSON that is already stored, so both settings work on every match ever
-- processed and nothing is rewritten either way. That makes rollback a
-- single UPDATE rather than a deploy, which is the right shape for a
-- change whose real test is whether the dots land where the ball did.
--
-- One key, not two. The trust rule and the UI narrowing have to move
-- together: titling the section "Serve placement" while the old rally
-- rule still decides which landings survive would put that heading over
-- twelve points, which is worse than either end state.
--
-- Public because the pages that render it are public. The share link at
-- /s/[token] draws these maps for anyone holding the URL and reads its
-- config with the anon key, so a key missing from 107's allow-list is a
-- share page silently falling back to the old behaviour while the
-- owner's own match page shows the new one. Nothing here is a secret;
-- it is a feature switch whose effect is visible on the page anyway.

insert into public.app_config (key, value)
values ('placement_serves_only', 'false')
on conflict (key) do nothing;

drop policy if exists "Public app config is readable" on public.app_config;

create policy "Public app config is readable"
  on public.app_config for select
  to anon, authenticated
  using (
    key in (
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
      'placement_serves_only'
    )
  );

-- 170 — sponsored reviews go behind a flag, and the flag starts off.
--
-- Adil, 2026-09-04: "it's a little complicated, hard to understand, and
-- not well thought out, so let's just disable that feature and hide that
-- row." The coach covering a review for their own student (096) never
-- explained itself on the Orders page and nobody used it.
--
-- A flag rather than a deletion, because nothing about the idea is wrong
-- enough to throw away the ledger, the packs and the single-use links
-- that already exist. One UPDATE brings it back, and the same key gates
-- the row on the web, the row on the phone and the page itself — so
-- there is no state where the row is hidden and the page still answers.
--
-- It goes in the PUBLIC read list (107) because the two clients read it
-- to decide whether to draw a row. It is a feature switch, not a secret;
-- what it must never do is default to on when the read fails, which is
-- why both callers compare against the literal 'true'.

insert into public.app_config (key, value)
values ('sponsored_reviews_enabled', 'false')
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
      'iap_enabled'
    ])
  );

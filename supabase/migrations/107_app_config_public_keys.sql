-- 107 — stop app_config handing the whole settings table to the internet.
--
-- app_config has been readable by anon since 014, on the reasoning that
-- every value in it was non-secret. That was true of the row the policy
-- was written for (support_email, which is printed in the footer anyway)
-- and stopped being true as the table grew. `digest_recipient` holds a
-- personal address, and the anon key is compiled into the client bundle,
-- so the row was one request away for anyone who opened the site:
--
--   curl "$SUPABASE_URL/rest/v1/app_config?select=key,value" -H "apikey: <anon>"
--
-- Nothing was misconfigured; the policy simply outlived its premise. So
-- the fix is an allow-list rather than a tighter predicate on the same
-- idea: a key is public only when a page actually renders it, and a new
-- key added next month is private until someone says otherwise. The
-- failure mode of an allow-list is a value that does not appear on a
-- page, which is visible the moment you look. The failure mode of a
-- deny-list is a value that quietly ships to the public API, which is
-- exactly what happened here.
--
-- The list is every key read through src/lib/config.ts (which fetches with
-- the anon key so the static pages stay static) plus sponsored_free_credits,
-- which ordinary coaches read on /coaching and /coaching/sponsored.
--
-- Deliberately NOT public: digest_recipient, digest_last_sent,
-- qa_closed_digest_last_sent, admin_payments_test and the journal_ask_*
-- rate-limit values. Those are read by the worker over DATABASE_URL and by
-- claim_journal_ask(), which is SECURITY DEFINER — both bypass RLS, so
-- restricting them here costs nothing at runtime.
--
-- The admin still needs the whole table, because the /admin screens read
-- and write these rows through the cookie-bound client as `authenticated`.
-- That is a SECOND policy rather than an `or public.is_admin()` on the
-- first, and the difference is not cosmetic: EXECUTE on is_admin() is
-- granted to authenticated but not to anon, so a single policy mentioning
-- it makes every anonymous read fail outright with
--
--   42501: permission denied for function is_admin
--
-- which is worse than the leak it replaces — getCommerceEnabled() would
-- read false and quietly strip the pricing off the public pages. Splitting
-- them means anon is only ever matched against the key list and never
-- reaches the function. Permissive policies are OR'd, so the admin still
-- sees everything.

drop policy if exists "Anyone can read app config" on public.app_config;

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
      'default_storage_bytes'
    )
  );

create policy "Admin reads all app config"
  on public.app_config for select
  to authenticated
  using (public.is_admin());

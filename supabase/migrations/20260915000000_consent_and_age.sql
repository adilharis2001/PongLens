-- Consent, age and kill switches (spec: docs/superpowers/specs/2026-09-14-minors-consent-and-flags-design.md)
--
-- 1. Terms acceptance, AI-features permission and the first-upload
--    confirmation live on player_profiles. Every account has that row
--    (coaches get an unstamped one), and none of these values is sensitive
--    if an accepted coach can read the row.
-- 2. Birth month and year live in their own owner-only table so the coach
--    SELECT policy on player_profiles (046) never exposes them.
-- 3. Existing rows are backfilled as accepted: the onboarding screen and the
--    upload confirmation are for new accounts only. AI permission is not
--    backfilled; that sheet shows once for everyone (App Review 5.1.2(i)).
-- 4. app_config gains the Recollect kill switch and the document versions.
--    The public allow-list is recreated as the union of the newest list on
--    main (20260911090000_keep_score_end_rules.sql), purchases_enabled, and
--    the three keys above.

alter table public.player_profiles
  add column if not exists terms_accepted_at   timestamptz,
  add column if not exists terms_version       text,
  add column if not exists ai_features_enabled boolean,
  add column if not exists ai_consent_at       timestamptz,
  add column if not exists ai_consent_version  text,
  add column if not exists upload_confirmed_at timestamptz;

update public.player_profiles
   set terms_accepted_at   = coalesce(terms_accepted_at, created_at),
       terms_version       = coalesce(terms_version, 'legacy'),
       upload_confirmed_at = coalesce(upload_confirmed_at, created_at)
 where terms_accepted_at is null
    or upload_confirmed_at is null;

create table if not exists public.player_birthdates (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  birth_year  smallint not null check (birth_year between 1900 and 2100),
  birth_month smallint not null check (birth_month between 1 and 12),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.player_birthdates enable row level security;

drop policy if exists "Owners manage own birthdate" on public.player_birthdates;
create policy "Owners manage own birthdate"
  on public.player_birthdates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.player_birthdates to authenticated;

insert into public.app_config (key, value)
values
  ('recollect_enabled',  'false'),
  ('terms_version',      '2026-09-14'),
  ('ai_consent_version', '2026-09-14')
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
      'ai_consent_version'
    ])
  );

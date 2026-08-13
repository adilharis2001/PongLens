-- 105: country, region and what kind of thing a coach row is.
--
-- The list is only useful if it can answer "can this person actually be
-- paid". Stripe fixes a Connect account's country at creation and it cannot
-- be changed afterwards, so a coach in an unsupported country is not a slow
-- lead, they are a dead one. That question deserves to be a column rather
-- than something a person works out per row.
--
-- region and payments_supported are GENERATED from country so there is one
-- source of truth and no way for them to drift. The enrichment agent writes
-- country and nothing else; Postgres derives the rest.
--
-- Also here: entity_type. Roughly half the discovered rows are clubs or
-- academies rather than people, and the two want different outreach. It is
-- not inferable from follower count (the medians came out at 361 for clubs
-- and 558 for coaches, which is noise), so it comes from the name and bio.

-- ---------------------------------------------------------------------------
-- Which countries Stripe Connect can actually pay.
--
-- Deliberately a conservative allow-list: anything not named is treated as
-- unsupported, so a new country has to be added on purpose rather than
-- assumed. India is excluded on purpose even though Stripe operates there,
-- because cross-border payouts to Indian connected accounts are restricted
-- and the academies we keep finding there cannot be paid today.
--
-- This mirrors Stripe's published availability as understood on 2026-08-13.
-- Check it against their current list before treating it as commercial
-- truth; it is here to steer outreach, not to authorise a payout.
-- ---------------------------------------------------------------------------
create or replace function public.stripe_connect_supported(p_country text)
returns boolean
language sql immutable
as $$
  select upper(coalesce(p_country, '')) in (
    -- North America
    'US', 'CA',
    -- Europe (EU, EEA, UK, Switzerland)
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT',
    'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'GB',
    -- Asia Pacific and elsewhere Stripe Connect covers
    'AU', 'NZ', 'JP', 'SG', 'HK', 'MY', 'TH', 'AE', 'MX', 'BR'
  );
$$;

create or replace function public.outreach_region(p_country text)
returns text
language sql immutable
as $$
  select case
    when upper(coalesce(p_country, '')) = '' then 'unknown'
    when upper(p_country) in ('US') then 'us'
    when upper(p_country) in (
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
      'HU', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT',
      'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'GB', 'IS', 'RS', 'UA', 'TR'
    ) then 'europe'
    else 'other'
  end;
$$;

-- ---------------------------------------------------------------------------
-- The new columns
-- ---------------------------------------------------------------------------
alter table public.outreach_coaches
  add column entity_type text not null default 'unknown'
    check (entity_type in ('coach', 'club', 'unknown')),
  -- How the country was decided, so a wrong one can be traced back rather
  -- than argued about. 'flag' is a regional-indicator pair in the bio and is
  -- as close to certain as this gets; 'model' is the enrichment pass.
  add column country_source text
    check (country_source in ('flag', 'tld', 'phone', 'place', 'model')),
  add column country_confidence real
    check (country_confidence >= 0 and country_confidence <= 1),
  add column enriched_at timestamptz,
  add column region text generated always as
    (public.outreach_region(country)) stored,
  add column payments_supported boolean generated always as
    (public.stripe_connect_supported(country)) stored;

create index outreach_coaches_targeting_idx
  on public.outreach_coaches (region, payments_supported, entity_type, followers desc);

comment on column public.outreach_coaches.payments_supported is
  'Derived from country. False means a Connect account cannot be opened for
   them today, so a reply cannot turn into a paid coach however good it is.';

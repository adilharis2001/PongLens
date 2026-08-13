-- 107: a coach says where they are before Stripe opens their account.
--
-- createConnectAccount hardcoded country: "US", so the platform could only
-- ever onboard American coaches. Stripe fixes an Express account's country
-- at creation and it can never be changed, which makes this worse than a
-- default: a German coach who signed up got a US account and would have
-- failed verification with no way back except a new account.
--
-- So the country is asked once, before anything is created, and frozen the
-- moment an account exists. The trigger is the part that matters: without
-- it, an edit to this column would silently disagree with what Stripe
-- holds, and the disagreement would only surface at payout.

alter table public.coach_profiles
  add column payout_country text
  check (payout_country is null or public.stripe_connect_supported(payout_country));

-- Every account that exists today was created with country: "US". That is
-- a fact about Stripe's records, not a guess, so it is written down rather
-- than left null and re-derived wrongly later.
update public.coach_profiles
   set payout_country = 'US'
 where stripe_account_id is not null;

create or replace function public.coach_payout_country_is_frozen()
returns trigger
language plpgsql
as $$
begin
  if old.stripe_account_id is not null
     and new.payout_country is distinct from old.payout_country then
    raise exception
      'payout country cannot change once a Stripe account exists'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger coach_profiles_freeze_payout_country
  before update on public.coach_profiles
  for each row execute function public.coach_payout_country_is_frozen();

comment on column public.coach_profiles.payout_country is
  'ISO country for the Stripe Connect account. Set before the account is
   created and immutable afterwards, because Stripe cannot change it.';

-- UPDATE on coach_profiles is column-scoped for `authenticated`, so a new
-- client-written column is invisible to the grant and PostgREST answers 403
-- with no row changed. The picker looked like it saved and did not.
grant update (payout_country) on public.coach_profiles to authenticated;

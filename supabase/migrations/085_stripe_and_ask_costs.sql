-- 085: the money the platform spends that the dashboard could not see.
--
-- Three gaps, one migration.
--
-- 1. STRIPE. Coach reviews run on direct charges against the coach's
--    Express account, and the account is created with
--    controller.fees.payer = 'application' (stripeGateway.ts) — Stripe
--    requires that pairing for the Express dashboard. So card processing,
--    the payout fee and the monthly active-account fee all come out of
--    OUR application fee, not the coach's balance. None of it was metered.
--
--    Stripe reports the exact fee on every balance transaction, so nothing
--    here is estimated: the app records the cents Stripe actually took and
--    this rate converts them. A percentage baked into a rate row would go
--    stale the first time an international card or an Amex turns up.
--
-- 2. gpt-5.6-luna has no rate. The coach write-up tools (084) already meter
--    against it, so that usage has been landing in the dashboard's unmapped
--    bucket reading $0 since it shipped. Ask-your-journal will use the same
--    model, so this covers it the day it ships.
--
-- 3. A money-denominated unit. The vocabulary had no way to say "the vendor
--    took this many cents", which is why a fee could not be expressed at
--    all. usd_cent priced at $0.01 flows through the existing rating engine
--    untouched, and an unpriced fee still surfaces as unmapped rather than
--    silently costing nothing.

-- ---------------------------------------------------------------------------
-- The unit vocabulary, in both places that enumerate it
-- ---------------------------------------------------------------------------
alter table public.cost_usage_events
  drop constraint if exists cost_usage_events_unit_check;

alter table public.cost_usage_events
  add constraint cost_usage_events_unit_check check (unit in (
    'input_token',
    'cached_input_token',
    'output_token',
    'audio_second',
    'gb_month',
    'storage_byte_snapshot',
    'class_a_operation',
    'class_b_operation',
    'email_recipient',
    'compute_second',
    'request',
    'monthly_subscription',
    'usd_cent'
  ));

create or replace function public.record_cost_usage(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 100 then
    raise exception 'events must be an array of at most 100 rows'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_events) x
    where jsonb_typeof(x) <> 'object'
       or coalesce(x->>'provider', '') = ''
       or coalesce(x->>'service', '') = ''
       or coalesce(x->>'operation', '') = ''
       or coalesce(x->>'sku', '') = ''
       or coalesce(x->>'idempotency_key', '') = ''
       or coalesce(x->>'unit', '') not in (
         'input_token', 'cached_input_token', 'output_token',
         'audio_second', 'gb_month', 'storage_byte_snapshot',
         'class_a_operation', 'class_b_operation', 'email_recipient',
         'compute_second', 'request', 'monthly_subscription',
         'usd_cent'
       )
       or coalesce(x->>'source', 'internal') not in (
         'internal', 'provider', 'backfill', 'assumed'
       )
       or (x->>'quantity')::numeric < 0
       or exists (
         select 1
         from jsonb_object_keys(coalesce(x->'metadata', '{}'::jsonb)) k
         where k not in (
           'confidence', 'storage_class', 'stage', 'request_count',
           'cached_tokens', 'status', 'billing_mode'
         )
       )
  ) then
    raise exception 'invalid cost usage event' using errcode = '22023';
  end if;

  insert into public.cost_usage_events (
    occurred_at,
    provider,
    service,
    operation,
    sku,
    quantity,
    unit,
    source,
    idempotency_key,
    metadata
  )
  select
    coalesce((x->>'occurred_at')::timestamptz, now()),
    left(x->>'provider', 80),
    left(x->>'service', 100),
    left(x->>'operation', 120),
    left(x->>'sku', 120),
    (x->>'quantity')::numeric,
    x->>'unit',
    coalesce(x->>'source', 'internal'),
    left(x->>'idempotency_key', 240),
    coalesce(x->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_events) x
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.record_cost_usage(jsonb) from public;
grant execute on function public.record_cost_usage(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Rates
-- ---------------------------------------------------------------------------
-- Stripe: the identity rate. Quantity is the cent count Stripe reported on
-- the balance transaction, so the "price" is only the unit conversion and
-- can never drift from what was actually charged.
--
-- gpt-5.6-luna: list price after the 2026-07-30 cut. The interval starts on
-- the cut date rather than reaching back — the write-up tools shipped
-- 2026-08-08, so no Luna usage predates it, and inventing a pre-cut rate
-- would price nothing. Long-prompt surcharge (>272K input tokens bills 2x
-- input / 1.5x output) is not modelled: the ask corpus is ~21k tokens at
-- its heaviest, two orders of magnitude below the threshold. Revisit that
-- if a corpus tier ever lifts.
insert into public.cost_rates (
  provider, service, sku, unit, price_per_unit_usd, included_units,
  effective_from, source_url, source_label
) values
  ('Stripe', 'Payments', 'stripe-fee', 'usd_cent',
   0.01, 0, '2026-01-01T00:00:00Z',
   'https://stripe.com/connect/pricing',
   'Fee reported by Stripe per balance transaction; rate is the cent-to-USD conversion'),
  ('OpenAI', 'AI', 'gpt-5.6-luna', 'input_token',
   0.0000002, 0, '2026-07-30T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
   'OpenAI GPT-5.6 Luna pricing, verified 2026-08-08'),
  ('OpenAI', 'AI', 'gpt-5.6-luna', 'cached_input_token',
   0.00000002, 0, '2026-07-30T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
   'OpenAI GPT-5.6 Luna pricing, verified 2026-08-08'),
  ('OpenAI', 'AI', 'gpt-5.6-luna', 'output_token',
   0.0000012, 0, '2026-07-30T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
   'OpenAI GPT-5.6 Luna pricing, verified 2026-08-08')
on conflict (provider, service, sku, unit, effective_from)
do update set
  price_per_unit_usd = excluded.price_per_unit_usd,
  included_units = excluded.included_units,
  source_url = excluded.source_url,
  source_label = excluded.source_label;

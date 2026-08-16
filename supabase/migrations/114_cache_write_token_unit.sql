-- Cache writes are a billing dimension the meter could not name.
--
-- OpenAI bills a GPT-5.6 prompt that misses the cache at 1.25x standard
-- input, on a separate "cache writes" line. The meter only ever emitted
-- input_token / cached_input_token / output_token, so that line had nowhere
-- to land and the ledger quietly recorded the 1.00x price instead.
--
-- It is not a rounding error. Measured against the OpenAI organization
-- billing API for 2026-08-01..16:
--
--   gpt-5.6-sol   cache writes $4.655   plain input $0.008
--   gpt-5.6-luna  cache writes $0.122   plain input $0.007
--
-- Cache writes were 30% of all gpt-5.6-sol spend in the period, and almost
-- every uncached input token was billed as one — the placement vision stage
-- sends the same large image prompt three times in a row, so the first trial
-- writes the cache and the other two read it.
--
-- Only the 5.6 family carries the 1.25x write premium. gpt-5-mini and
-- gpt-5-nano discount cached reads without charging extra for the write, so
-- they get no rate here and the meter must keep pricing them as plain input.

alter table public.cost_usage_events
  drop constraint cost_usage_events_unit_check;

alter table public.cost_usage_events
  add constraint cost_usage_events_unit_check check (
    unit = any (array[
      'input_token',
      'cached_input_token',
      'cache_write_token',
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
    ])
  );

-- The RPC keeps its own copy of the vocabulary, and it is the one that
-- actually decides. A unit the table accepts but the RPC does not raises
-- 22023, and CostMeter.record swallows that by design so metering can never
-- fail a job — so the whole batch would vanish and the fix would read as
-- working. Both lists move together or neither does.
create or replace function public.record_cost_usage(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inserted integer;
begin
  perform public.cost_rpc_requires_service_role();
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
         'input_token', 'cached_input_token', 'cache_write_token',
         'output_token',
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
$function$;

-- 1.25x the input rate each row already carries. effective_from matches the
-- input rate it derives from so a repriced model does not leave the write
-- rate behind: 052 set sol's input rate from 2026-07-01, and 085 set luna's
-- from the 2026-07-30 price cut.
insert into public.cost_rates
  (provider, service, sku, unit, price_per_unit_usd, effective_from,
   source_url, source_label)
values
  ('OpenAI', 'AI', 'gpt-5.6-sol', 'cache_write_token',
   0.00000625, '2026-07-01',
   'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
   'OpenAI pricing: $5.00/1M input, cache writes 1.25x'),
  ('OpenAI', 'AI', 'gpt-5.6-luna', 'cache_write_token',
   0.00000025, '2026-07-30',
   'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
   'OpenAI pricing: $0.20/1M input, cache writes 1.25x');

-- 086: close the service-role guard on the cost RPCs.
--
-- Found while verifying 085 against production. The guard written in 050
-- and reused in 055 cannot fire:
--
--   if coalesce(auth.role(), '') <> 'service_role'
--      and current_user not in ('postgres', 'service_role') then
--     raise exception 'service role required';
--
-- These are SECURITY DEFINER functions owned by postgres, so INSIDE them
-- current_user is always 'postgres' — that is what SECURITY DEFINER does.
-- The second clause is therefore always false, the AND is always false,
-- and the exception never raises for any caller.
--
-- On its own that would be harmless if nobody could reach the functions.
-- But `revoke all ... from public` (also in 050) revokes the PUBLIC
-- pseudo-role, which is not the same thing as the `anon` and
-- `authenticated` roles Supabase grants EXECUTE to by default. Both roles
-- kept EXECUTE. Verified in production: a caller with no service-role
-- credentials inserted a row into cost_usage_events, and it was removed.
--
-- Nothing here is user data or money movement — the exposure is that
-- anyone could write junk into the platform's own cost telemetry, which
-- makes the dashboard's numbers unreliable exactly where the point of it
-- is that they are reliable.
--
-- Fixed in two layers, because either alone would do and both is cheap:
--
--   1. Take EXECUTE away from anon and authenticated by name, so the
--      functions are unreachable from a browser session at all.
--   2. Rewrite the guard around the only signal that actually
--      distinguishes callers here: auth.role(), which reads the request
--      JWT. A PostgREST request always has one; a direct Postgres
--      connection never does.
--
-- Both real callers keep working, and both were checked before this ran:
--   web app  — PostgREST with the service-role key -> auth.role() =
--              'service_role' -> allowed.
--   worker   — psycopg2 over a direct connection (cost_meter.py,
--              cost_alerts.py) -> auth.role() is null -> allowed.
-- A browser session -> auth.role() = 'anon' | 'authenticated' -> refused.

create or replace function public.cost_rpc_requires_service_role()
returns void
language plpgsql
stable
set search_path = public, auth
as $$
begin
  -- Null means no JWT, which means a direct database connection: the
  -- worker and migrations. A present-but-wrong role is a browser caller.
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.cost_rpc_requires_service_role() from public;
revoke all on function public.cost_rpc_requires_service_role()
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_cost_usage — guard swapped, body otherwise identical to 085
-- ---------------------------------------------------------------------------
create or replace function public.record_cost_usage(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

-- ---------------------------------------------------------------------------
-- Reachability: the layer that does not depend on the body being right
-- ---------------------------------------------------------------------------
revoke all on function public.record_cost_usage(jsonb) from public;
revoke all on function public.record_cost_usage(jsonb) from anon, authenticated;
grant execute on function public.record_cost_usage(jsonb) to service_role;

revoke all on function public.claim_platform_cost_alert(numeric, timestamptz)
  from anon, authenticated;
revoke all on function public.complete_platform_cost_alert(uuid, boolean, text)
  from anon, authenticated;

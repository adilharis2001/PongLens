-- The writers for everything the previous migration added: the meter now
-- carries a subject, and the fixed and one-time cost tables finally get
-- RPCs with a caller. The fixed-item RPC has existed since the cost
-- dashboard shipped and was never wired to anything, which is the whole
-- reason that table has been empty and every predictable cost has read
-- as zero.

--------------------------------------------------------------------
-- 1. The meter accepts a subject.
--------------------------------------------------------------------

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
    metadata,
    subject_user_id
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
    coalesce(x->'metadata', '{}'::jsonb),
    -- A malformed subject loses the attribution, never the cost. The
    -- meter is best-effort by design and must not be able to reject a
    -- real charge over a bad uuid.
    case
      when x->>'subject_user_id' ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (x->>'subject_user_id')::uuid
      else null
    end
  from jsonb_array_elements(p_events) x
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function public.record_cost_usage(jsonb) from public;
grant execute on function public.record_cost_usage(jsonb)
  to service_role, ponglens_worker;

--------------------------------------------------------------------
-- 2. Writing fixed and one-time costs.
--------------------------------------------------------------------

drop function if exists public.admin_upsert_cost_fixed_item(
  text, text, numeric, date, date, boolean, uuid);

create or replace function public.admin_upsert_cost_fixed_item(
  p_provider text,
  p_label text,
  p_amount_usd numeric,
  p_effective_from date,
  p_recurrence text default 'monthly',
  p_category text default 'run',
  p_effective_to date default null,
  p_enabled boolean default true,
  p_note text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if length(trim(p_provider)) not between 1 and 80
     or length(trim(p_label)) not between 1 and 160
     or p_amount_usd is null or p_amount_usd < 0
     or p_recurrence not in ('monthly', 'annual')
     or p_category not in ('run', 'build')
     or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'invalid fixed cost item' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.cost_fixed_items (
      provider, label, amount_usd, recurrence, category,
      effective_from, effective_to, enabled, note
    ) values (
      trim(p_provider), trim(p_label), p_amount_usd, p_recurrence, p_category,
      p_effective_from, p_effective_to, p_enabled, nullif(trim(p_note), '')
    )
    returning id into v_id;
  else
    update public.cost_fixed_items
    set provider = trim(p_provider),
        label = trim(p_label),
        amount_usd = p_amount_usd,
        recurrence = p_recurrence,
        category = p_category,
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        enabled = p_enabled,
        note = nullif(trim(p_note), ''),
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'fixed cost item not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$function$;

create or replace function public.admin_delete_cost_fixed_item(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.cost_fixed_items where id = p_id;
  return found;
end;
$function$;

create or replace function public.admin_upsert_cost_one_time_item(
  p_provider text,
  p_label text,
  p_amount_usd numeric,
  p_incurred_on date,
  p_category text default 'build',
  p_note text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if length(trim(p_provider)) not between 1 and 80
     or length(trim(p_label)) not between 1 and 160
     or p_amount_usd is null or p_amount_usd < 0
     or p_category not in ('run', 'build')
     or p_incurred_on is null then
    raise exception 'invalid one-time cost item' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.cost_one_time_items (
      provider, label, amount_usd, incurred_on, category, note
    ) values (
      trim(p_provider), trim(p_label), p_amount_usd, p_incurred_on,
      p_category, nullif(trim(p_note), '')
    )
    returning id into v_id;
  else
    update public.cost_one_time_items
    set provider = trim(p_provider),
        label = trim(p_label),
        amount_usd = p_amount_usd,
        incurred_on = p_incurred_on,
        category = p_category,
        note = nullif(trim(p_note), ''),
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'one-time cost item not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$function$;

create or replace function public.admin_delete_cost_one_time_item(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.cost_one_time_items where id = p_id;
  return found;
end;
$function$;

revoke all on function public.admin_upsert_cost_fixed_item(
  text, text, numeric, date, text, text, date, boolean, text, uuid) from public;
grant execute on function public.admin_upsert_cost_fixed_item(
  text, text, numeric, date, text, text, date, boolean, text, uuid)
  to anon, authenticated, service_role;

revoke all on function public.admin_delete_cost_fixed_item(uuid) from public;
grant execute on function public.admin_delete_cost_fixed_item(uuid)
  to anon, authenticated, service_role;

revoke all on function public.admin_upsert_cost_one_time_item(
  text, text, numeric, date, text, text, uuid) from public;
grant execute on function public.admin_upsert_cost_one_time_item(
  text, text, numeric, date, text, text, uuid)
  to anon, authenticated, service_role;

revoke all on function public.admin_delete_cost_one_time_item(uuid) from public;
grant execute on function public.admin_delete_cost_one_time_item(uuid)
  to anon, authenticated, service_role;

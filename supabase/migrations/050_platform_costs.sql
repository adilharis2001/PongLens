-- Platform-wide cost accounting. All underlying rows are private; the owner
-- receives aggregates only through get_platform_cost_dashboard().

create table public.cost_usage_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  provider text not null check (length(provider) between 1 and 80),
  service text not null check (length(service) between 1 and 100),
  operation text not null check (length(operation) between 1 and 120),
  sku text not null check (length(sku) between 1 and 120),
  quantity numeric not null check (quantity >= 0),
  unit text not null check (unit in (
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
    'monthly_subscription'
  )),
  source text not null default 'internal'
    check (source in ('internal', 'provider', 'backfill', 'assumed')),
  idempotency_key text not null unique
    check (length(idempotency_key) between 1 and 240),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index cost_usage_events_occurred_idx
  on public.cost_usage_events (occurred_at);
create index cost_usage_events_vendor_idx
  on public.cost_usage_events (provider, service, sku, unit, occurred_at);

create table public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(provider) between 1 and 80),
  service text not null check (length(service) between 1 and 100),
  sku text not null check (length(sku) between 1 and 120),
  unit text not null,
  price_per_unit_usd numeric not null check (price_per_unit_usd >= 0),
  included_units numeric not null default 0 check (included_units >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  source_url text not null,
  source_label text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  unique (provider, service, sku, unit, effective_from)
);

create table public.cost_fixed_items (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(provider) between 1 and 80),
  label text not null check (length(label) between 1 and 160),
  monthly_cost_usd numeric not null check (monthly_cost_usd >= 0),
  effective_from date not null,
  effective_to date,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.cost_provider_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(provider) between 1 and 80),
  period_start timestamptz not null,
  period_end timestamptz not null,
  reported_cost_usd numeric check (reported_cost_usd >= 0),
  usage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage) = 'object'),
  status text not null check (status in ('success', 'error')),
  error_code text,
  fetched_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (provider, period_start, period_end)
);

alter table public.cost_usage_events enable row level security;
alter table public.cost_rates enable row level security;
alter table public.cost_fixed_items enable row level security;
alter table public.cost_provider_snapshots enable row level security;

revoke all on public.cost_usage_events from anon, authenticated;
revoke all on public.cost_rates from anon, authenticated;
revoke all on public.cost_fixed_items from anon, authenticated;
revoke all on public.cost_provider_snapshots from anon, authenticated;

-- Keep one active rate interval per billing dimension. A trigger avoids
-- requiring btree_gist in hosted projects.
create or replace function public.cost_rate_reject_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.cost_rates r
    where r.provider = new.provider
      and r.service = new.service
      and r.sku = new.sku
      and r.unit = new.unit
      and r.id <> new.id
      and tstzrange(
        r.effective_from,
        coalesce(r.effective_to, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        new.effective_from,
        coalesce(new.effective_to, 'infinity'::timestamptz),
        '[)'
      )
  ) then
    raise exception 'cost rate interval overlaps an existing rate'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger cost_rates_no_overlap
before insert or update on public.cost_rates
for each row execute function public.cost_rate_reject_overlap();

-- Only aggregate, non-identifying metadata is allowed. This prevents a future
-- call site from accidentally storing content or user attribution.
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
         'compute_second', 'request', 'monthly_subscription'
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

-- Prices published by the vendors and current on 2026-07-29. Prices are per
-- raw unit, not per vendor display unit.
insert into public.cost_rates (
  provider, service, sku, unit, price_per_unit_usd, included_units,
  effective_from, source_url, source_label
) values
  ('OpenAI', 'AI', 'gpt-5-nano', 'input_token',
   0.00000005, 0, '2026-07-29T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5-nano',
   'OpenAI GPT-5 nano pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5-nano', 'cached_input_token',
   0.000000005, 0, '2026-07-29T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5-nano',
   'OpenAI GPT-5 nano pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5-nano', 'output_token',
   0.0000004, 0, '2026-07-29T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-5-nano',
   'OpenAI GPT-5 nano pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5-mini', 'input_token',
   0.00000025, 0, '2026-07-29T00:00:00Z',
   'https://openai.com/index/introducing-gpt-5-for-developers/',
   'OpenAI GPT-5 mini pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5-mini', 'cached_input_token',
   0.000000025, 0, '2026-07-29T00:00:00Z',
   'https://openai.com/index/introducing-gpt-5-for-developers/',
   'OpenAI GPT-5 mini pricing, 2026-07-29'),
  ('OpenAI', 'AI', 'gpt-5-mini', 'output_token',
   0.000002, 0, '2026-07-29T00:00:00Z',
   'https://openai.com/index/introducing-gpt-5-for-developers/',
   'OpenAI GPT-5 mini pricing, 2026-07-29'),
  ('Deepgram', 'Transcription', 'nova-3', 'audio_second',
   0.000128333333333333, 0, '2026-07-29T00:00:00Z',
   'https://deepgram.com/pricing',
   'Deepgram Nova-3 prerecorded monolingual pricing, 2026-07-29'),
  ('Cloudflare', 'R2', 'r2-standard', 'gb_month',
   0.015, 10, '2026-07-29T00:00:00Z',
   'https://developers.cloudflare.com/r2/pricing/',
   'Cloudflare R2 Standard pricing, 2026-07-29'),
  ('Cloudflare', 'R2', 'r2-standard', 'storage_byte_snapshot',
   0, 0, '2026-07-29T00:00:00Z',
   'https://developers.cloudflare.com/r2/platform/metrics-analytics/',
   'R2 byte snapshot is informational; daily GB-month accrual is priced'),
  ('Cloudflare', 'R2', 'r2-standard', 'class_a_operation',
   0.0000045, 1000000, '2026-07-29T00:00:00Z',
   'https://developers.cloudflare.com/r2/pricing/',
   'Cloudflare R2 Standard pricing, 2026-07-29'),
  ('Cloudflare', 'R2', 'r2-standard', 'class_b_operation',
   0.00000036, 10000000, '2026-07-29T00:00:00Z',
   'https://developers.cloudflare.com/r2/pricing/',
   'Cloudflare R2 Standard pricing, 2026-07-29'),
  ('Resend', 'Email', 'resend-email', 'email_recipient',
   0, 0, '2026-07-29T00:00:00Z',
   'https://resend.com/pricing',
   'Resend variable rate placeholder; fixed plan configured separately'),
  ('Local', 'Compute', 'mac-studio', 'compute_second',
   0, 0, '2026-07-29T00:00:00Z',
   'https://ponglens.app',
   'Owner-operated Mac Studio variable compute rate'),
  ('Synthetic', 'Compute', 'cloud-worker-medium-high', 'compute_second',
   0.000416666666666667, 0, '2026-07-29T00:00:00Z',
   'https://ponglens.app',
   'Editable synthetic cloud worker at $1.50/hour');

create or replace function public.admin_upsert_cost_fixed_item(
  p_provider text,
  p_label text,
  p_monthly_cost_usd numeric,
  p_effective_from date,
  p_effective_to date default null,
  p_enabled boolean default true,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if length(trim(p_provider)) not between 1 and 80
     or length(trim(p_label)) not between 1 and 160
     or p_monthly_cost_usd < 0
     or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'invalid fixed cost item' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.cost_fixed_items (
      provider, label, monthly_cost_usd, effective_from, effective_to, enabled
    ) values (
      trim(p_provider), trim(p_label), p_monthly_cost_usd,
      p_effective_from, p_effective_to, p_enabled
    )
    returning id into v_id;
  else
    update public.cost_fixed_items
    set provider = trim(p_provider),
        label = trim(p_label),
        monthly_cost_usd = p_monthly_cost_usd,
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        enabled = p_enabled,
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'fixed cost item not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_cost_fixed_item(
  text, text, numeric, date, date, boolean, uuid
) from public;
grant execute on function public.admin_upsert_cost_fixed_item(
  text, text, numeric, date, date, boolean, uuid
) to authenticated;

create or replace function public.get_platform_cost_dashboard(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_start is null
     or p_end is null
     or p_end <= p_start
     or p_end - p_start > interval '370 days' then
    raise exception 'invalid dashboard date range' using errcode = '22023';
  end if;

  with filtered_events as (
    select e.*
    from public.cost_usage_events e
    where e.occurred_at >= p_start
      and e.occurred_at < p_end
  ),
  rated as (
    select
      e.*,
      r.id as rate_id,
      r.price_per_unit_usd,
      r.included_units,
      r.source_url,
      r.source_label,
      date_trunc('month', e.occurred_at) as billing_month
    from filtered_events e
    left join lateral (
      select r.*
      from public.cost_rates r
      where r.provider = e.provider
        and r.service = e.service
        and r.sku = e.sku
        and r.unit = e.unit
        and r.effective_from <= e.occurred_at
        and (r.effective_to is null or e.occurred_at < r.effective_to)
      order by r.effective_from desc
      limit 1
    ) r on true
  ),
  running as (
    select
      r.*,
      sum(r.quantity) over (
        partition by r.provider, r.service, r.sku, r.unit, r.billing_month
        order by r.occurred_at, r.id
        rows between unbounded preceding and current row
      ) as running_quantity
    from rated r
  ),
  priced as (
    select
      r.*,
      case
        when r.rate_id is null then 0::numeric
        else (
          greatest(0::numeric, r.running_quantity - r.included_units)
          - greatest(
              0::numeric,
              r.running_quantity - r.quantity - r.included_units
            )
        ) * r.price_per_unit_usd
      end as cost_usd
    from running r
  ),
  calendar_days as (
    select generate_series(
      p_start::date,
      (p_end - interval '1 microsecond')::date,
      interval '1 day'
    )::date as day
  ),
  fixed_daily as (
    select
      d.day,
      f.provider,
      'Fixed'::text as service,
      sum(
        f.monthly_cost_usd
        / extract(day from (
            date_trunc('month', d.day::timestamp)
            + interval '1 month - 1 day'
          ))
      )::numeric as cost_usd
    from calendar_days d
    join public.cost_fixed_items f
      on f.enabled
     and f.effective_from <= d.day
     and (f.effective_to is null or f.effective_to >= d.day)
    group by d.day, f.provider
  ),
  daily_costs as (
    select
      p.occurred_at::date as day,
      p.provider,
      p.service,
      sum(p.cost_usd) as cost_usd
    from priced p
    group by p.occurred_at::date, p.provider, p.service
    union all
    select day, provider, service, cost_usd
    from fixed_daily
  ),
  daily_rollup as (
    select
      d.day,
      coalesce(sum(c.cost_usd), 0::numeric) as cost_usd,
      coalesce(
        jsonb_object_agg(c.provider, c.provider_cost)
          filter (where c.provider is not null),
        '{}'::jsonb
      ) as by_provider
    from calendar_days d
    left join (
      select day, provider, sum(cost_usd) as provider_cost
      from daily_costs
      group by day, provider
    ) c on c.day = d.day
    group by d.day
    order by d.day
  ),
  provider_costs as (
    select
      provider,
      sum(cost_usd) as cost_usd,
      max(last_event_at) as last_event_at
    from (
      select
        p.provider,
        sum(p.cost_usd) as cost_usd,
        max(p.occurred_at) as last_event_at
      from priced p
      group by p.provider
      union all
      select
        f.provider,
        sum(f.cost_usd),
        null::timestamptz
      from fixed_daily f
      group by f.provider
    ) combined
    group by provider
  ),
  service_costs as (
    select provider, service, sum(cost_usd) as cost_usd
    from daily_costs
    group by provider, service
  ),
  usage_rollup as (
    select
      p.provider,
      p.service,
      p.operation,
      p.sku,
      p.unit,
      sum(p.quantity) as quantity,
      sum(p.cost_usd) as cost_usd,
      max(p.price_per_unit_usd) as price_per_unit_usd,
      max(p.source_url) as source_url,
      max(p.source_label) as source_label,
      case
        when bool_or(p.source = 'assumed') then 'assumed'
        when bool_or(p.source = 'backfill') then 'estimated'
        else 'metered'
      end as confidence
    from priced p
    group by p.provider, p.service, p.operation, p.sku, p.unit
  ),
  snapshots as (
    select distinct on (s.provider)
      s.provider,
      s.period_start,
      s.period_end,
      s.reported_cost_usd,
      s.usage,
      s.status,
      s.error_code,
      s.fetched_at
    from public.cost_provider_snapshots s
    order by s.provider, s.fetched_at desc
  ),
  unmapped_rollup as (
    select
      p.provider,
      p.service,
      p.sku,
      p.unit,
      sum(p.quantity) as quantity
    from priced p
    where p.rate_id is null
    group by p.provider, p.service, p.sku, p.unit
  ),
  aggregate_counts as (
    select
      (select count(*) from auth.users)::integer as registered_users,
      (select count(distinct j.user_id) from public.jobs j)::integer
        as active_users,
      (select count(*) from public.matches m where m.status = 'ready')::integer
        as completed_matches,
      (select count(*) from public.points p where p.deleted_at is null)::integer
        as retained_points
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'total_usd', coalesce((select sum(cost_usd) from daily_rollup), 0),
      'variable_usd', coalesce((select sum(cost_usd) from priced), 0),
      'fixed_usd', coalesce((select sum(cost_usd) from fixed_daily), 0)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'cost_usd', d.cost_usd,
        'by_provider', d.by_provider
      ) order by d.day)
      from daily_rollup d
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', p.provider,
        'cost_usd', p.cost_usd,
        'last_event_at', p.last_event_at
      ) order by p.cost_usd desc, p.provider)
      from provider_costs p
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', s.provider,
        'service', s.service,
        'cost_usd', s.cost_usd
      ) order by s.cost_usd desc)
      from service_costs s
    ), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', u.provider,
        'service', u.service,
        'operation', u.operation,
        'sku', u.sku,
        'unit', u.unit,
        'quantity', u.quantity,
        'cost_usd', u.cost_usd,
        'price_per_unit_usd', u.price_per_unit_usd,
        'source_url', u.source_url,
        'source_label', u.source_label,
        'confidence', u.confidence
      ) order by u.cost_usd desc, u.provider, u.operation)
      from usage_rollup u
    ), '[]'::jsonb),
    'fixed_items', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.provider, f.label)
      from public.cost_fixed_items f
    ), '[]'::jsonb),
    'provider_snapshots', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.provider)
      from snapshots s
    ), '[]'::jsonb),
    'unmapped', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', u.provider,
        'service', u.service,
        'sku', u.sku,
        'unit', u.unit,
        'quantity', u.quantity
      ) order by u.provider, u.sku, u.unit)
      from unmapped_rollup u
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'first_event_at', (select min(occurred_at) from filtered_events),
      'last_event_at', (select max(occurred_at) from filtered_events),
      'latest_storage_snapshot_at', (
        select max(occurred_at)
        from filtered_events
        where unit = 'storage_byte_snapshot'
      ),
      'unmapped_count', (
        select count(*) from priced where rate_id is null
      )
    ),
    'simulation_baseline', (
      select jsonb_build_object(
        'registered_users', c.registered_users,
        'active_users', c.active_users,
        'completed_matches', c.completed_matches,
        'retained_points', c.retained_points,
        'observed_cost_usd', coalesce((
          select sum(cost_usd) from priced
        ), 0),
        'compute_seconds', coalesce((
          select sum(quantity)
          from filtered_events
          where unit = 'compute_second'
        ), 0),
        'storage_bytes', coalesce((
          select quantity
          from filtered_events
          where unit = 'storage_byte_snapshot'
          order by occurred_at desc
          limit 1
        ), 0)
      )
      from aggregate_counts c
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_platform_cost_dashboard(
  timestamptz, timestamptz
) from public;
grant execute on function public.get_platform_cost_dashboard(
  timestamptz, timestamptz
) to authenticated;

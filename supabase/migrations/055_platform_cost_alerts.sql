-- Durable owner alerts for each $100 of internally metered monthly spend.
-- Provider reconciliation snapshots and synthetic compute are intentionally
-- excluded: this prices only cost_usage_events plus configured fixed items.

create table public.platform_cost_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  threshold_usd numeric not null check (threshold_usd > 0),
  observed_cost_usd numeric not null check (observed_cost_usd >= 0),
  provider_costs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_costs) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (period_start, threshold_usd)
);

create index platform_cost_alert_deliveries_pending_idx
  on public.platform_cost_alert_deliveries (status, period_start, threshold_usd);

alter table public.platform_cost_alert_deliveries enable row level security;
revoke all on public.platform_cost_alert_deliveries from anon, authenticated;

create or replace function public.claim_platform_cost_alert(
  p_threshold_step_usd numeric default 100,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_period_start timestamptz;
  v_period_date date;
  v_total numeric := 0;
  v_provider_costs jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_threshold_step_usd is null
     or p_threshold_step_usd <= 0
     or p_threshold_step_usd > 1000000
     or p_now is null then
    raise exception 'invalid cost alert parameters' using errcode = '22023';
  end if;

  v_period_start := (
    date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'
  );
  v_period_date := (v_period_start at time zone 'UTC')::date;

  with filtered_events as (
    select e.*
    from public.cost_usage_events e
    where e.occurred_at >= v_period_start
      and e.occurred_at <= p_now
  ),
  rated as (
    select
      e.*,
      r.id as rate_id,
      r.price_per_unit_usd,
      r.included_units,
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
      r.provider,
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
      v_period_date,
      (p_now at time zone 'UTC')::date,
      interval '1 day'
    )::date as day
  ),
  fixed_costs as (
    select
      f.provider,
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
    group by f.provider
  ),
  provider_totals as (
    select provider, sum(cost_usd) as cost_usd
    from (
      select provider, cost_usd from priced
      union all
      select provider, cost_usd from fixed_costs
    ) costs
    group by provider
  )
  select
    coalesce(sum(cost_usd), 0::numeric),
    coalesce(
      jsonb_object_agg(provider, cost_usd order by provider),
      '{}'::jsonb
    )
  into v_total, v_provider_costs
  from provider_totals;

  insert into public.platform_cost_alert_deliveries (
    period_start,
    threshold_usd,
    observed_cost_usd,
    provider_costs
  )
  select
    v_period_date,
    threshold,
    v_total,
    v_provider_costs
  from generate_series(
    p_threshold_step_usd,
    floor(v_total / p_threshold_step_usd) * p_threshold_step_usd,
    p_threshold_step_usd
  ) threshold
  on conflict (period_start, threshold_usd) do nothing;

  update public.platform_cost_alert_deliveries
  set
    status = 'pending',
    lease_until = null,
    updated_at = p_now
  where period_start = v_period_date
    and status = 'sending'
    and lease_until < p_now;

  with candidate as (
    select id
    from public.platform_cost_alert_deliveries
    where period_start = v_period_date
      and status = 'pending'
    order by threshold_usd
    for update skip locked
    limit 1
  ),
  claimed as (
    update public.platform_cost_alert_deliveries delivery
    set
      status = 'sending',
      attempts = delivery.attempts + 1,
      observed_cost_usd = v_total,
      provider_costs = v_provider_costs,
      lease_until = p_now + interval '5 minutes',
      last_error_code = null,
      updated_at = p_now
    from candidate
    where delivery.id = candidate.id
    returning delivery.*
  )
  select jsonb_build_object(
    'id', id,
    'period_start', period_start,
    'threshold_usd', threshold_usd,
    'observed_cost_usd', observed_cost_usd,
    'provider_costs', provider_costs,
    'attempts', attempts
  )
  into v_result
  from claimed;

  return v_result;
end;
$$;

create or replace function public.complete_platform_cost_alert(
  p_delivery_id uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_delivery_id is null or p_succeeded is null then
    raise exception 'invalid cost alert completion' using errcode = '22023';
  end if;

  update public.platform_cost_alert_deliveries
  set
    status = case when p_succeeded then 'sent' else 'pending' end,
    sent_at = case when p_succeeded then now() else null end,
    lease_until = null,
    last_error_code = case
      when p_succeeded then null
      else left(coalesce(nullif(p_error_code, ''), 'DeliveryError'), 80)
    end,
    updated_at = now()
  where id = p_delivery_id
    and status = 'sending';
end;
$$;

revoke all on function public.claim_platform_cost_alert(
  numeric,
  timestamptz
) from public;
grant execute on function public.claim_platform_cost_alert(
  numeric,
  timestamptz
) to service_role;

revoke all on function public.complete_platform_cost_alert(
  uuid,
  boolean,
  text
) from public;
grant execute on function public.complete_platform_cost_alert(
  uuid,
  boolean,
  text
) to service_role;


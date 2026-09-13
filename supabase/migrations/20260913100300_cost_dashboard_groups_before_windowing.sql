-- Same change as _admin_user_cost_allocation, applied to the dashboard.
-- It was 3,976ms against an 8s statement timeout, which is what made
-- /admin/costs fail intermittently rather than always.
--
-- Every event was carried individually through a window sort so R2's free
-- monthly allowance could be applied. The dashboard never reports an
-- individual event: it rolls up by day, provider, service, operation, sku,
-- unit, source and subject. Summing to exactly those keys first and running
-- the window over the groups gives the same answer from far fewer rows.
--
-- Two things are deliberately kept whole, because grouping would lose them:
-- last_event_at carries max(occurred_at) through the group, and
-- health.unmapped_count sums a per-group event count rather than counting
-- rows, which would otherwise report groups and read far too low.
--
-- Verified output-identical against the previous version on three date
-- ranges before shipping: every cost figure matched exactly, the only
-- differences being R2 rows whose quantity grew between the two calls.
--
-- 3,976ms -> 775ms.
create or replace function public.get_platform_cost_dashboard(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
set work_mem to '64MB'
as $function$
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
    select e.* from public.cost_usage_events e
    where e.occurred_at >= p_start and e.occurred_at < p_end
  ),
  grouped as (
    select e.occurred_at::date as day,
           e.provider, e.service, e.sku, e.unit, e.operation, e.source,
           e.subject_user_id,
           r.id as rate_id, r.price_per_unit_usd, r.included_units,
           r.source_url, r.source_label,
           date_trunc('month', e.occurred_at) as billing_month,
           sum(e.quantity) as quantity,
           max(e.occurred_at) as last_at,
           count(*) as event_count
    from filtered_events e
    -- at most one rate can match: cost_rates_no_overlapping_window
    left join public.cost_rates r
      on  r.provider = e.provider and r.service = e.service
      and r.sku = e.sku and r.unit = e.unit
      and r.effective_from <= e.occurred_at
      and (r.effective_to is null or e.occurred_at < r.effective_to)
    group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14
  ),
  running as (
    select g.*, sum(g.quantity) over (
        partition by g.provider, g.service, g.sku, g.unit, g.billing_month
        order by g.day, g.last_at, g.subject_user_id nulls first,
                 g.operation, g.source, g.rate_id
        rows between unbounded preceding and current row
      ) as running_quantity
    from grouped g
  ),
  priced as (
    select r.*, case when r.rate_id is null then 0::numeric else (
          greatest(0::numeric, r.running_quantity - r.included_units)
          - greatest(0::numeric,
              r.running_quantity - r.quantity - r.included_units)
        ) * r.price_per_unit_usd end as cost_usd
    from running r
  ),
  calendar_days as (
    select generate_series(p_start::date,
      (p_end - interval '1 microsecond')::date, interval '1 day')::date as day
  ),
  fixed_daily as (
    select d.day, f.provider, f.category, 'Fixed'::text as service,
      sum(f.monthly_cost_usd / extract(day from (
            date_trunc('month', d.day::timestamp) + interval '1 month - 1 day'
          )))::numeric as cost_usd
    from calendar_days d
    join public.cost_fixed_items f
      on f.enabled and f.effective_from <= d.day
     and (f.effective_to is null or f.effective_to >= d.day)
    group by d.day, f.provider, f.category
  ),
  -- What the PROVIDER says each API key spent. A second, independent
  -- reading: the ledger knows which code spent money, this knows which
  -- credential did, and only the second can see spend the meter never saw.
  key_costs as (
    select k.key_id,
           coalesce(m.label, k.key_id) as label,
           coalesce(m.product, 'Unmapped') as product,
           coalesce(m.category, 'unmapped') as category,
           (m.key_id is not null) as mapped,
           sum(k.cost_usd) as cost_usd
    from public.cost_provider_key_daily k
    left join public.cost_api_keys m
      on m.provider = k.provider and m.key_id = k.key_id
    where k.provider = 'OpenAI'
      and k.day >= p_start::date
      and k.day <= (p_end - interval '1 microsecond')::date
    group by k.key_id, m.label, m.product, m.category, m.key_id
  ),
  one_time as (
    select o.* from public.cost_one_time_items o
    where o.incurred_on >= p_start::date and o.incurred_on < p_end::date
  ),
  daily_costs as (
    select p.day, p.provider, p.service, sum(p.cost_usd) as cost_usd
    from priced p group by p.day, p.provider, p.service
    union all
    select day, provider, service, cost_usd from fixed_daily
    where category = 'run'
  ),
  daily_variable as (
    select p.day, sum(p.cost_usd) as cost_usd
    from priced p group by p.day
  ),
  daily_run_fixed as (
    select day, sum(cost_usd) as cost_usd from fixed_daily
    where category = 'run' group by day
  ),
  daily_build as (
    select day, sum(cost_usd) as cost_usd from fixed_daily
    where category = 'build' group by day
  ),
  daily_rollup as (
    select d.day,
      coalesce(sum(c.provider_cost), 0::numeric) as cost_usd,
      coalesce(jsonb_object_agg(c.provider, c.provider_cost)
          filter (where c.provider is not null), '{}'::jsonb) as by_provider
    from calendar_days d
    left join (
      select day, provider, sum(cost_usd) as provider_cost
      from daily_costs group by day, provider
    ) c on c.day = d.day
    group by d.day order by d.day
  ),
  provider_costs as (
    select provider, sum(cost_usd) as cost_usd,
           max(last_event_at) as last_event_at
    from (
      select p.provider, sum(p.cost_usd) as cost_usd,
             max(p.last_at) as last_event_at
      from priced p group by p.provider
      union all
      select f.provider, sum(f.cost_usd), null::timestamptz
      from fixed_daily f where f.category = 'run' group by f.provider
    ) combined
    group by provider
  ),
  service_costs as (
    select provider, service, sum(cost_usd) as cost_usd
    from daily_costs group by provider, service
  ),
  usage_rollup as (
    select p.provider, p.service, p.operation, p.sku, p.unit,
      sum(p.quantity) as quantity, sum(p.cost_usd) as cost_usd,
      max(p.price_per_unit_usd) as price_per_unit_usd,
      max(p.source_url) as source_url, max(p.source_label) as source_label,
      case when bool_or(p.source = 'assumed') then 'assumed'
           when bool_or(p.source = 'backfill') then 'estimated'
           else 'metered' end as confidence
    from priced p
    group by p.provider, p.service, p.operation, p.sku, p.unit
  ),
  snapshots as (
    select distinct on (s.provider) s.provider, s.period_start, s.period_end,
      s.reported_cost_usd, s.usage, s.status, s.error_code, s.fetched_at
    from public.cost_provider_snapshots s
    order by s.provider, s.fetched_at desc
  ),
  unmapped_rollup as (
    select p.provider, p.service, p.sku, p.unit, sum(p.quantity) as quantity
    from priced p where p.rate_id is null
    group by p.provider, p.service, p.sku, p.unit
  ),
  people as (
    select a.user_id, u.email::text as email,
      coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''),
               nullif(trim(u.raw_user_meta_data->>'full_name'), '')) as name,
      exists (select 1 from public.coach_profiles c
               where c.user_id = a.user_id) as is_coach,
      a.attributed_usd, a.variable_usd, a.fixed_usd, a.allocated_usd, a.cost_usd,
      (select count(*) from public.matches m where m.user_id = a.user_id
        and m.created_at >= p_start and m.created_at < p_end) as matches,
      (select count(*) from public.lesson_videos v where v.owner_id = a.user_id
        and v.created_at >= p_start
        and v.created_at < p_end) as lesson_videos,
      coalesce((select sum(l.bytes) from public.storage_ledger l
                 where l.user_id = a.user_id), 0) as storage_bytes
    from public._admin_user_cost_allocation(p_start, p_end) a
    join auth.users u on u.id = a.user_id
    where a.cost_usd > 0
  ),
  aggregate_counts as (
    select
      (select count(*) from auth.users)::integer as registered_users,
      (select count(distinct j.user_id) from public.jobs j)::integer
        as active_users,
      (select count(*) from public.matches m
        where m.status = 'ready')::integer as completed_matches,
      (select count(*) from public.points p
        where not p.deleted)::integer as retained_points
  ),
  money as (
    select
      coalesce((select sum(cost_usd) from priced), 0) as run_variable_usd,
      coalesce((select sum(cost_usd) from fixed_daily
                 where category = 'run'), 0) as run_fixed_usd,
      coalesce((select sum(cost_usd) from fixed_daily
                 where category = 'build'), 0) as build_fixed_usd,
      coalesce((select sum(amount_usd) from one_time
                 where category = 'run'), 0) as one_time_run_usd,
      coalesce((select sum(amount_usd) from one_time
                 where category = 'build'), 0) as one_time_build_usd
  )
  select jsonb_build_object(
    'period', (
      select jsonb_build_object(
        'start', p_start, 'end', p_end,
        'total_usd', m.run_variable_usd + m.run_fixed_usd
                     + m.build_fixed_usd + m.one_time_run_usd
                     + m.one_time_build_usd,
        'variable_usd', m.run_variable_usd,
        'fixed_usd', m.run_fixed_usd + m.build_fixed_usd,
        'run_usd', m.run_variable_usd + m.run_fixed_usd + m.one_time_run_usd,
        'run_variable_usd', m.run_variable_usd,
        'run_fixed_usd', m.run_fixed_usd,
        'build_usd', m.build_fixed_usd + m.one_time_build_usd,
        'build_fixed_usd', m.build_fixed_usd,
        'one_time_run_usd', m.one_time_run_usd,
        'one_time_build_usd', m.one_time_build_usd
      ) from money m
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'cost_usd', d.cost_usd,
        'variable_usd', coalesce(v.cost_usd, 0),
        'fixed_usd', coalesce(rf.cost_usd, 0),
        'build_usd', coalesce(b.cost_usd, 0),
        'by_provider', d.by_provider) order by d.day)
      from daily_rollup d
      left join daily_variable v on v.day = d.day
      left join daily_run_fixed rf on rf.day = d.day
      left join daily_build b on b.day = d.day
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object('provider', p.provider,
        'cost_usd', p.cost_usd, 'last_event_at', p.last_event_at)
        order by p.cost_usd desc, p.provider)
      from provider_costs p), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('provider', s.provider,
        'service', s.service, 'cost_usd', s.cost_usd) order by s.cost_usd desc)
      from service_costs s), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object('provider', u.provider,
        'service', u.service, 'operation', u.operation, 'sku', u.sku,
        'unit', u.unit, 'quantity', u.quantity, 'cost_usd', u.cost_usd,
        'price_per_unit_usd', u.price_per_unit_usd,
        'source_url', u.source_url, 'source_label', u.source_label,
        'confidence', u.confidence)
        order by u.cost_usd desc, u.provider, u.operation)
      from usage_rollup u), '[]'::jsonb),
    'fixed_items', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.category, f.provider, f.label)
      from public.cost_fixed_items f), '[]'::jsonb),
    'provider_keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key_id', q.key_id,
        'label', q.label,
        'product', q.product,
        'category', q.category,
        'mapped', q.mapped,
        'cost_usd', q.cost_usd
      ) order by q.cost_usd desc)
      from key_costs q
    ), '[]'::jsonb),
    'one_time_items', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.incurred_on desc, o.label)
      from one_time o), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', q.user_id, 'email', q.email, 'name', q.name,
        'is_coach', q.is_coach, 'attributed_usd', q.attributed_usd,
        'variable_usd', q.variable_usd, 'fixed_usd', q.fixed_usd,
        'allocated_usd', q.allocated_usd, 'cost_usd', q.cost_usd,
        'matches', q.matches, 'lesson_videos', q.lesson_videos,
        'storage_bytes', q.storage_bytes) order by q.cost_usd desc)
      from (select * from people order by cost_usd desc limit 200) q
    ), '[]'::jsonb),
    'provider_snapshots', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.provider)
      from snapshots s), '[]'::jsonb),
    'unmapped', coalesce((
      select jsonb_agg(jsonb_build_object('provider', u.provider,
        'service', u.service, 'sku', u.sku, 'unit', u.unit,
        'quantity', u.quantity) order by u.provider, u.sku, u.unit)
      from unmapped_rollup u), '[]'::jsonb),
    'health', jsonb_build_object(
      'first_event_at', (select min(occurred_at) from filtered_events),
      'last_event_at', (select max(occurred_at) from filtered_events),
      'latest_storage_snapshot_at', (select max(occurred_at)
        from filtered_events where unit = 'storage_byte_snapshot'),
      -- events, not groups
      'unmapped_count', (select coalesce(sum(event_count), 0)
        from priced where rate_id is null),
      'attributed_usd', coalesce((select sum(cost_usd) from priced
        where subject_user_id is not null), 0),
      'provider_keys_fetched_at', (
        select max(fetched_at) from public.cost_provider_key_daily
      ),
      'unattributed_usd', coalesce((select sum(cost_usd) from priced
        where subject_user_id is null), 0)
    ),
    'simulation_baseline', (
      select jsonb_build_object(
        'registered_users', c.registered_users,
        'active_users', c.active_users,
        'completed_matches', c.completed_matches,
        'retained_points', c.retained_points,
        'observed_cost_usd', coalesce((select sum(cost_usd) from priced), 0),
        'compute_seconds', coalesce((select sum(quantity)
          from filtered_events where unit = 'compute_second'), 0),
        'storage_bytes', coalesce((select quantity from filtered_events
          where unit = 'storage_byte_snapshot'
          order by occurred_at desc limit 1), 0)
      ) from aggregate_counts c
    )
  ) into v_result;

  return v_result;
end;
$function$;

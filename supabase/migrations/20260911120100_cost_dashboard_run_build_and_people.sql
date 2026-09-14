-- The two read paths, rewritten for attribution and for the run/build
-- split. Both are recreated whole from the live definitions rather than
-- patched in place, because a cost function edited from a stale reading
-- silently drops whatever was added to it since.

--------------------------------------------------------------------
-- 1. Cost per person: attributed where we know, allocated where we do not.
--------------------------------------------------------------------

-- The old version divided the whole pot by activity counts, which made
-- every player's number a function of every other player's behaviour.
-- Now a cost that names its subject goes straight to that person, and
-- only the genuinely shared remainder is divided. As the meter learns to
-- name subjects the allocated half shrinks on its own and the number
-- becomes a fact rather than an estimate.
--
-- Build costs are deliberately absent. Nobody's upload caused a Claude
-- subscription, and folding one into a player's cost would make the
-- cheapest player look expensive the month a tool was bought.
drop function if exists public._admin_user_cost_allocation(
  timestamptz, timestamptz);

create function public._admin_user_cost_allocation(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  user_id uuid,
  attributed_usd numeric,
  allocated_usd numeric,
  cost_usd numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with rated as (
    -- Same tiered pricing as get_platform_cost_dashboard: a monthly
    -- running quantity per SKU, so included units are burned once.
    select
      e.subject_user_id,
      e.provider,
      e.quantity,
      r.price_per_unit_usd,
      r.included_units,
      case when r.id is null then null else
        sum(e.quantity) over (
          partition by e.provider, e.service, e.sku, e.unit,
                       date_trunc('month', e.occurred_at)
          order by e.occurred_at, e.id
          rows between unbounded preceding and current row
        )
      end as running_quantity
    from public.cost_usage_events e
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
    where e.occurred_at >= p_start
      and e.occurred_at < p_end
  ),
  costed as (
    select
      subject_user_id,
      provider,
      case when running_quantity is null then 0::numeric else
        (greatest(0::numeric, running_quantity - included_units)
         - greatest(0::numeric,
             running_quantity - quantity - included_units)
        ) * price_per_unit_usd
      end as cost_usd
    from rated
  ),
  attributed as (
    select subject_user_id as uid, sum(cost_usd) as cost_usd
    from costed
    where subject_user_id is not null
    group by 1
  ),
  run_fixed_total as (
    select coalesce(sum(
      f.monthly_cost_usd
      / extract(day from (
          date_trunc('month', d.day::timestamp)
          + interval '1 month - 1 day'
        ))
    ), 0)::numeric as cost_usd
    from generate_series(
      p_start::date, (p_end - interval '1 microsecond')::date,
      interval '1 day'
    ) as d(day)
    join public.cost_fixed_items f
      on f.enabled
     and f.category = 'run'
     and f.effective_from <= d.day::date
     and (f.effective_to is null or f.effective_to >= d.day::date)
  ),
  run_one_time_total as (
    select coalesce(sum(o.amount_usd), 0)::numeric as cost_usd
    from public.cost_one_time_items o
    where o.category = 'run'
      and o.incurred_on >= p_start::date
      and o.incurred_on < p_end::date
  ),
  bucket_costs as (
    select
      case provider
        when 'Cloudflare' then 'storage'
        when 'Deepgram'   then 'voice'
        when 'OpenAI'     then 'ai'
        when 'Google'     then 'ai'
        else 'activity'
      end as bucket,
      sum(cost_usd) as cost_usd
    from costed
    where subject_user_id is null
    group by 1
    union all
    select 'activity', cost_usd from run_fixed_total
    union all
    select 'activity', cost_usd from run_one_time_total
  ),
  drivers as (
    -- Every driver counts lesson videos. Leaving them out was what made
    -- the old numbers wrong: they are the heaviest thing in the product
    -- on both transcription and model spend, and they were invisible to
    -- all four counts.
    select
      u.id as uid,
      coalesce((select sum(l.bytes) from public.storage_ledger l
                 where l.user_id = u.id), 0)::numeric as storage,
      ((select count(*) from public.notes n
         where n.author_id = u.id and n.audio_path is not null
           and n.created_at >= p_start and n.created_at < p_end)
       + (select count(*) from public.lesson_videos v
           where v.owner_id = u.id
             and v.created_at >= p_start and v.created_at < p_end)
      )::numeric as voice,
      ((select count(*) from public.matches m
         where m.user_id = u.id
           and m.created_at >= p_start and m.created_at < p_end)
       + (select count(*) from public.recollect_jobs j
           where j.user_id = u.id
             and j.created_at >= p_start and j.created_at < p_end)
       + (select count(*) from public.lessons s
           where s.user_id = u.id
             and s.created_at >= p_start and s.created_at < p_end)
       + (select count(*) from public.lesson_videos v
           where v.owner_id = u.id
             and v.created_at >= p_start and v.created_at < p_end)
      )::numeric as ai,
      ((select count(*) from public.matches m
         where m.user_id = u.id
           and m.created_at >= p_start and m.created_at < p_end)
       + (select count(*) from public.notes n
           where n.author_id = u.id
             and n.created_at >= p_start and n.created_at < p_end)
       + (select count(*) from public.lessons s
           where s.user_id = u.id
             and s.created_at >= p_start and s.created_at < p_end)
       + (select count(*) from public.lesson_videos v
           where v.owner_id = u.id
             and v.created_at >= p_start and v.created_at < p_end)
      )::numeric as activity
    from auth.users u
  ),
  totals as (
    select
      sum(storage)  as storage,
      sum(voice)    as voice,
      sum(ai)       as ai,
      sum(activity) as activity
    from drivers
  ),
  shares as (
    select
      d.uid,
      coalesce(a.cost_usd, 0) as attributed_usd,
        coalesce((select cost_usd from bucket_costs where bucket = 'storage'), 0)
          * case when t.storage > 0 then d.storage / t.storage else 0 end
      + coalesce((select cost_usd from bucket_costs where bucket = 'voice'), 0)
          * case when t.voice > 0 then d.voice / t.voice else 0 end
      + coalesce((select cost_usd from bucket_costs where bucket = 'ai'), 0)
          * case when t.ai > 0 then d.ai / t.ai else 0 end
      + coalesce((select sum(cost_usd) from bucket_costs where bucket = 'activity'), 0)
          * case when t.activity > 0 then d.activity / t.activity else 0 end
        as allocated_usd
    from drivers d
    cross join totals t
    left join attributed a on a.uid = d.uid
  )
  select
    s.uid,
    round(s.attributed_usd, 4),
    round(s.allocated_usd, 4),
    round(s.attributed_usd + s.allocated_usd, 4)
  from shares s;
$function$;

revoke all on function public._admin_user_cost_allocation(
  timestamptz, timestamptz) from public;
grant execute on function public._admin_user_cost_allocation(
  timestamptz, timestamptz) to service_role;

--------------------------------------------------------------------
-- 2. The dashboard.
--------------------------------------------------------------------

create or replace function public.get_platform_cost_dashboard(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
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
      f.category,
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
    group by d.day, f.provider, f.category
  ),
  one_time as (
    select o.*
    from public.cost_one_time_items o
    where o.incurred_on >= p_start::date
      and o.incurred_on < p_end::date
  ),
  -- The daily series is RUN cost only. A subscription is a flat line by
  -- construction, so plotting it teaches nothing and it would swamp the
  -- variable spend that is the whole point of a daily chart.
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
    where category = 'run'
  ),
  daily_variable as (
    select p.occurred_at::date as day, sum(p.cost_usd) as cost_usd
    from priced p group by p.occurred_at::date
  ),
  daily_run_fixed as (
    select day, sum(cost_usd) as cost_usd
    from fixed_daily where category = 'run' group by day
  ),
  daily_build as (
    select day, sum(cost_usd) as cost_usd
    from fixed_daily where category = 'build' group by day
  ),
  daily_rollup as (
    select
      d.day,
      coalesce(sum(c.provider_cost), 0::numeric) as cost_usd,
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
      where f.category = 'run'
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
  people as (
    select
      a.user_id,
      u.email::text as email,
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'name'), ''),
        nullif(trim(u.raw_user_meta_data->>'full_name'), '')
      ) as name,
      exists (
        select 1 from public.coach_profiles c where c.user_id = a.user_id
      ) as is_coach,
      a.attributed_usd,
      a.allocated_usd,
      a.cost_usd,
      (select count(*) from public.matches m
        where m.user_id = a.user_id
          and m.created_at >= p_start and m.created_at < p_end) as matches,
      (select count(*) from public.lesson_videos v
        where v.owner_id = a.user_id
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
      (select count(*) from public.matches m where m.status = 'ready')::integer
        as completed_matches,
      (select count(*) from public.points p where not p.deleted)::integer
        as retained_points
  ),
  money as (
    select
      coalesce((select sum(cost_usd) from priced), 0) as run_variable_usd,
      coalesce((select sum(cost_usd) from fixed_daily where category = 'run'), 0)
        as run_fixed_usd,
      coalesce((select sum(cost_usd) from fixed_daily where category = 'build'), 0)
        as build_fixed_usd,
      coalesce((select sum(amount_usd) from one_time where category = 'run'), 0)
        as one_time_run_usd,
      coalesce((select sum(amount_usd) from one_time where category = 'build'), 0)
        as one_time_build_usd
  )
  select jsonb_build_object(
    'period', (
      select jsonb_build_object(
        'start', p_start,
        'end', p_end,
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
      )
      from money m
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'cost_usd', d.cost_usd,
        'variable_usd', coalesce(v.cost_usd, 0),
        'fixed_usd', coalesce(rf.cost_usd, 0),
        'build_usd', coalesce(b.cost_usd, 0),
        'by_provider', d.by_provider
      ) order by d.day)
      from daily_rollup d
      left join daily_variable v on v.day = d.day
      left join daily_run_fixed rf on rf.day = d.day
      left join daily_build b on b.day = d.day
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
      select jsonb_agg(to_jsonb(f) order by f.category, f.provider, f.label)
      from public.cost_fixed_items f
    ), '[]'::jsonb),
    'one_time_items', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.incurred_on desc, o.label)
      from one_time o
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', q.user_id,
        'email', q.email,
        'name', q.name,
        'is_coach', q.is_coach,
        'attributed_usd', q.attributed_usd,
        'allocated_usd', q.allocated_usd,
        'cost_usd', q.cost_usd,
        'matches', q.matches,
        'lesson_videos', q.lesson_videos,
        'storage_bytes', q.storage_bytes
      ) order by q.cost_usd desc)
      from (
        select * from people order by cost_usd desc limit 200
      ) q
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
      ),
      -- What share of metered spend knows who caused it. This is the
      -- number that says how far to trust the People tab, and it climbs
      -- on its own as the meter learns to name subjects.
      'attributed_usd', coalesce((
        select sum(cost_usd) from priced where subject_user_id is not null
      ), 0),
      'unattributed_usd', coalesce((
        select sum(cost_usd) from priced where subject_user_id is null
      ), 0)
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
$function$;

revoke all on function public.get_platform_cost_dashboard(
  timestamptz, timestamptz) from public;
grant execute on function public.get_platform_cost_dashboard(
  timestamptz, timestamptz) to anon, authenticated, service_role;

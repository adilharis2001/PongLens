-- 95% of cost_usage_events is R2 class A/B operations: ~1,800 rows a day,
-- growing forever, none of them attributed to anybody, together worth under
-- a dollar a month. They were being sorted in full on every admin page load
-- because R2's free monthly allowance needs a running total to know where
-- the allowance runs out. The sort needed 12,992kB against a 3,500kB
-- work_mem, so it spilled 13MB to disk every time.
--
-- The running total does not need one row per operation. Summing each
-- (rate, month, person) group first and running the window over the groups
-- gives the identical answer: 112,038 window rows become 86, total spend is
-- unchanged to eight decimal places, and no individual's total moves.
--
-- The rule this makes explicit: a free monthly allowance is consumed in the
-- order each party FIRST used that service in the month. Previously it was
-- consumed in raw event order, which is the same thing whenever a partition
-- has a single party -- true of every allowance we have, since all R2 rows
-- are unattributed. It is also the more defensible rule of the two.
--
-- 2,661ms -> 318ms. work_mem is raised on the function itself so the
-- remaining sort can never silently start spilling again as data grows.
create or replace function public._admin_user_cost_allocation(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  user_id uuid,
  attributed_usd numeric,
  variable_usd numeric,
  fixed_usd numeric,
  allocated_usd numeric,
  cost_usd numeric
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
as $function$
  with grouped as (
    select e.provider, e.service, e.sku, e.unit, e.subject_user_id,
           date_trunc('month', e.occurred_at) as month,
           r.id as rate_id, r.price_per_unit_usd, r.included_units,
           sum(e.quantity) as quantity,
           min(e.occurred_at) as first_at
    from public.cost_usage_events e
    -- at most one rate can match: cost_rates_no_overlapping_window
    left join public.cost_rates r
      on  r.provider = e.provider and r.service = e.service
      and r.sku = e.sku and r.unit = e.unit
      and r.effective_from <= e.occurred_at
      and (r.effective_to is null or e.occurred_at < r.effective_to)
    where e.occurred_at >= p_start and e.occurred_at < p_end
    group by 1,2,3,4,5,6,7,8,9
  ),
  rated as (
    -- a rate change mid-month leaves two groups in one window partition,
    -- ordered by first use, so tiering still spans the whole month
    select g.subject_user_id, g.provider, g.quantity,
           g.price_per_unit_usd, g.included_units,
           case when g.rate_id is null then null else
             sum(g.quantity) over (
               partition by g.provider, g.service, g.sku, g.unit, g.month
               order by g.first_at, g.subject_user_id nulls first, g.rate_id
               rows between unbounded preceding and current row
             )
           end as running_quantity
    from grouped g
  ),
  costed as (
    select subject_user_id, provider,
      case when running_quantity is null then 0::numeric else
        (greatest(0::numeric, running_quantity - included_units)
         - greatest(0::numeric, running_quantity - quantity - included_units)
        ) * price_per_unit_usd
      end as cost_usd
    from rated
  ),
  attributed as (
    select subject_user_id as uid, sum(cost_usd) as cost_usd
    from costed where subject_user_id is not null group by 1
  ),
  typical as (
    select coalesce(avg(source_duration_s), 600)::numeric as seconds
    from public.jobs
    where created_at >= p_start and created_at < p_end
      and source_duration_s is not null and source_duration_s > 0
  ),
  fixed_total as (
    select coalesce(sum(
      f.monthly_cost_usd / extract(day from (
        date_trunc('month', d.day::timestamp) + interval '1 month - 1 day'))
    ), 0)::numeric
    + coalesce((
        select sum(o.amount_usd) from public.cost_one_time_items o
        where o.category = 'run'
          and o.incurred_on >= p_start::date and o.incurred_on < p_end::date
      ), 0)::numeric as cost_usd
    from generate_series(p_start::date,
      (p_end - interval '1 microsecond')::date, interval '1 day') as d(day)
    join public.cost_fixed_items f
      on f.enabled and f.category = 'run'
     and f.effective_from <= d.day::date
     and (f.effective_to is null or f.effective_to >= d.day::date)
  ),
  buckets as (
    select case provider
             when 'Cloudflare' then 'storage'
             when 'Deepgram'   then 'audio'
             else 'work'
           end as bucket,
           sum(cost_usd) as cost_usd
    from costed where subject_user_id is null group by 1
  ),
  g_storage as (
    select l.user_id as uid, sum(l.bytes)::numeric as bytes
    from public.storage_ledger l group by 1
  ),
  g_media as (
    select j.user_id as uid,
           sum(coalesce(j.source_duration_s, t.seconds))::numeric as seconds
    from public.jobs j cross join typical t
    where j.kind in ('deadspace_cut', 'youtube_import', 'hand_cut')
      and j.created_at >= p_start and j.created_at < p_end
    group by 1
  ),
  g_lesson as (
    select v.owner_id as uid,
           sum(coalesce(v.duration_s, 0))::numeric as seconds
    from public.lesson_videos v
    where v.created_at >= p_start and v.created_at < p_end
    group by 1
  ),
  g_notes as (
    select n.author_id as uid, count(*)::numeric as n,
           count(*) filter (where n.audio_path is not null)::numeric as voice
    from public.notes n
    where n.created_at >= p_start and n.created_at < p_end
    group by 1
  ),
  g_lessons as (
    select s.user_id as uid, count(*)::numeric as n
    from public.lessons s
    where s.created_at >= p_start and s.created_at < p_end
    group by 1
  ),
  g_recollect as (
    select rj.user_id as uid, count(*)::numeric as n
    from public.recollect_jobs rj
    where rj.created_at >= p_start and rj.created_at < p_end
    group by 1
  ),
  drivers as (
    select
      u.id as uid,
      coalesce(gs.bytes, 0) as storage_bytes,
      coalesce(gl.seconds, 0) + 60 * coalesce(gn.voice, 0) as audio_seconds,
      coalesce(gm.seconds, 0) + coalesce(gl.seconds, 0)
        + 60 * (coalesce(gn.n, 0) + coalesce(gls.n, 0) + coalesce(gr.n, 0))
        as work_seconds
    from auth.users u
    left join g_storage   gs  on gs.uid  = u.id
    left join g_media     gm  on gm.uid  = u.id
    left join g_lesson    gl  on gl.uid  = u.id
    left join g_notes     gn  on gn.uid  = u.id
    left join g_lessons   gls on gls.uid = u.id
    left join g_recollect gr  on gr.uid  = u.id
  ),
  totals as (
    select sum(storage_bytes) as storage_bytes,
           sum(audio_seconds) as audio_seconds,
           sum(work_seconds) as work_seconds
    from drivers
  ),
  shares as (
    select d.uid,
      coalesce(a.cost_usd, 0) as attributed_usd,
        coalesce((select cost_usd from buckets where bucket='storage'), 0)
          * case when t.storage_bytes > 0
                 then d.storage_bytes / t.storage_bytes else 0 end
      + coalesce((select cost_usd from buckets where bucket='audio'), 0)
          * case when t.audio_seconds > 0
                 then d.audio_seconds / t.audio_seconds else 0 end
      + coalesce((select cost_usd from buckets where bucket='work'), 0)
          * case when t.work_seconds > 0
                 then d.work_seconds / t.work_seconds else 0 end
        as variable_usd,
      coalesce((select cost_usd from fixed_total), 0)
        * case when t.work_seconds > 0
               then d.work_seconds / t.work_seconds else 0 end as fixed_usd
    from drivers d cross join totals t
    left join attributed a on a.uid = d.uid
  )
  select s.uid,
         round(s.attributed_usd, 4),
         round(s.variable_usd, 4),
         round(s.fixed_usd, 4),
         round(s.variable_usd + s.fixed_usd, 4),
         round(s.attributed_usd + s.variable_usd + s.fixed_usd, 4)
  from shares s;
$function$;

revoke all on function public._admin_user_cost_allocation(
  timestamptz, timestamptz) from public;
grant execute on function public._admin_user_cost_allocation(
  timestamptz, timestamptz) to service_role;

-- 068: the admin portal grows a players section, and the hub needs counts.
--
--  * admin_portal_counts()      — pending work + headline numbers for the
--                                 admin hub cards, one cheap call.
--  * _admin_user_cost_allocation — estimated per-user split of platform
--                                 spend. Costs are metered platform-wide
--                                 (no user column on cost_usage_events), so
--                                 each provider's priced total is divided by
--                                 the driver that actually generates it:
--                                 Cloudflare by stored bytes, Deepgram by
--                                 voice notes, OpenAI by processed work,
--                                 everything else (compute, Supabase,
--                                 Vercel, Resend, fixed items) by overall
--                                 activity. Buckets with no drivers stay
--                                 unallocated rather than being smeared
--                                 evenly, so per-user numbers can sum to
--                                 less than the platform total. Estimates,
--                                 and labeled that way in the UI.
--  * admin_player_overview()    — one row per account for /admin/players.
--  * admin_player_detail()      — everything the per-player page shows,
--                                 including the per-upload table with both
--                                 timelines (source t0/t1, cut cut_t0).
--  * admin_match_cut_path()     — the cut video's R2 path for any match, so
--                                 the admin media route can sign a playback
--                                 URL without a service-role key. Falls back
--                                 to the source job's result like
--                                 /api/media-url does.
--
-- All admin functions re-check is_admin() inside; the page-level email
-- redirect is UX, not the boundary.

-- ---------------------------------------------------------------------------
-- admin_portal_counts
-- ---------------------------------------------------------------------------
create or replace function public.admin_portal_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'access_requests',
      (select count(*) from public.access_requests r
        where r.status = 'pending'),
    'quota_requests',
      (select count(*) from public.quota_requests r
        where r.status = 'pending'),
    'players',
      (select count(*) from auth.users),
    'matches',
      (select count(*) from public.matches)
  );
end;
$$;

revoke execute on function public.admin_portal_counts() from public, anon;
grant execute on function public.admin_portal_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- _admin_user_cost_allocation — internal, callers re-check is_admin()
-- ---------------------------------------------------------------------------
create or replace function public._admin_user_cost_allocation(
  p_start timestamptz,
  p_end timestamptz
)
returns table (user_id uuid, cost_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  with rated as (
    -- Same tiered pricing as get_platform_cost_dashboard (050): a monthly
    -- running quantity per SKU, so included units are burned once.
    select
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
  fixed_total as (
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
     and f.effective_from <= d.day::date
     and (f.effective_to is null or f.effective_to >= d.day::date)
  ),
  bucket_costs as (
    select
      case provider
        when 'Cloudflare' then 'storage'
        when 'Deepgram'   then 'voice'
        when 'OpenAI'     then 'ai'
        else 'activity'
      end as bucket,
      sum(
        case when running_quantity is null then 0 else
          (greatest(0::numeric, running_quantity - included_units)
           - greatest(0::numeric,
               running_quantity - quantity - included_units)
          ) * price_per_unit_usd
        end
      ) as cost_usd
    from rated
    group by 1
    union all
    select 'activity', cost_usd from fixed_total
  ),
  drivers as (
    select
      u.id as uid,
      coalesce((select sum(l.bytes) from public.storage_ledger l
                 where l.user_id = u.id), 0)::numeric as storage,
      (select count(*) from public.notes n
        where n.author_id = u.id and n.audio_path is not null
          and n.created_at >= p_start and n.created_at < p_end
      )::numeric as voice,
      ((select count(*) from public.matches m
         where m.user_id = u.id
           and m.created_at >= p_start and m.created_at < p_end)
       + (select count(*) from public.recollect_jobs j
           where j.user_id = u.id
             and j.created_at >= p_start and j.created_at < p_end)
       + (select count(*) from public.lessons s
           where s.user_id = u.id and s.image_path is not null
             and s.created_at >= p_start and s.created_at < p_end)
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
  )
  select
    d.uid,
    round(
        coalesce((select cost_usd from bucket_costs where bucket = 'storage'), 0)
          * case when t.storage > 0 then d.storage / t.storage else 0 end
      + coalesce((select cost_usd from bucket_costs where bucket = 'voice'), 0)
          * case when t.voice > 0 then d.voice / t.voice else 0 end
      + coalesce((select cost_usd from bucket_costs where bucket = 'ai'), 0)
          * case when t.ai > 0 then d.ai / t.ai else 0 end
      + coalesce((select sum(cost_usd) from bucket_costs where bucket = 'activity'), 0)
          * case when t.activity > 0 then d.activity / t.activity else 0 end
    , 4) as cost_usd
  from drivers d, totals t;
$$;

revoke execute on function public._admin_user_cost_allocation(timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_player_overview
-- ---------------------------------------------------------------------------
create or replace function public.admin_player_overview()
returns table (
  user_id          uuid,
  email            text,
  name             text,
  created_at       timestamptz,
  last_sign_in_at  timestamptz,
  access_source    text,
  used_bytes       bigint,
  storage_limit_bytes bigint,
  matches          int,
  matches_scored   int,
  points           int,
  starred          int,
  notes            int,
  voice_notes      int,
  journal_entries  int,
  exports          int,
  share_links      int,
  est_cost_usd     numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- "All time" for the estimate: since the first metered event.
  v_start timestamptz := coalesce(
    (select min(e.occurred_at) from public.cost_usage_events e), now());
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select
    u.id,
    u.email::text,
    public._display_name(u.*),
    u.created_at,
    u.last_sign_in_at,
    a.source,
    coalesce((select sum(l.bytes) from public.storage_ledger l
               where l.user_id = u.id), 0)::bigint,
    coalesce(q.storage_limit_bytes, public.default_storage_bytes()),
    (select count(*) from public.matches m where m.user_id = u.id)::int,
    (select count(*) from public.matches m
      where m.user_id = u.id
        and exists (select 1 from public.points p
                     where p.match_id = m.id
                       and p.confirmed_winner is not null)
        and not exists (select 1 from public.points p
                         where p.match_id = m.id
                           and not p.deleted and not p.is_let
                           and p.confirmed_winner is null)
    )::int,
    (select count(*) from public.points p
       join public.matches m on m.id = p.match_id
      where m.user_id = u.id and not p.deleted)::int,
    (select count(*) from public.points p
       join public.matches m on m.id = p.match_id
      where m.user_id = u.id and not p.deleted and p.starred)::int,
    (select count(*) from public.notes n where n.author_id = u.id)::int,
    (select count(*) from public.notes n
      where n.author_id = u.id and n.audio_path is not null)::int,
    (select count(*) from public.lessons s where s.user_id = u.id)::int,
    ((select count(*) from public.match_reels r
       join public.matches m on m.id = r.match_id
      where m.user_id = u.id and r.status = 'ready')
     + (select count(*) from public.tag_reels r
         where r.user_id = u.id and r.status = 'ready'))::int,
    (select count(*) from public.share_links s
      where s.owner = u.id and s.revoked_at is null)::int,
    coalesce(c.cost_usd, 0)
  from auth.users u
  left join public.app_access a on a.user_id = u.id
  left join public.user_quotas q on q.user_id = u.id
  left join public._admin_user_cost_allocation(v_start, now())
    c on c.user_id = u.id
  order by (select count(*) from public.matches m where m.user_id = u.id) desc,
           u.created_at;
end;
$$;

revoke execute on function public.admin_player_overview() from public, anon;
grant execute on function public.admin_player_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_player_detail
-- ---------------------------------------------------------------------------
create or replace function public.admin_player_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_start timestamptz := coalesce(
    (select min(e.occurred_at) from public.cost_usage_events e), now());
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'name', public._display_name(u.*),
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'access_source', a.source,
        'used_bytes', coalesce(
          (select sum(l.bytes) from public.storage_ledger l
            where l.user_id = u.id), 0),
        'storage_limit_bytes',
          coalesce(q.storage_limit_bytes, public.default_storage_bytes()),
        'handedness', pp.handedness,
        'grip', pp.grip,
        'style', pp.style
      )
      from auth.users u
      left join public.app_access a on a.user_id = u.id
      left join public.user_quotas q on q.user_id = u.id
      left join public.player_profiles pp on pp.user_id = u.id
      where u.id = p_user_id
    ),
    'engagement', jsonb_build_object(
      'notes', (select count(*) from public.notes n
                 where n.author_id = p_user_id),
      'voice_notes', (select count(*) from public.notes n
                       where n.author_id = p_user_id
                         and n.audio_path is not null),
      'journal_entries', (select count(*) from public.lessons s
                           where s.user_id = p_user_id),
      'tags', (select count(*) from public.tags t
                where t.owner_id = p_user_id),
      'tagged_points', (select count(*) from public.point_tags pt
                         join public.tags t on t.id = pt.tag_id
                        where t.owner_id = p_user_id),
      'share_links', (select count(*) from public.share_links s
                       where s.owner = p_user_id and s.revoked_at is null),
      'coaches', (select count(*) from public.coach_links c
                   where c.player_id = p_user_id and c.status = 'accepted'),
      'recollect_jobs', (select count(*) from public.recollect_jobs j
                          where j.user_id = p_user_id),
      'uploads_failed', (select count(*) from public.jobs j
                          where j.user_id = p_user_id
                            and j.kind in ('deadspace_cut', 'youtube_import')
                            and j.status = 'failed')
    ),
    'est_cost_usd', coalesce(
      (select c.cost_usd
         from public._admin_user_cost_allocation(v_start, now()) c
        where c.user_id = p_user_id), 0),
    'matches', coalesce((
      select jsonb_agg(row_data order by created_at desc)
      from (
        select m.created_at, jsonb_build_object(
          'id', m.id,
          'opponent_name', m.opponent_name,
          'match_type', m.match_type,
          'played_at', m.played_at,
          'created_at', m.created_at,
          'status', m.status,
          'placement_status', m.placement_status,
          'placement_mapped_points', m.placement_mapped_points,
          'has_cut', (m.cut_path is not null
                      or (j.status = 'done' and j.result_path is not null)),
          'src_duration_s', (
            select max(p.t1) from public.points p
             where p.match_id = m.id),
          'cut_duration_s', (
            select max(p.cut_t0 + (p.t1 - p.t0)) from public.points p
             where p.match_id = m.id and p.cut_t0 is not null),
          'points', (
            select count(*) from public.points p
             where p.match_id = m.id and not p.deleted),
          'scored_points', (
            select count(*) from public.points p
             where p.match_id = m.id and not p.deleted
               and p.confirmed_winner is not null),
          -- the library's "unscored" rule: live, not a let, no call yet
          'unscored_points', (
            select count(*) from public.points p
             where p.match_id = m.id and not p.deleted
               and not p.is_let and p.confirmed_winner is null),
          'starred', (
            select count(*) from public.points p
             where p.match_id = m.id and not p.deleted and p.starred),
          'notes', (
            select count(*) from public.notes n
             where n.match_id = m.id),
          'exports', (
            select count(*) from public.match_reels r
             where r.match_id = m.id and r.status = 'ready'),
          'job_status', j.status,
          'job_error', j.error
        ) as row_data
        from public.matches m
        left join public.jobs j on j.id = m.job_id
        where m.user_id = p_user_id
      ) match_rows
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_player_detail(uuid) from public, anon;
grant execute on function public.admin_player_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_match_cut_path
-- ---------------------------------------------------------------------------
create or replace function public.admin_match_cut_path(p_match_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select coalesce(
    m.cut_path,
    (select j.result_path from public.jobs j
      where j.id = m.job_id and j.status = 'done')
  ) into v_path
  from public.matches m
  where m.id = p_match_id;
  return v_path;
end;
$$;

revoke execute on function public.admin_match_cut_path(uuid) from public, anon;
grant execute on function public.admin_match_cut_path(uuid) to authenticated;

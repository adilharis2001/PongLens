-- /admin/players/<id> was failing with "canceling statement due to statement
-- timeout".
--
-- Adding the three-way cost breakdown (measured / shared variable / shared
-- fixed) gave this function four separate calls to
-- _admin_user_cost_allocation, one per number. That function scans every
-- user over the whole cost history and took 2.7 seconds, so the page asked
-- for about 10.6 seconds of work against an 8 second limit and was killed
-- every time.
--
-- Compute it once into a record and read four fields off it.
create or replace function public.admin_player_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_cost record;
  v_start timestamptz := coalesce(
    (select min(e.occurred_at) from public.cost_usage_events e), now());
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  -- Once. Each call scans every user over the whole history.
  select c.attributed_usd, c.variable_usd, c.fixed_usd, c.cost_usd
    into v_cost
    from public._admin_user_cost_allocation(v_start, now()) c
   where c.user_id = p_user_id;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'name', public._display_name(u.*),
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'last_seen_at', public._admin_user_last_seen(u.id),
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
    'est_cost_usd', coalesce(v_cost.cost_usd, 0),
    'cost_measured_usd', coalesce(v_cost.attributed_usd, 0),
    'cost_variable_usd', coalesce(v_cost.variable_usd, 0),
    'cost_fixed_usd', coalesce(v_cost.fixed_usd, 0),
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
            select max(p.t1) from public.active_match_points p
             where p.match_id = m.id),
          'cut_duration_s', (
            select max(p.cut_t0 + (p.t1 - p.t0)) from public.active_match_points p
             where p.match_id = m.id and p.cut_t0 is not null),
          'points', (
            select count(*) from public.active_match_points p
             where p.match_id = m.id and not p.deleted),
          'scored_points', (
            select count(*) from public.active_match_points p
             where p.match_id = m.id and not p.deleted
               and p.confirmed_winner is not null),
          -- the library's "unscored" rule: live, not a let, no call yet
          'unscored_points', (
            select count(*) from public.active_match_points p
             where p.match_id = m.id and not p.deleted
               and not p.is_let and p.confirmed_winner is null),
          'starred', (
            select count(*) from public.active_match_points p
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
$function$;

-- guard: the four-call shape must not come back
do $guard$
begin
  if (select count(*) from regexp_matches(
        pg_get_functiondef('public.admin_player_detail(uuid)'::regprocedure),
        '_admin_user_cost_allocation', 'g')) <> 1 then
    raise exception
      'admin_player_detail must call _admin_user_cost_allocation exactly once';
  end if;
end
$guard$;

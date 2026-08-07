-- 082: the invite gate comes down — PongLens is open to everyone.
--
-- Signing in was always open; past it you needed an app_access row
-- (invite code, coach invite, admin approval, paid order). That whole
-- apparatus goes: the gate tables, their RPCs, the grants sprinkled
-- through other flows, and the admin portal's approval surfaces. What
-- STAYS is the storage quota system — user_quotas, the configurable
-- 5 GB default (app_config.default_storage_bytes) and admin_set_quota —
-- which never depended on the gate.
--
-- The app code stopped reading these objects one deploy before this
-- migration runs; order matters, because the old middleware fails closed
-- (no app_access row -> redirected to the gate).

-- Gate-only RPCs.
drop function if exists public.request_access();
drop function if exists public.admin_access_requests();
drop function if exists public.admin_decide_access(uuid, boolean);
drop function if exists public.redeem_invite(text);
drop function if exists public.admin_create_invite(text, int);
drop function if exists public.admin_invite_codes();

-- Functions that TOUCHED the gate keep their jobs minus the grant /
-- the gate columns (recreated from the live definitions).

-- access_source leaves the overview's return shape, so out with the old.
drop function if exists public.admin_player_overview();

CREATE OR REPLACE FUNCTION public.accept_coach_invite(token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row   public.coach_links%rowtype;
  v_me    uuid := auth.uid();
  v_id    uuid;
  v_name  text;
  v_scope text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.coach_links where invite_token = token;
  if not found then
    raise exception 'invite not found';
  end if;
  if v_row.player_id = v_me then
    raise exception 'cannot accept your own invite';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'invite revoked';
  end if;

  -- Idempotent: re-scanning after acceptance hands back the existing link
  -- rather than piling up duplicate rows in the player's Sharing list.
  select id into v_id
    from public.coach_links
   where player_id = v_row.player_id
     and coach_id = v_me
     and scope_match_id is not distinct from v_row.scope_match_id
     and status = 'accepted'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if v_row.status = 'pending' and v_row.coach_id is null then
    update public.coach_links
       set coach_id = v_me, status = 'accepted'
     where id = v_row.id
    returning id into v_id;
  else
    insert into public.coach_links
      (player_id, coach_id, scope_match_id, status)
    values (v_row.player_id, v_me, v_row.scope_match_id, 'accepted')
    returning id into v_id;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(nullif(btrim(v_name), ''), 'A coach');

  v_scope := case
    when v_row.scope_match_id is null then 'They can see all your matches and leave notes.'
    else 'They can see one match and leave notes.'
  end;

  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_row.player_id, 'coach_joined', v_row.scope_match_id, v_me,
          v_name || ' accepted your coach invite', v_scope,
          coalesce('/match/' || v_row.scope_match_id::text, '/account'));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_coach_page(p_handle text, p_display_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- coach_profiles' own constraints validate: handle format and name
  -- length raise 23514, a taken handle raises 23505. The client maps
  -- those; nothing to re-check here.
  insert into public.coach_profiles (user_id, handle, display_name)
  values (v_me, lower(trim(p_handle)), left(trim(p_display_name), 80));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_portal_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'quota_requests',
      (select count(*) from public.quota_requests r
        where r.status = 'pending'),
    'players',
      (select count(*) from auth.users),
    'matches',
      (select count(*) from public.matches)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_player_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_player_overview()
 RETURNS TABLE(user_id uuid, email text, name text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, used_bytes bigint, storage_limit_bytes bigint, matches integer, matches_scored integer, points integer, starred integer, notes integer, voice_notes integer, journal_entries integer, exports integer, share_links integer, est_cost_usd numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  left join public.user_quotas q on q.user_id = u.id
  left join public._admin_user_cost_allocation(v_start, now())
    c on c.user_id = u.id
  order by (select count(*) from public.matches m where m.user_id = u.id) desc,
           u.created_at;
end;
$function$;

-- And the gate itself. app_access references invite_codes, so it goes
-- first; nothing references access_requests.
drop table public.access_requests;
drop table public.app_access;
drop table public.invite_codes;

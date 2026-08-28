-- 144 — one upload, opened up: everything the pipeline decided about it.
--
-- The players portal could already list a person's uploads and play the
-- cut. What it could not answer is the question that actually comes up:
-- "why does this match look like this?" That answer is spread across a
-- row, a job, a ledger and a JSON file in R2, and until now only the last
-- of those was reachable — by hand, from a script.
--
--  * admin_upload_detail()   — the whole per-match record as one jsonb:
--                              the match row, its owner, the job that made
--                              it, what it cost in minutes and bytes, the
--                              point totals, and every point with both
--                              clocks. One call, because the page is a
--                              server component and a second round trip
--                              buys nothing.
--  * admin_recent_uploads()  — newest uploads across every account, for
--                              the index.
--
-- The table quad, the assembler route and the source probe are NOT here.
-- They live in match.json in R2 (matches.match_json_path) and there is no
-- column for them; the page reads that file server-side. This function
-- returns match_json_path so it can.
--
-- Deleted points are INCLUDED in `points`. The cut file still contains
-- their footage, and judging a cut means seeing what it kept as well as
-- what the player later removed. Callers filter; this does not.
--
-- All three re-check is_admin() inside. The page-level email redirect in
-- requireAdmin() is UX, not the boundary.

-- ---------------------------------------------------------------------------
-- admin_match_raw_path — replaced, because the original could not find the
-- original.
--
-- It inner-joined matches.job_id, which the worker only writes at the
-- points stage. Twenty-six matches have no job_id at all and sixteen of
-- those still have a raw file sitting in R2, so the "Original" button was
-- dead for exactly the uploads an admin most wants to look at: the ones
-- that never finished. matches.raw_path is the authority when it is set,
-- and the job is now found the same way the worker finds it — by the
-- column when it exists, otherwise by the match id the job carries in its
-- own options.
-- ---------------------------------------------------------------------------
create or replace function public.admin_match_raw_path(p_match_id uuid)
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
    m.raw_path,
    (select j.input_path
       from public.jobs j
      where j.id = m.job_id),
    (select j.input_path
       from public.jobs j
      where j.options ->> 'match_id' = m.id::text
      order by j.created_at desc
      limit 1)
  ) into v_path
  from public.matches m
  where m.id = p_match_id;
  return v_path;
end;
$$;

revoke execute on function public.admin_match_raw_path(uuid) from public, anon;
grant execute on function public.admin_match_raw_path(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_upload_detail
-- ---------------------------------------------------------------------------
create or replace function public.admin_upload_detail(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match  public.matches%rowtype;
  v_job    public.jobs%rowtype;
  v_linked text;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    return null;
  end if;

  -- Same two-step the worker uses. job_id is written at the points stage,
  -- so an in-flight, cancelled or failed upload is only reachable through
  -- the match id the job carries in its options.
  if v_match.job_id is not null then
    select * into v_job from public.jobs where id = v_match.job_id;
    if found then
      v_linked := 'job_id';
    end if;
  end if;
  if v_job.id is null then
    select * into v_job
      from public.jobs
     where options ->> 'match_id' = p_match_id::text
     order by created_at desc
     limit 1;
    if found then
      v_linked := 'options';
    end if;
  end if;

  select jsonb_build_object(
    'match', jsonb_build_object(
      'id',                      v_match.id,
      'user_id',                 v_match.user_id,
      'opponent_name',           v_match.opponent_name,
      'match_type',              v_match.match_type,
      'venue',                   v_match.venue,
      'played_at',               v_match.played_at,
      'created_at',              v_match.created_at,
      'status',                  v_match.status,
      'user_side',               v_match.user_side,
      'player_near_name',        v_match.player_near_name,
      'player_far_name',         v_match.player_far_name,
      'first_server',            v_match.first_server,
      'first_server_source',     v_match.first_server_source,
      'clip_pads',               v_match.clip_pads,
      'story_crop',              v_match.story_crop,
      'placement_status',        v_match.placement_status,
      'placement_mapped_points', v_match.placement_mapped_points,
      'placement_failure_code',  v_match.placement_failure_code,
      'placement_flagged',       v_match.placement_flagged,
      'content_checked_at',      v_match.content_checked_at,
      'duration_s',              v_match.duration_s,
      'original_name',           v_match.original_name,
      'match_json_path',         v_match.match_json_path,
      'has_cut',                 (coalesce(
                                    v_match.cut_path,
                                    (select j.result_path from public.jobs j
                                      where j.id = v_match.job_id
                                        and j.status = 'done')
                                  ) is not null),
      'has_thumb',               (v_match.thumb_path is not null),
      -- Mirrors admin_match_raw_path above, so the button's enabled state
      -- and the button's answer cannot disagree.
      'raw_available',           (coalesce(
                                    v_match.raw_path,
                                    (select j.input_path from public.jobs j
                                      where j.id = v_match.job_id),
                                    (select j.input_path from public.jobs j
                                      where j.options ->> 'match_id'
                                            = v_match.id::text
                                      order by j.created_at desc limit 1)
                                  ) is not null)
    ),

    'owner', (
      select jsonb_build_object(
        'user_id', u.id,
        'email',   u.email,
        'name',    coalesce(u.raw_user_meta_data ->> 'full_name',
                            u.raw_user_meta_data ->> 'name')
      )
      from auth.users u where u.id = v_match.user_id
    ),

    'job', case when v_job.id is null then null else jsonb_build_object(
      'id',                  v_job.id,
      'kind',                v_job.kind,
      'status',              v_job.status,
      'progress',            v_job.progress,
      'error',               v_job.error,
      'user_message',        v_job.user_message,
      'created_at',          v_job.created_at,
      'updated_at',          v_job.updated_at,
      'original_name',       v_job.original_name,
      'strictness',          v_job.options ->> 'strictness',
      'placement_requested', coalesce((v_job.options ->> 'placement')::boolean,
                                      false),
      'trim_start_s',        (v_job.options ->> 'trim_start_s')::numeric,
      'trim_end_s',          (v_job.options ->> 'trim_end_s')::numeric,
      'charged_minutes',     (v_job.options ->> 'charged_minutes')::int,
      'funding',             v_job.options ->> 'funding',
      'linked_by',           v_linked
    ) end,

    'spend', jsonb_build_object(
      -- Minutes, never dollars: cost_usage_events carries no match id and
      -- record_cost_usage() refuses metadata that could add one, so a
      -- per-match dollar figure does not exist and must not be invented.
      --
      -- The ledger is SIGNED (096): a spend is stored negative and a refund
      -- positive, so minutes actually charged is the negation of the sum.
      -- Summing it as written reads a 24-minute upload as -24.
      'minutes', -coalesce((
        select sum(l.minutes)
        from public.processing_ledger l where l.match_id = p_match_id), 0),
      'storage_bytes', coalesce((
        select sum(l.bytes)
        from public.storage_ledger l where l.match_id = p_match_id), 0)
    ),

    'totals', (
      select jsonb_build_object(
        'points',        count(*),
        'visible',       count(*) filter (where not p.deleted),
        'deleted',       count(*) filter (where p.deleted),
        'scored',        count(*) filter (where not p.deleted
                                            and p.confirmed_winner is not null),
        'unscored',      count(*) filter (where not p.deleted
                                            and p.confirmed_winner is null
                                            and not p.is_let),
        'skipped',       count(*) filter (where not p.deleted and p.is_let),
        'starred',       count(*) filter (where p.starred),
        'edited',        count(*) filter (where p.edited),
        'with_clip',     count(*) filter (where p.clip_path is not null),
        'with_cut_t0',   count(*) filter (where p.cut_t0 is not null),
        'with_tap',      count(*) filter (where p.scored_at_cut_s is not null),
        'with_rally_end',count(*) filter (where p.rally_end_cut_s is not null),
        'with_placement_ready',
                         count(*) filter (where p.placement ->> 'status'
                                                = 'ready'),
        -- Both timelines from the points themselves. matches.duration_s is
        -- only written on the library path (89 of 156 rows), so max(t1) is
        -- the reading that works on every match.
        'src_duration_s', max(p.t1),
        'cut_duration_s', max(p.cut_t0 + (p.t1 - p.t0))
                            filter (where p.cut_t0 is not null)
      )
      from public.points p where p.match_id = p_match_id
    ),

    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                   p.id,
        'idx',                  p.idx,
        't0',                   p.t0,
        't1',                   p.t1,
        'cut_t0',               p.cut_t0,
        'has_clip',             (p.clip_path is not null),
        'server',               p.server,
        'server_override',      p.server_override,
        'confirmed_winner',     p.confirmed_winner,
        'confirmed_how',        p.confirmed_how,
        'is_let',               p.is_let,
        'deleted',              p.deleted,
        'edited',               p.edited,
        'starred',              p.starred,
        'tight_start',          p.tight_start,
        'tight_end',            p.tight_end,
        'misread_kind',         p.misread_kind,
        'direction',            p.direction,
        'scored_at_cut_s',      p.scored_at_cut_s,
        'serve_start_at_cut_s', p.serve_start_at_cut_s,
        'rally_end_cut_s',      p.rally_end_cut_s,
        'game_end_override',    p.game_end_override,
        'game_winner_override', p.game_winner_override,
        'placement_status',     p.placement ->> 'status',
        'placement_flagged',    p.placement_flagged,
        'notes',                (select count(*) from public.notes n
                                  where n.point_id = p.id)
      ) order by p.t0, p.idx)
      from public.points p where p.match_id = p_match_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_upload_detail(uuid) from public, anon;
grant execute on function public.admin_upload_detail(uuid) to authenticated;

comment on function public.admin_upload_detail(uuid) is
  'Admin-only: one upload as a single jsonb — match, owner, job, spend, '
  'point totals and every point (deleted included). The table quad, the '
  'assembler route and the source probe are not here; they live in '
  'match.json in R2 at the returned match_json_path.';

-- ---------------------------------------------------------------------------
-- admin_recent_uploads — the index
-- ---------------------------------------------------------------------------
create or replace function public.admin_recent_uploads(
  p_limit int default 60,
  p_user_id uuid default null
)
returns table (
  id               uuid,
  user_id          uuid,
  email            text,
  owner_name       text,
  opponent_name    text,
  venue            text,
  status           text,
  created_at       timestamptz,
  played_at        timestamptz,
  points           bigint,
  scored           bigint,
  src_duration_s   numeric,
  cut_duration_s   numeric,
  placement_status text,
  camera           text,
  has_cut          boolean,
  has_table        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select
    m.id,
    m.user_id,
    u.email::text,
    coalesce(u.raw_user_meta_data ->> 'full_name',
             u.raw_user_meta_data ->> 'name'),
    m.opponent_name,
    m.venue,
    m.status,
    m.created_at,
    m.played_at,
    t.points,
    t.scored,
    t.src_duration_s,
    t.cut_duration_s,
    m.placement_status,
    -- side-on / end-on, from the quad's long axis. Null on every
    -- vision-calibrated match as well as every uncalibrated one, so the
    -- reader must render null as "not computed", never as "no table".
    m.story_crop ->> 'camera',
    (m.cut_path is not null),
    (m.match_json_path is not null)
  from public.matches m
  join auth.users u on u.id = m.user_id
  left join lateral (
    -- Cards the OWNER still has, so this number and the detail page's
    -- "Cards" are the same number. Counting deleted ones here read 127
    -- beside the detail page's 105, one tap apart.
    select count(*) filter (where not p.deleted) as points,
           count(*) filter (where p.confirmed_winner is not null
                              and not p.deleted) as scored,
           max(p.t1) as src_duration_s,
           max(p.cut_t0 + (p.t1 - p.t0))
             filter (where p.cut_t0 is not null) as cut_duration_s
    from public.points p where p.match_id = m.id
  ) t on true
  where p_user_id is null or m.user_id = p_user_id
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200));
end;
$$;

revoke execute on function public.admin_recent_uploads(int, uuid)
  from public, anon;
grant execute on function public.admin_recent_uploads(int, uuid)
  to authenticated;

-- Canonical scored-match state, phase 1: additive shadow projection only.
--
-- Existing web, iOS, worker, share, coach, research and export readers keep
-- using their current paths. This migration records one private, revisioned
-- interpretation of owner score facts so parity can be measured before any
-- reader is promoted. Admin full-match research labels remain separate.

-- ---------------------------------------------------------------- revisions

alter table public.matches
  add column if not exists score_revision bigint not null default 0,
  add column if not exists score_projection_revision bigint not null default 0,
  add column if not exists score_projection_status text not null default 'empty'
    check (score_projection_status in ('empty', 'current', 'stale', 'error')),
  add column if not exists score_projection_error text,
  add column if not exists score_projection_updated_at timestamptz;

alter table public.points
  add column if not exists timing_revision bigint not null default 0,
  add column if not exists end_authority text not null default 'automatic'
    check (end_authority in ('automatic', 'manual'));

comment on column public.matches.score_revision is
  'Monotonic revision of owner-authoritative timeline, outcome, game and serve inputs.';
comment on column public.matches.score_projection_revision is
  'score_revision represented by the complete private canonical projection.';
comment on column public.matches.score_projection_error is
  'Sanitized shadow-projector failure for owner/admin diagnostics; never public-share output.';
comment on column public.points.timing_revision is
  'Monotonic revision of this point source window. Outcome-only edits do not increment it.';
comment on column public.points.end_authority is
  'automatic for detector boundaries; manual after an owner explicitly sets a structural end.';

-- ----------------------------------------------------------- private read model

create table if not exists public.match_score_state (
  match_id uuid primary key references public.matches(id) on delete cascade,
  score_revision bigint not null,
  games_user integer not null default 0 check (games_user >= 0),
  games_opponent integer not null default 0 check (games_opponent >= 0),
  current_game_number integer not null default 1 check (current_game_number >= 1),
  current_score_user integer not null default 0 check (current_score_user >= 0),
  current_score_opponent integer not null default 0 check (current_score_opponent >= 0),
  completed_games jsonb not null default '[]'::jsonb
    check (jsonb_typeof(completed_games) = 'array'),
  visible_point_count integer not null default 0 check (visible_point_count >= 0),
  answered_point_count integer not null default 0 check (answered_point_count >= 0),
  skipped_point_count integer not null default 0 check (skipped_point_count >= 0),
  all_visible_points_answered boolean not null default false,
  first_server text check (first_server in ('user', 'opponent')),
  first_server_source text check (first_server_source = 'user'),
  ordering text not null check (ordering in ('source_time', 'legacy_idx')),
  computed_at timestamptz not null default now()
);

create table if not exists public.point_score_state (
  point_id uuid primary key references public.points(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  score_revision bigint not null,
  timeline_ordinal integer not null check (timeline_ordinal >= 0),
  display_number integer not null check (display_number >= 1),
  game_number integer not null check (game_number >= 1),
  score_user_before integer not null check (score_user_before >= 0),
  score_opponent_before integer not null check (score_opponent_before >= 0),
  score_user_after integer not null check (score_user_after >= 0),
  score_opponent_after integer not null check (score_opponent_after >= 0),
  confirmed_winner text check (confirmed_winner in ('user', 'opponent')),
  skip_kind text check (skip_kind in ('let', 'misrecorded', 'other')),
  resolved_server text check (resolved_server in ('user', 'opponent')),
  server_source text not null
    check (server_source in ('rotation', 'owner_override', 'unresolved')),
  serve_number_in_block integer check (serve_number_in_block in (1, 2)),
  ends_game boolean not null default false,
  game_boundary_source text
    check (game_boundary_source in ('automatic_score', 'owner_end_override')),
  resolved_game_winner text
    check (resolved_game_winner in ('user', 'opponent')),
  all_visible_points_answered_through_here boolean not null,
  computed_at timestamptz not null default now(),
  unique (match_id, timeline_ordinal),
  unique (match_id, display_number),
  unique (match_id, point_id)
);

create index if not exists point_score_state_match_revision_idx
  on public.point_score_state(match_id, score_revision);

-- --------------------------------------------------------- timing observations

create table if not exists public.point_timing_observations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  point_id uuid references public.points(id) on delete set null,
  kind text not null check (kind in ('serve_start', 'point_end')),
  source_s numeric not null check (source_s >= 0),
  origin text not null check (origin in (
    'manual_cutter', 'continuous_first_score', 'legacy_cut_tap',
    'worker_rally_end'
  )),
  authority_scope text not null check (authority_scope in (
    'owner_manual_boundary', 'owner_live_observation', 'worker_evidence'
  )),
  timing_revision bigint not null check (timing_revision >= 0),
  media_kind text not null check (media_kind in ('source', 'cut', 'point_clip')),
  media_revision uuid,
  media_local_s numeric check (media_local_s is null or media_local_s >= 0),
  reaction_meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reaction_meta) = 'object'),
  eligible_for_training boolean not null default false,
  eligible_for_playback boolean not null default false,
  invalidated_at timestamptz,
  invalidated_reason text,
  request_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (point_id, kind, origin, timing_revision)
);

create index if not exists point_timing_observations_match_idx
  on public.point_timing_observations(match_id, point_id, kind);

comment on table public.point_timing_observations is
  'Point-linked timing evidence normalized onto source seconds. Manual-cutter t0/t1 are high-authority owner observations; admin fullmatch_labels stay separate.';

-- -------------------------------------------------------------- audit ledger

create table if not exists public.match_score_mutations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  match_id uuid not null references public.matches(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  authority_scope text not null check (authority_scope = 'owner_score'),
  action text not null check (action in (
    'set_point_outcome', 'set_first_server', 'set_server_override',
    'set_game_boundary', 'split_point', 'unsplit_point', 'merge_points',
    'adjust_point', 'insert_point', 'set_point_visibility',
    'publish_hand_cut', 'replace_worker_points'
  )),
  affected_point_ids uuid[] not null default '{}',
  before_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(after_state) = 'object'),
  base_revision bigint not null check (base_revision >= 0),
  result_revision bigint not null check (result_revision > base_revision),
  created_at timestamptz not null default now()
);

create index if not exists match_score_mutations_match_revision_idx
  on public.match_score_mutations(match_id, result_revision);

-- Private by default. Authenticated users receive narrow SELECT only after
-- RLS; no client role can insert, update or delete projection/evidence rows.
alter table public.point_score_state enable row level security;
alter table public.match_score_state enable row level security;
alter table public.point_timing_observations enable row level security;
alter table public.match_score_mutations enable row level security;

revoke all on table public.point_score_state from public, anon, authenticated;
revoke all on table public.match_score_state from public, anon, authenticated;
revoke all on table public.point_timing_observations from public, anon, authenticated;
revoke all on table public.match_score_mutations from public, anon, authenticated;

drop policy if exists point_score_state_match_access on public.point_score_state;
create policy point_score_state_match_access on public.point_score_state
  for select to authenticated using (public.has_match_access(match_id));

drop policy if exists match_score_state_match_access on public.match_score_state;
create policy match_score_state_match_access on public.match_score_state
  for select to authenticated using (public.has_match_access(match_id));

drop policy if exists point_timing_observations_owner_admin on public.point_timing_observations;
create policy point_timing_observations_owner_admin on public.point_timing_observations
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.matches m
       where m.id = point_timing_observations.match_id
         and m.user_id = (select auth.uid())
    )
  );

drop policy if exists match_score_mutations_owner_admin on public.match_score_mutations;
create policy match_score_mutations_owner_admin on public.match_score_mutations
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.matches m
       where m.id = match_score_mutations.match_id
         and m.user_id = (select auth.uid())
    )
  );

grant select on table public.point_score_state, public.match_score_state to authenticated;
grant select on table public.point_timing_observations, public.match_score_mutations to authenticated;

-- -------------------------------------------------------- canonical projector

create or replace function public.refresh_match_score_state(p_match_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_point record;
  v_revision bigint;
  v_computed_at timestamptz := clock_timestamp();
  v_source_order boolean;
  v_ordinal integer := 0;
  v_score_user integer := 0;
  v_score_opponent integer := 0;
  v_games_user integer := 0;
  v_games_opponent integer := 0;
  v_game_number integer := 1;
  v_answered integer := 0;
  v_skipped_count integer := 0;
  v_answered_through boolean := true;
  v_game_open boolean := false;
  v_first_server text;
  v_current_server text;
  v_game_first_server text;
  v_serves_in_block integer := 0;
  v_winner text;
  v_skip_kind text;
  v_score_user_before integer;
  v_score_opponent_before integer;
  v_server_for_point text;
  v_server_source text;
  v_serve_number integer;
  v_ends_game boolean;
  v_boundary_source text;
  v_automatic_winner text;
  v_resolved_game_winner text;
  v_completed_games jsonb := '[]'::jsonb;
begin
  select m.id, m.score_revision, m.first_server, m.first_server_source,
         m.active_processing_version_id
    into v_match
    from public.matches m
   where m.id = p_match_id
   for update;
  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;

  v_revision := v_match.score_revision;
  v_first_server := case when v_match.first_server_source = 'user'
                         then v_match.first_server end;
  v_current_server := v_first_server;
  v_game_first_server := v_first_server;

  select not exists (
    select 1 from public.points p
     where p.match_id = p_match_id
       and p.processing_version_id = v_match.active_processing_version_id
       and not p.deleted
       and p.t0 is null
  ) into v_source_order;

  delete from public.point_score_state where match_id = p_match_id;

  for v_point in
    select p.*
      from public.points p
     where p.match_id = p_match_id
       and p.processing_version_id = v_match.active_processing_version_id
       and not p.deleted
     order by
       case when v_source_order then p.t0 end nulls last,
       p.idx,
       p.id
  loop
    v_skip_kind := case when v_point.is_let then
      case when v_point.confirmed_how in ('misrecorded', 'other')
           then v_point.confirmed_how else 'let' end
      else null end;
    v_winner := case when v_point.is_let then null
                     else v_point.confirmed_winner end;
    v_answered_through := v_answered_through
      and (v_point.is_let or v_winner is not null);
    if v_point.is_let then
      v_skipped_count := v_skipped_count + 1;
    elsif v_winner is not null then
      v_answered := v_answered + 1;
    end if;

    if v_point.server_override is not null then
      if v_current_server is null
         or v_point.server_override is distinct from v_current_server then
        if v_current_server is not null and v_game_first_server is not null then
          v_game_first_server := case when v_game_first_server = 'user'
            then 'opponent' else 'user' end;
        end if;
        v_serves_in_block := 0;
      end if;
      v_current_server := v_point.server_override;
      if v_game_first_server is null then
        v_game_first_server := v_current_server;
      end if;
    end if;

    v_server_for_point := v_current_server;
    v_server_source := case
      when v_point.server_override is not null then 'owner_override'
      when v_server_for_point is not null then 'rotation'
      else 'unresolved' end;
    v_serve_number := case when v_server_for_point is not null
                           then v_serves_in_block + 1 end;

    v_score_user_before := v_score_user;
    v_score_opponent_before := v_score_opponent;
    if v_winner = 'user' then
      v_score_user := v_score_user + 1;
    elsif v_winner = 'opponent' then
      v_score_opponent := v_score_opponent + 1;
    end if;

    v_ends_game := false;
    v_boundary_source := null;
    if v_point.game_end_override = 'end' then
      v_ends_game := true;
      v_boundary_source := 'owner_end_override';
    elsif v_point.game_end_override = 'continue' then
      v_game_open := true;
    elsif not v_game_open and v_winner is not null
      and greatest(v_score_user, v_score_opponent) >= 11
      and abs(v_score_user - v_score_opponent) >= 2 then
      v_ends_game := true;
      v_boundary_source := 'automatic_score';
    end if;

    v_automatic_winner := case
      when greatest(v_score_user, v_score_opponent) >= 11
       and abs(v_score_user - v_score_opponent) >= 2
      then case when v_score_user > v_score_opponent then 'user'
                else 'opponent' end
      else null end;
    v_resolved_game_winner := case when v_ends_game
      then coalesce(v_point.game_winner_override, v_automatic_winner)
      else null end;

    insert into public.point_score_state (
      point_id, match_id, score_revision, timeline_ordinal, display_number,
      game_number, score_user_before, score_opponent_before,
      score_user_after, score_opponent_after, confirmed_winner, skip_kind,
      resolved_server, server_source, serve_number_in_block, ends_game,
      game_boundary_source, resolved_game_winner,
      all_visible_points_answered_through_here, computed_at
    ) values (
      v_point.id, p_match_id, v_revision, v_ordinal, v_ordinal + 1,
      v_game_number, v_score_user_before, v_score_opponent_before,
      v_score_user, v_score_opponent, v_winner, v_skip_kind,
      v_server_for_point, v_server_source, v_serve_number, v_ends_game,
      v_boundary_source, v_resolved_game_winner,
      v_answered_through, v_computed_at
    );

    if not v_point.is_let then
      v_serves_in_block := v_serves_in_block + 1;
      if v_current_server is not null and
         v_serves_in_block >= (case
           when v_score_user >= 10 and v_score_opponent >= 10 then 1 else 2
         end) then
        v_current_server := case when v_current_server = 'user'
          then 'opponent' else 'user' end;
        v_serves_in_block := 0;
      end if;
    end if;

    if v_ends_game then
      v_completed_games := v_completed_games || jsonb_build_array(
        jsonb_build_object(
          'gameNumber', v_game_number,
          'scoreUser', v_score_user,
          'scoreOpponent', v_score_opponent,
          'winner', v_resolved_game_winner,
          'closingPointId', v_point.id,
          'boundarySource', v_boundary_source
        )
      );
      if v_resolved_game_winner = 'user' then
        v_games_user := v_games_user + 1;
      elsif v_resolved_game_winner = 'opponent' then
        v_games_opponent := v_games_opponent + 1;
      end if;
      v_score_user := 0;
      v_score_opponent := 0;
      v_game_number := v_game_number + 1;
      v_game_open := false;
      v_serves_in_block := 0;
      if v_game_first_server is not null then
        v_game_first_server := case when v_game_first_server = 'user'
          then 'opponent' else 'user' end;
        v_current_server := v_game_first_server;
      end if;
    end if;
    v_ordinal := v_ordinal + 1;
  end loop;

  insert into public.match_score_state (
    match_id, score_revision, games_user, games_opponent,
    current_game_number, current_score_user, current_score_opponent,
    completed_games, visible_point_count, answered_point_count,
    skipped_point_count, all_visible_points_answered,
    first_server, first_server_source, ordering, computed_at
  ) values (
    p_match_id, v_revision, v_games_user, v_games_opponent,
    v_game_number, v_score_user, v_score_opponent,
    v_completed_games, v_ordinal, v_answered, v_skipped_count,
    v_ordinal > 0 and v_answered + v_skipped_count = v_ordinal,
    v_first_server, case when v_first_server is not null then 'user' end,
    case when v_source_order then 'source_time' else 'legacy_idx' end,
    v_computed_at
  ) on conflict (match_id) do update set
    score_revision = excluded.score_revision,
    games_user = excluded.games_user,
    games_opponent = excluded.games_opponent,
    current_game_number = excluded.current_game_number,
    current_score_user = excluded.current_score_user,
    current_score_opponent = excluded.current_score_opponent,
    completed_games = excluded.completed_games,
    visible_point_count = excluded.visible_point_count,
    answered_point_count = excluded.answered_point_count,
    skipped_point_count = excluded.skipped_point_count,
    all_visible_points_answered = excluded.all_visible_points_answered,
    first_server = excluded.first_server,
    first_server_source = excluded.first_server_source,
    ordering = excluded.ordering,
    computed_at = excluded.computed_at;

  update public.matches
     set score_projection_revision = v_revision,
         score_projection_status = case when v_ordinal = 0 then 'empty'
                                        else 'current' end,
         score_projection_error = null,
         score_projection_updated_at = v_computed_at
   where id = p_match_id;
  return v_revision;
end;
$$;

revoke all on function public.refresh_match_score_state(uuid) from public, anon, authenticated;

-- ---------------------------------------------- manual-cutter normalization

create or replace function public.normalize_manual_cut_observations(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair record;
  v_match record;
  v_mark_count integer;
  v_point_count integer;
  v_written integer := 0;
begin
  select m.id, m.user_id, m.cut_source, m.active_processing_version_id,
         d.marks
    into v_match
    from public.matches m
    join public.hand_cut_drafts d on d.match_id = m.id
   where m.id = p_match_id
   for update of m;
  if not found or v_match.cut_source <> 'manual' then
    raise exception 'manual cut source not found' using errcode = 'P0002';
  end if;

  select count(*) into v_mark_count
    from jsonb_array_elements(v_match.marks) as entries(mark)
   where mark->>'t0' is not null and mark->>'t1' is not null;
  select count(*) into v_point_count
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = v_match.active_processing_version_id
     and not p.deleted;
  if v_mark_count = 0 or v_mark_count <> v_point_count then
    raise exception 'manual cut mark/point count mismatch' using errcode = '23514';
  end if;

  for v_pair in
    with marks as (
      select row_number() over (order by (mark->>'t0')::numeric) as ordinal,
             mark
        from jsonb_array_elements(v_match.marks) as entries(mark)
       where mark->>'t0' is not null and mark->>'t1' is not null
    ), active_points as (
      select row_number() over (order by p.t0, p.idx, p.id) as ordinal,
             p.*
        from public.points p
       where p.match_id = p_match_id
         and p.processing_version_id = v_match.active_processing_version_id
         and not p.deleted
    )
    select p.id as point_id, p.t0, p.t1, p.timing_revision,
           m.mark
      from marks m join active_points p using (ordinal)
     order by m.ordinal
  loop
    if abs(v_pair.t0 - (v_pair.mark->>'t0')::numeric) > 0.06
       or abs(v_pair.t1 - (v_pair.mark->>'t1')::numeric) > 0.06 then
      raise exception 'manual cut mark/point timing mismatch' using errcode = '23514';
    end if;

    insert into public.point_timing_observations (
      match_id, point_id, kind, source_s, origin, authority_scope,
      timing_revision, media_kind, media_revision, media_local_s,
      reaction_meta, eligible_for_training, eligible_for_playback, created_by
    ) values (
      p_match_id, v_pair.point_id, 'serve_start',
      (v_pair.mark->>'t0')::numeric, 'manual_cutter',
      'owner_manual_boundary', v_pair.timing_revision, 'source',
      v_match.active_processing_version_id, (v_pair.mark->>'t0')::numeric,
      jsonb_build_object(
        'raw_start_tap_s', (v_pair.mark->>'tap')::numeric,
        'playback_rate', (v_pair.mark->>'rate')::numeric,
        'applied_lead_s', (v_pair.mark->>'tap')::numeric -
                          (v_pair.mark->>'t0')::numeric
      ), true, true, v_match.user_id
    ) on conflict (point_id, kind, origin, timing_revision) do update set
      source_s = excluded.source_s,
      media_revision = excluded.media_revision,
      media_local_s = excluded.media_local_s,
      reaction_meta = excluded.reaction_meta,
      invalidated_at = null,
      invalidated_reason = null;
    v_written := v_written + 1;

    insert into public.point_timing_observations (
      match_id, point_id, kind, source_s, origin, authority_scope,
      timing_revision, media_kind, media_revision, media_local_s,
      reaction_meta, eligible_for_training, eligible_for_playback, created_by
    ) values (
      p_match_id, v_pair.point_id, 'point_end',
      (v_pair.mark->>'t1')::numeric, 'manual_cutter',
      'owner_manual_boundary', v_pair.timing_revision, 'source',
      v_match.active_processing_version_id, (v_pair.mark->>'t1')::numeric,
      jsonb_build_object(
        'raw_end_tap_s', (v_pair.mark->>'t1')::numeric,
        'playback_rate', (v_pair.mark->>'rate')::numeric,
        'post_padding_policy', 'structural_manual'
      ), true, true, v_match.user_id
    ) on conflict (point_id, kind, origin, timing_revision) do update set
      source_s = excluded.source_s,
      media_revision = excluded.media_revision,
      media_local_s = excluded.media_local_s,
      reaction_meta = excluded.reaction_meta,
      invalidated_at = null,
      invalidated_reason = null;
    v_written := v_written + 1;
  end loop;
  return v_written;
end;
$$;

revoke all on function public.normalize_manual_cut_observations(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------- shadow triggers

create or replace function public.bump_point_timing_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.t0 is distinct from old.t0
     or new.t1 is distinct from old.t1
     or new.cut_t0 is distinct from old.cut_t0
     or new.tight_start is distinct from old.tight_start
     or new.tight_end is distinct from old.tight_end then
    new.timing_revision := old.timing_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists points_bump_timing_revision on public.points;
create trigger points_bump_timing_revision
  before update of t0, t1, cut_t0, tight_start, tight_end on public.points
  for each row execute function public.bump_point_timing_revision();

create or replace function public.mark_match_score_stale_from_point()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid := case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  v_version_id uuid := case when tg_op = 'DELETE' then old.processing_version_id
                            else new.processing_version_id end;
begin
  if not exists (
    select 1 from public.matches m
     where m.id = v_match_id
       and m.active_processing_version_id = v_version_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and not (
    new.confirmed_winner is distinct from old.confirmed_winner or
    new.confirmed_how is distinct from old.confirmed_how or
    new.is_let is distinct from old.is_let or
    new.server_override is distinct from old.server_override or
    new.game_end_override is distinct from old.game_end_override or
    new.game_winner_override is distinct from old.game_winner_override or
    new.t0 is distinct from old.t0 or new.t1 is distinct from old.t1 or
    new.deleted is distinct from old.deleted or new.idx is distinct from old.idx
  ) then
    return new;
  end if;

  update public.matches
     set score_revision = score_revision + 1,
         score_projection_status = 'stale',
         score_projection_error = null
   where id = v_match_id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.mark_match_score_stale_from_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.first_server is not distinct from old.first_server
     and new.first_server_source is not distinct from old.first_server_source
     and new.active_processing_version_id is not distinct from old.active_processing_version_id then
    return new;
  end if;
  update public.matches
     set score_revision = score_revision + 1,
         score_projection_status = 'stale',
         score_projection_error = null
   where id = new.id;
  return new;
end;
$$;

create or replace function public.refresh_stale_match_score_shadow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid := case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  v_score_revision bigint;
  v_projection_revision bigint;
begin
  select score_revision, score_projection_revision
    into v_score_revision, v_projection_revision
    from public.matches where id = v_match_id;
  if not found or v_score_revision = v_projection_revision then
    return null;
  end if;
  begin
    perform public.refresh_match_score_state(v_match_id);
  exception when others then
    update public.matches
       set score_projection_status = 'error',
           score_projection_error = left(sqlerrm, 500),
           score_projection_updated_at = clock_timestamp()
     where id = v_match_id;
  end;
  return null;
end;
$$;

create or replace function public.refresh_match_score_shadow_now()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.refresh_match_score_state(new.id);
  exception when others then
    update public.matches
       set score_projection_status = 'error',
           score_projection_error = left(sqlerrm, 500),
           score_projection_updated_at = clock_timestamp()
     where id = new.id;
  end;
  return null;
end;
$$;

drop trigger if exists point_score_input_update_revision on public.points;
create trigger point_score_input_update_revision
  after update of confirmed_winner, confirmed_how, is_let, server_override,
    game_end_override, game_winner_override, t0, t1, deleted, idx
  on public.points for each row
  execute function public.mark_match_score_stale_from_point();

drop trigger if exists point_score_input_insert_delete_revision on public.points;
create trigger point_score_input_insert_delete_revision
  after insert or delete on public.points for each row
  execute function public.mark_match_score_stale_from_point();

-- Deferred refresh coalesces a transaction that inserts/updates many points:
-- the first queued trigger projects the latest revision; later queued calls
-- observe equality and return without re-folding the match.
drop trigger if exists point_score_shadow_refresh on public.points;
create constraint trigger point_score_shadow_refresh
  after insert or update or delete on public.points
  deferrable initially deferred for each row
  execute function public.refresh_stale_match_score_shadow();

drop trigger if exists match_score_input_revision on public.matches;
create trigger match_score_input_revision
  after update of first_server, first_server_source, active_processing_version_id
  on public.matches for each row
  execute function public.mark_match_score_stale_from_match();

drop trigger if exists match_score_shadow_refresh on public.matches;
create trigger match_score_shadow_refresh
  after update of first_server, first_server_source, active_processing_version_id
  on public.matches for each row
  execute function public.refresh_match_score_shadow_now();

revoke all on function public.bump_point_timing_revision() from public, anon, authenticated;
revoke all on function public.mark_match_score_stale_from_point() from public, anon, authenticated;
revoke all on function public.mark_match_score_stale_from_match() from public, anon, authenticated;
revoke all on function public.refresh_stale_match_score_shadow() from public, anon, authenticated;
revoke all on function public.refresh_match_score_shadow_now() from public, anon, authenticated;

-- Backfill every active match once. A single bad historical row is recorded
-- for diagnosis and does not block the migration or any legacy reader.
do $$
declare
  v_match_id uuid;
begin
  for v_match_id in select id from public.matches order by created_at loop
    begin
      perform public.refresh_match_score_state(v_match_id);
    exception when others then
      update public.matches
         set score_projection_status = 'error',
             score_projection_error = left(sqlerrm, 500),
             score_projection_updated_at = clock_timestamp()
       where id = v_match_id;
    end;
  end loop;
end;
$$;

-- Existing completed manual cuts already contain the strongest source-clock
-- boundaries. Normalize the rows that can be matched exactly; keep a bad
-- historical draft from blocking unrelated matches or the schema rollout.
do $$
declare
  v_match_id uuid;
begin
  for v_match_id in
    select m.id
      from public.matches m
      join public.hand_cut_drafts d on d.match_id = m.id
     where m.cut_source = 'manual'
     order by m.created_at
  loop
    begin
      perform public.normalize_manual_cut_observations(v_match_id);
    exception when others then
      raise warning 'manual observation backfill skipped match %: %',
        v_match_id, left(sqlerrm, 300);
    end;
  end loop;
end;
$$;

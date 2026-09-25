-- What supabase/tests/marker_game_ends.sql needs on top of the cut-again
-- test chain: the REAL canonical score projection, so the test can show a
-- published cut's games, not only its point rows. The two read-model
-- tables, refresh_match_score_state, mark_match_score_stale_from_point and
-- the point update trigger are production's, copied from
-- 20260915190000_canonical_scored_match_state.sql (the only migration that
-- defines them; production's pg_get_functiondef of refresh_match_score_state
-- matched it on 2026-09-25). They replace the chain's stand-in projection,
-- so this file loads AFTER cut_again.sql and cut_again_auto.sql, which
-- are written against the stand-in. The two check constraints are
-- production's too.
--
--   docker run -d --name marker-ends-pg -e POSTGRES_PASSWORD=x postgres:17-alpine
--   for f in supabase/tests/device_hand_cut_stubs.sql \
--            supabase/migrations/20260925061009_device_hand_cut.sql \
--            supabase/migrations/20260925105830_device_hand_cut_silent_handoff.sql \
--            supabase/tests/cut_again_stubs.sql \
--            supabase/migrations/20260925124616_cut_again.sql \
--            supabase/migrations/20260925133555_recut_prefill_is_not_a_draft.sql \
--            supabase/migrations/20260925133639_recut_prefill_guard_definer.sql \
--            supabase/tests/cut_again_auto_stubs.sql \
--            supabase/migrations/20260925170532_cut_again_auto_replace.sql \
--            supabase/migrations/20260925184230_marker_game_ends.sql \
--            supabase/tests/cut_again.sql \
--            supabase/tests/cut_again_auto.sql \
--            supabase/tests/marker_game_ends_stubs.sql \
--            supabase/tests/marker_game_ends.sql; do
--     docker exec -i marker-ends-pg psql -q -v ON_ERROR_STOP=1 -U postgres < "$f"
--   done
--   docker rm -f marker-ends-pg
\set ON_ERROR_STOP on

alter table public.points
  add constraint points_game_end_override_check
    check (game_end_override = any (array['end'::text, 'continue'::text])),
  add constraint points_game_winner_override_check
    check (game_winner_override = any (array['user'::text, 'opponent'::text]));

-- ----------------------------------------------- the private read model
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

-- ----------------------------------------------------- the projection
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

drop trigger if exists point_score_input_update_revision on public.points;
create trigger point_score_input_update_revision
  after update of confirmed_winner, confirmed_how, is_let, server_override,
    game_end_override, game_winner_override, t0, t1, deleted, idx
  on public.points
  for each row execute function public.mark_match_score_stale_from_point();

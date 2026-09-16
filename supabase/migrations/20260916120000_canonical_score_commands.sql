-- Canonical scored-match state, phase 2: command kernel and typed commands.
--
-- This migration does not switch a reader or an owner write path. It adds
-- the private rollout capability, a revision-consistent snapshot builder and
-- the shared authorization/locking/idempotency boundary used by typed v2
-- commands in later definitions. The switch defaults off.

insert into public.app_config (key, value)
values ('canonical_score_commands', 'off')
on conflict (key) do nothing;

create or replace function public.canonical_score_commands_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and (
    public.is_admin() or exists (
      select 1
        from public.app_config c
       where c.key = 'canonical_score_commands'
         and (
           c.value = 'on'
           or c.value = 'user:' || (select auth.uid())::text
           or (
             c.value like 'users:%'
             and (select auth.uid())::text = any(string_to_array(
               replace(substr(c.value, 7), ' ', ''), ','
             ))
           )
         )
    )
  );
$$;

revoke all on function public.canonical_score_commands_enabled()
  from public, anon, authenticated;
grant execute on function public.canonical_score_commands_enabled()
  to authenticated;

create or replace function public._canonical_score_snapshot(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_summary public.match_score_state%rowtype;
  v_points jsonb;
begin
  select * into v_match
    from public.matches
   where id = p_match_id;
  if not found then
    raise exception 'canonical match not found' using errcode = 'P0002';
  end if;

  if v_match.score_revision is distinct from v_match.score_projection_revision
     or v_match.score_projection_status not in ('current', 'empty') then
    perform public.refresh_match_score_state(p_match_id);
    select * into v_match from public.matches where id = p_match_id;
  end if;

  select * into v_summary
    from public.match_score_state
   where match_id = p_match_id
     and score_revision = v_match.score_revision;
  if not found then
    raise exception 'canonical score summary unavailable' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', s.point_id,
           'revision', s.score_revision,
           'timelineOrdinal', s.timeline_ordinal,
           'displayNumber', s.display_number,
           'gameNumber', s.game_number,
           'scoreUserBefore', s.score_user_before,
           'scoreOpponentBefore', s.score_opponent_before,
           'scoreUserAfter', s.score_user_after,
           'scoreOpponentAfter', s.score_opponent_after,
           'confirmedWinner', s.confirmed_winner,
           'skipKind', s.skip_kind,
           'resolvedServer', s.resolved_server,
           'serverSource', s.server_source,
           'serveNumberInBlock', s.serve_number_in_block,
           'endsGame', s.ends_game,
           'gameBoundarySource', s.game_boundary_source,
           'resolvedGameWinner', s.resolved_game_winner,
           'allVisiblePointsAnsweredThroughHere',
             s.all_visible_points_answered_through_here
         ) order by s.timeline_ordinal), '[]'::jsonb)
    into v_points
    from public.point_score_state s
   where s.match_id = p_match_id
     and s.score_revision = v_match.score_revision;

  if jsonb_array_length(v_points) <> v_summary.visible_point_count then
    raise exception 'canonical score snapshot is mixed or incomplete'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'matchId', p_match_id,
    'revision', v_match.score_revision,
    'status', v_match.score_projection_status,
    'match', jsonb_build_object(
      'gamesUser', v_summary.games_user,
      'gamesOpponent', v_summary.games_opponent,
      'currentGameNumber', v_summary.current_game_number,
      'currentScoreUser', v_summary.current_score_user,
      'currentScoreOpponent', v_summary.current_score_opponent,
      'completedGames', v_summary.completed_games,
      'visiblePointCount', v_summary.visible_point_count,
      'answeredPointCount', v_summary.answered_point_count,
      'skippedPointCount', v_summary.skipped_point_count,
      'allVisiblePointsAnswered', v_summary.all_visible_points_answered,
      'firstServer', v_summary.first_server,
      'firstServerSource', v_summary.first_server_source,
      'ordering', v_summary.ordering
    ),
    'points', v_points
  );
end;
$$;

revoke all on function public._canonical_score_snapshot(uuid)
  from public, anon, authenticated;

create or replace function public._canonical_score_command_context(
  p_match_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_match public.matches%rowtype;
  v_prior public.match_score_mutations%rowtype;
  v_snapshot jsonb;
begin
  if v_me is null then
    return jsonb_build_object(
      'state', 'invalid',
      'response', jsonb_build_object('ok', false, 'code', 'not_owner')
    );
  end if;
  if p_match_id is null or p_request_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or nullif(trim(p_action), '') is null then
    return jsonb_build_object(
      'state', 'invalid',
      'response', jsonb_build_object('ok', false, 'code', 'invalid_input')
    );
  end if;

  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    return jsonb_build_object(
      'state', 'invalid',
      'response', jsonb_build_object('ok', false, 'code', 'not_found')
    );
  end if;
  if v_match.user_id is distinct from v_me then
    return jsonb_build_object(
      'state', 'invalid',
      'response', jsonb_build_object('ok', false, 'code', 'not_owner')
    );
  end if;

  select * into v_prior
    from public.match_score_mutations
   where request_id = p_request_id;
  if found then
    if v_prior.match_id = p_match_id and v_prior.action = p_action then
      return jsonb_build_object(
        'state', 'duplicate',
        'response', v_prior.after_state
      );
    end if;
    return jsonb_build_object(
      'state', 'invalid',
      'response', jsonb_build_object('ok', false, 'code', 'invalid_input')
    );
  end if;

  if not public.canonical_score_commands_enabled() then
    return jsonb_build_object(
      'state', 'invalid',
      'response', jsonb_build_object('ok', false, 'code', 'not_enabled')
    );
  end if;

  if v_match.score_revision <> p_expected_revision then
    v_snapshot := public._canonical_score_snapshot(p_match_id);
    return jsonb_build_object(
      'state', 'score_conflict',
      'response', jsonb_build_object(
        'ok', false,
        'code', 'score_conflict',
        'revision', v_match.score_revision,
        'snapshot', v_snapshot
      )
    );
  end if;

  return jsonb_build_object(
    'state', 'new',
    'matchId', p_match_id,
    'baseRevision', v_match.score_revision
  );
end;
$$;

revoke all on function public._canonical_score_command_context(uuid,uuid,bigint,text)
  from public, anon, authenticated;

-- Match-owned fields use an immediate compatibility shadow trigger. Atomic
-- commands already refresh fail-closed in their finalizer, so suppress only
-- that redundant in-command refresh. Legacy writes keep the original path.
create or replace function public.refresh_match_score_shadow_now()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('ponglens.atomic_score_command', true) = 'on' then
    return null;
  end if;
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

revoke all on function public.refresh_match_score_shadow_now()
  from public, anon, authenticated;

-- A command owns the match lock before it reaches this helper. A logical
-- no-op still advances the command revision so it can be recorded and retried
-- with the same idempotency guarantees as a value-changing command.
create or replace function public._canonical_score_finish_command(
  p_match_id uuid,
  p_request_id uuid,
  p_action text,
  p_base_revision bigint,
  p_affected_point_ids uuid[],
  p_before_state jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result_revision bigint;
  v_snapshot jsonb;
  v_response jsonb;
begin
  select score_revision into v_result_revision
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'canonical match disappeared' using errcode = 'P0002';
  end if;

  if v_result_revision = p_base_revision then
    update public.matches
       set score_revision = score_revision + 1,
           score_projection_status = 'stale',
           score_projection_error = null
     where id = p_match_id
     returning score_revision into v_result_revision;
  elsif v_result_revision < p_base_revision then
    raise exception 'canonical score revision moved backwards';
  end if;

  -- Unlike compatibility writes, a v2 command is fail-closed. Any projector
  -- error escapes this helper and rolls back the raw mutation and ledger row.
  perform public.refresh_match_score_state(p_match_id);
  v_snapshot := public._canonical_score_snapshot(p_match_id);
  v_result_revision := (v_snapshot ->> 'revision')::bigint;
  v_response := jsonb_build_object(
    'ok', true,
    'requestId', p_request_id,
    'revision', v_result_revision,
    'snapshot', v_snapshot,
    'payload', coalesce(p_payload, '{}'::jsonb)
  );

  insert into public.match_score_mutations(
    request_id, match_id, actor_id, authority_scope, action,
    affected_point_ids, before_state, after_state,
    base_revision, result_revision
  ) values (
    p_request_id, p_match_id, (select auth.uid()), 'owner_score', p_action,
    coalesce(p_affected_point_ids, '{}'::uuid[]),
    coalesce(p_before_state, '{}'::jsonb), v_response,
    p_base_revision, v_result_revision
  );
  return v_response;
end;
$$;

revoke all on function public._canonical_score_finish_command(
  uuid,uuid,text,bigint,uuid[],jsonb,jsonb
) from public, anon, authenticated;

create or replace function public.set_point_outcome_v2(
  p_match_id uuid,
  p_point_id uuid,
  p_outcome text,
  p_request_id uuid,
  p_expected_revision bigint,
  p_confirmed_how text default null,
  p_scored_at_cut_s numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb;
  v_point public.points%rowtype;
  v_after jsonb;
begin
  v_context := public._canonical_score_command_context(
    p_match_id, p_request_id, p_expected_revision, 'set_point_outcome'
  );
  if v_context ->> 'state' <> 'new' then
    return v_context -> 'response';
  end if;

  if p_outcome not in ('user', 'opponent', 'let', 'misrecorded', 'other', 'clear')
     or p_point_id is null
     or (p_scored_at_cut_s is not null and p_scored_at_cut_s < 0)
     or (p_outcome in ('let', 'misrecorded', 'other')
         and p_confirmed_how is not null and p_confirmed_how <> p_outcome)
     or (p_outcome = 'clear'
         and (p_confirmed_how is not null or p_scored_at_cut_s is not null)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select p.* into v_point
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_point_id
     and p.match_id = p_match_id
     and p.processing_version_id = m.active_processing_version_id
     and not p.deleted
   for update of p;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.points
     set confirmed_winner = case
           when p_outcome in ('user', 'opponent') then p_outcome
           else null
         end,
         is_let = p_outcome in ('let', 'misrecorded', 'other'),
         confirmed_how = case
           when p_outcome in ('let', 'misrecorded', 'other') then p_outcome
           when p_outcome in ('user', 'opponent') then p_confirmed_how
           else null
         end,
         scored_at_cut_s = case
           when p_outcome not in ('user', 'opponent') then null
           when v_point.is_let then null
           when v_point.confirmed_winner is not null then v_point.scored_at_cut_s
           else coalesce(p_scored_at_cut_s, v_point.scored_at_cut_s)
         end
   where id = p_point_id;

  select jsonb_build_object(
           'pointId', id,
           'confirmedWinner', confirmed_winner,
           'confirmedHow', confirmed_how,
           'isSkipped', is_let,
           'scoredAtCutS', scored_at_cut_s
         ) into v_after
    from public.points where id = p_point_id;

  return public._canonical_score_finish_command(
    p_match_id, p_request_id, 'set_point_outcome',
    (v_context ->> 'baseRevision')::bigint, array[p_point_id],
    jsonb_build_object('point', jsonb_build_object(
      'pointId', v_point.id,
      'confirmedWinner', v_point.confirmed_winner,
      'confirmedHow', v_point.confirmed_how,
      'isSkipped', v_point.is_let,
      'scoredAtCutS', v_point.scored_at_cut_s
    )),
    jsonb_build_object('point', v_after)
  );
end;
$$;

revoke all on function public.set_point_outcome_v2(
  uuid,uuid,text,uuid,bigint,text,numeric
) from public, anon;
grant execute on function public.set_point_outcome_v2(
  uuid,uuid,text,uuid,bigint,text,numeric
) to authenticated;

create or replace function public.set_first_server_v2(
  p_match_id uuid,
  p_first_server text,
  p_request_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb;
  v_before jsonb;
begin
  v_context := public._canonical_score_command_context(
    p_match_id, p_request_id, p_expected_revision, 'set_first_server'
  );
  if v_context ->> 'state' <> 'new' then
    return v_context -> 'response';
  end if;
  if p_first_server is not null and p_first_server not in ('user', 'opponent') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select jsonb_build_object(
           'firstServer', first_server,
           'firstServerSource', first_server_source
         ) into v_before
    from public.matches where id = p_match_id;
  perform set_config('ponglens.atomic_score_command', 'on', true);
  update public.matches
     set first_server = p_first_server,
         first_server_source = case when p_first_server is null then null else 'user' end
   where id = p_match_id;
  perform set_config('ponglens.atomic_score_command', 'off', true);

  return public._canonical_score_finish_command(
    p_match_id, p_request_id, 'set_first_server',
    (v_context ->> 'baseRevision')::bigint, '{}'::uuid[],
    jsonb_build_object('match', v_before),
    jsonb_build_object('match', jsonb_build_object(
      'firstServer', p_first_server,
      'firstServerSource', case when p_first_server is null then null else 'user' end
    ))
  );
end;
$$;

revoke all on function public.set_first_server_v2(uuid,text,uuid,bigint)
  from public, anon;
grant execute on function public.set_first_server_v2(uuid,text,uuid,bigint)
  to authenticated;

create or replace function public.set_server_override_v2(
  p_match_id uuid,
  p_point_id uuid,
  p_server text,
  p_request_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb;
  v_point public.points%rowtype;
  v_affected uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  v_context := public._canonical_score_command_context(
    p_match_id, p_request_id, p_expected_revision, 'set_server_override'
  );
  if v_context ->> 'state' <> 'new' then
    return v_context -> 'response';
  end if;
  if p_point_id is null or (p_server is not null and p_server not in ('user', 'opponent')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select p.* into v_point
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_point_id
     and p.match_id = p_match_id
     and p.processing_version_id = m.active_processing_version_id
     and not p.deleted
   for update of p;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Older clients can still write point anchors directly during this rollout.
  -- Lock the whole affected suffix before recording its before-state so a
  -- concurrent compatibility write cannot escape the cleanup or the ledger.
  perform 1
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = v_point.processing_version_id
     and not p.deleted
     and (p.id = p_point_id or (
       p.server_override is not null
       and (coalesce(p.t0, 9999999), p.idx)
           > (coalesce(v_point.t0, 9999999), v_point.idx)
     ))
   order by coalesce(p.t0, 9999999), p.idx
   for update;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', p.id, 'serverOverride', p.server_override
         ) order by coalesce(p.t0, 9999999), p.idx), '[]'::jsonb)
    into v_before
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = v_point.processing_version_id
     and not p.deleted
     and (p.id = p_point_id or (
       p.server_override is not null
       and (coalesce(p.t0, 9999999), p.idx)
           > (coalesce(v_point.t0, 9999999), v_point.idx)
     ));

  with changed as (
    update public.points p
       set server_override = case when p.id = p_point_id then p_server else null end
     where p.match_id = p_match_id
       and p.processing_version_id = v_point.processing_version_id
       and not p.deleted
       and (p.id = p_point_id or (
         p.server_override is not null
         and (coalesce(p.t0, 9999999), p.idx)
             > (coalesce(v_point.t0, 9999999), v_point.idx)
       ))
     returning p.id
  ) select coalesce(array_agg(id order by id), '{}'::uuid[])
      into v_affected from changed;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', p.id, 'serverOverride', p.server_override
         ) order by coalesce(p.t0, 9999999), p.idx), '[]'::jsonb)
    into v_after
    from public.points p
   where p.id = any(v_affected);

  return public._canonical_score_finish_command(
    p_match_id, p_request_id, 'set_server_override',
    (v_context ->> 'baseRevision')::bigint, v_affected,
    jsonb_build_object('points', v_before),
    jsonb_build_object('points', v_after)
  );
end;
$$;

revoke all on function public.set_server_override_v2(uuid,uuid,text,uuid,bigint)
  from public, anon;
grant execute on function public.set_server_override_v2(uuid,uuid,text,uuid,bigint)
  to authenticated;

create or replace function public.set_game_boundary_v2(
  p_match_id uuid,
  p_point_id uuid,
  p_boundary text,
  p_game_winner text,
  p_request_id uuid,
  p_expected_revision bigint,
  p_previous_point_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb;
  v_version uuid;
  v_found integer;
  v_affected uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  v_context := public._canonical_score_command_context(
    p_match_id, p_request_id, p_expected_revision, 'set_game_boundary'
  );
  if v_context ->> 'state' <> 'new' then
    return v_context -> 'response';
  end if;
  if p_point_id is null
     or (p_boundary is not null and p_boundary not in ('end', 'continue'))
     or (p_game_winner is not null and p_game_winner not in ('user', 'opponent'))
     or (p_boundary is distinct from 'end' and p_game_winner is not null)
     or p_previous_point_id = p_point_id then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select active_processing_version_id into v_version
    from public.matches where id = p_match_id;
  select count(*), coalesce(array_agg(locked.id order by locked.id), '{}'::uuid[])
    into v_found, v_affected
    from (
      select p.id
        from public.points p
       where p.match_id = p_match_id
         and p.processing_version_id = v_version
         and not p.deleted
         and p.id = any(array_remove(array[p_point_id, p_previous_point_id], null))
       order by p.id
       for update
    ) locked;
  if v_found <> cardinality(array_remove(array[p_point_id, p_previous_point_id], null)) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', p.id,
           'gameEndOverride', p.game_end_override,
           'gameWinnerOverride', p.game_winner_override
         ) order by p.id), '[]'::jsonb)
    into v_before from public.points p where p.id = any(v_affected);

  if p_previous_point_id is not null then
    update public.points
       set game_end_override = null,
           game_winner_override = null
     where id = p_previous_point_id;
  end if;
  update public.points
     set game_end_override = p_boundary,
         game_winner_override = case when p_boundary = 'end' then p_game_winner else null end
   where id = p_point_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', p.id,
           'gameEndOverride', p.game_end_override,
           'gameWinnerOverride', p.game_winner_override
         ) order by p.id), '[]'::jsonb)
    into v_after from public.points p where p.id = any(v_affected);

  return public._canonical_score_finish_command(
    p_match_id, p_request_id, 'set_game_boundary',
    (v_context ->> 'baseRevision')::bigint, v_affected,
    jsonb_build_object('points', v_before),
    jsonb_build_object('points', v_after)
  );
end;
$$;

revoke all on function public.set_game_boundary_v2(
  uuid,uuid,text,text,uuid,bigint,uuid
) from public, anon;
grant execute on function public.set_game_boundary_v2(
  uuid,uuid,text,text,uuid,bigint,uuid
) to authenticated;

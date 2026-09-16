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

  if p_outcome is null
     or p_outcome not in ('user', 'opponent', 'let', 'misrecorded', 'other', 'clear')
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

create or replace function public._canonical_point_outcome_valid(p_outcome text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    p_outcome in ('user', 'opponent', 'let', 'misrecorded', 'other', 'clear'),
    false
  )
$$;

revoke all on function public._canonical_point_outcome_valid(text)
  from public, anon, authenticated;

create or replace function public._canonical_apply_point_outcome(
  p_point_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._canonical_point_outcome_valid(p_outcome) then
    raise exception 'invalid canonical point outcome' using errcode = '23514';
  end if;
  update public.points
     set confirmed_winner = case
           when p_outcome in ('user', 'opponent') then p_outcome else null end,
         is_let = p_outcome in ('let', 'misrecorded', 'other'),
         confirmed_how = case
           when p_outcome in ('let', 'misrecorded', 'other') then p_outcome
           else null end,
         scored_at_cut_s = case
           when p_outcome in ('user', 'opponent') and not is_let
             then scored_at_cut_s
           else null end
   where id = p_point_id;
end;
$$;

revoke all on function public._canonical_apply_point_outcome(uuid,text)
  from public, anon, authenticated;

create or replace function public.set_point_visibility_v2(
  p_match_id uuid,
  p_point_id uuid,
  p_visible boolean,
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
  v_after jsonb;
begin
  v_context := public._canonical_score_command_context(
    p_match_id, p_request_id, p_expected_revision, 'set_point_visibility'
  );
  if v_context ->> 'state' <> 'new' then return v_context -> 'response'; end if;
  if p_point_id is null or p_visible is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select p.* into v_point
    from public.points p join public.matches m on m.id=p.match_id
   where p.id=p_point_id and p.match_id=p_match_id
     and p.processing_version_id=m.active_processing_version_id
   for update of p;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  update public.points set deleted=not p_visible where id=p_point_id;
  select to_jsonb(p) into v_after from public.points p where id=p_point_id;
  return public._canonical_score_finish_command(
    p_match_id,p_request_id,'set_point_visibility',
    (v_context->>'baseRevision')::bigint,array[p_point_id],
    jsonb_build_object('point',to_jsonb(v_point)),
    jsonb_build_object('point',v_after)
  );
end;
$$;

revoke all on function public.set_point_visibility_v2(uuid,uuid,boolean,uuid,bigint)
  from public, anon;
grant execute on function public.set_point_visibility_v2(uuid,uuid,boolean,uuid,bigint)
  to authenticated;

create or replace function public.split_point_v2(
  p_match_id uuid,
  p_parent_id uuid,
  p_split_times numeric[],
  p_child_cut_t0s numeric[],
  p_outcomes text[],
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
  v_parent public.points%rowtype;
  v_child public.points%rowtype;
  v_current_id uuid;
  v_segment_ids uuid[];
  v_created_ids uuid[] := '{}'::uuid[];
  v_affected uuid[];
  v_later_anchors jsonb;
  v_segments jsonb;
  v_index integer;
  v_prior_time numeric;
begin
  v_context := public._canonical_score_command_context(
    p_match_id,p_request_id,p_expected_revision,'split_point'
  );
  if v_context->>'state' <> 'new' then return v_context->'response'; end if;
  if p_parent_id is null or p_split_times is null or p_child_cut_t0s is null
     or p_outcomes is null or cardinality(p_split_times) not between 1 and 2
     or cardinality(p_child_cut_t0s) <> cardinality(p_split_times)
     or cardinality(p_outcomes) <> cardinality(p_split_times)+1
     or exists (select 1 from unnest(p_outcomes) value
                 where not public._canonical_point_outcome_valid(value))
     or exists (select 1 from unnest(p_split_times) value where value is null)
     or exists (select 1 from unnest(p_child_cut_t0s) value where value < 0) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;

  select p.* into v_parent
    from public.points p join public.matches m on m.id=p.match_id
   where p.id=p_parent_id and p.match_id=p_match_id and not p.deleted
     and p.processing_version_id=m.active_processing_version_id
   for update of p;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_parent.t0 is null or v_parent.t1 is null then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  v_prior_time := v_parent.t0;
  for v_index in 1..cardinality(p_split_times) loop
    if p_split_times[v_index] < v_prior_time+0.2
       or p_split_times[v_index] > v_parent.t1-0.2 then
      return jsonb_build_object('ok',false,'code','invalid_input');
    end if;
    v_prior_time := p_split_times[v_index];
  end loop;

  perform 1 from public.points p
   where p.match_id=p_match_id
     and p.processing_version_id=v_parent.processing_version_id
     and not p.deleted
   order by coalesce(p.t0,9999999),p.idx for update;
  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId',p.id,'serverOverride',p.server_override
         ) order by coalesce(p.t0,9999999),p.idx),'[]'::jsonb)
    into v_later_anchors
    from public.points p
   where p.match_id=p_match_id
     and p.processing_version_id=v_parent.processing_version_id
     and not p.deleted and p.server_override is not null
     and (coalesce(p.t0,9999999),p.idx)>(coalesce(v_parent.t0,9999999),v_parent.idx);

  v_current_id := p_parent_id;
  for v_index in 1..cardinality(p_split_times) loop
    select s.* into v_child
      from public.split_point(
        v_current_id,p_split_times[v_index],p_child_cut_t0s[v_index]
      ) s;
    update public.points set end_authority='manual' where id=v_current_id;
    v_created_ids := array_append(v_created_ids,v_child.id);
    v_current_id := v_child.id;
  end loop;
  update public.points set end_authority=v_parent.end_authority where id=v_current_id;
  if v_current_id<>p_parent_id then
    update public.points set
      game_end_override=v_parent.game_end_override,
      game_winner_override=v_parent.game_winner_override,
      scored_at_cut_s=v_parent.scored_at_cut_s,
      rally_end_cut_s=v_parent.rally_end_cut_s
     where id=v_current_id;
    update public.points set
      game_end_override=null,game_winner_override=null,
      scored_at_cut_s=null,rally_end_cut_s=null
     where id=p_parent_id;
  end if;
  v_segment_ids := array_prepend(p_parent_id,v_created_ids);
  for v_index in 1..cardinality(v_segment_ids) loop
    perform public._canonical_apply_point_outcome(v_segment_ids[v_index],p_outcomes[v_index]);
  end loop;

  -- The original end still describes the final segment, so retain that
  -- high-authority evidence by moving it rather than invalidating it.
  update public.point_timing_observations o
     set point_id=v_current_id,
         timing_revision=(select timing_revision from public.points where id=v_current_id)
   where o.point_id=p_parent_id and o.kind='point_end' and o.invalidated_at is null;
  with cleared as (
    update public.points p set server_override=null
     where p.match_id=p_match_id
       and p.processing_version_id=v_parent.processing_version_id
       and not p.deleted and p.server_override is not null
       and not (p.id=any(v_segment_ids))
       and (coalesce(p.t0,9999999),p.idx)>(coalesce(v_parent.t0,9999999),v_parent.idx)
     returning p.id
  ) select v_segment_ids || coalesce(array_agg(id),'{}'::uuid[])
      into v_affected from cleared;

  perform public.request_reclip(p_match_id);
  select jsonb_agg(to_jsonb(p) order by coalesce(p.t0,9999999),p.idx)
    into v_segments from public.points p where p.id=any(v_segment_ids);
  return public._canonical_score_finish_command(
    p_match_id,p_request_id,'split_point',(v_context->>'baseRevision')::bigint,
    v_affected,
    jsonb_build_object('parent',to_jsonb(v_parent),'laterAnchors',v_later_anchors),
    jsonb_build_object('parentPointId',p_parent_id,
      'createdPointIds',to_jsonb(v_created_ids),'segmentPointIds',to_jsonb(v_segment_ids),
      'points',v_segments)
  );
end;
$$;

revoke all on function public.split_point_v2(
  uuid,uuid,numeric[],numeric[],text[],uuid,bigint
) from public, anon;
grant execute on function public.split_point_v2(
  uuid,uuid,numeric[],numeric[],text[],uuid,bigint
) to authenticated;

create or replace function public.unsplit_point_v2(
  p_match_id uuid,
  p_split_request_id uuid,
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
  v_source public.match_score_mutations%rowtype;
  v_parent public.points%rowtype;
  v_parent_id uuid;
  v_children uuid[];
  v_segment_ids uuid[];
  v_before jsonb;
  v_anchor jsonb;
  v_after jsonb;
begin
  v_context := public._canonical_score_command_context(
    p_match_id,p_request_id,p_expected_revision,'unsplit_point'
  );
  if v_context->>'state' <> 'new' then return v_context->'response'; end if;
  if p_split_request_id is null then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_source from public.match_score_mutations
   where request_id=p_split_request_id and match_id=p_match_id and action='split_point'
   for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if v_source.result_revision<>p_expected_revision then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  v_parent_id := (v_source.after_state#>>'{payload,parentPointId}')::uuid;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_children
    from jsonb_array_elements_text(v_source.after_state#>'{payload,createdPointIds}');
  v_segment_ids := array_prepend(v_parent_id,v_children);
  perform 1 from public.points p where p.id=any(v_segment_ids)
   order by p.id for update;
  select jsonb_agg(to_jsonb(p) order by p.id) into v_before
    from public.points p where p.id=any(v_segment_ids);
  if jsonb_array_length(coalesce(v_before,'[]'::jsonb))<>cardinality(v_segment_ids) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  v_parent := jsonb_populate_record(null::public.points,v_source.before_state->'parent');

  update public.points set
    t0=v_parent.t0,t1=v_parent.t1,cut_t0=v_parent.cut_t0,
    tight_start=v_parent.tight_start,tight_end=v_parent.tight_end,
    edited=v_parent.edited,deleted=v_parent.deleted,
    confirmed_winner=v_parent.confirmed_winner,confirmed_how=v_parent.confirmed_how,
    is_let=v_parent.is_let,server=v_parent.server,server_override=v_parent.server_override,
    game_end_override=v_parent.game_end_override,
    game_winner_override=v_parent.game_winner_override,
    scored_at_cut_s=v_parent.scored_at_cut_s,rally_end_cut_s=v_parent.rally_end_cut_s,
    end_authority=v_parent.end_authority
   where id=v_parent_id;
  update public.point_timing_observations
     set point_id=v_parent_id,
         timing_revision=(select timing_revision from public.points where id=v_parent_id)
   where point_id=any(v_children) and invalidated_at is null;
  delete from public.points where id=any(v_children);
  for v_anchor in select value from jsonb_array_elements(
    coalesce(v_source.before_state->'laterAnchors','[]'::jsonb)
  ) loop
    update public.points
       set server_override=v_anchor->>'serverOverride'
     where id=(v_anchor->>'pointId')::uuid;
  end loop;
  perform public.request_reclip(p_match_id);
  select to_jsonb(p) into v_after from public.points p where id=v_parent_id;
  return public._canonical_score_finish_command(
    p_match_id,p_request_id,'unsplit_point',(v_context->>'baseRevision')::bigint,
    v_segment_ids,jsonb_build_object('points',coalesce(v_before,'[]'::jsonb)),
    jsonb_build_object('point',v_after,'removedPointIds',to_jsonb(v_children))
  );
end;
$$;

revoke all on function public.unsplit_point_v2(uuid,uuid,uuid,bigint)
  from public, anon;
grant execute on function public.unsplit_point_v2(uuid,uuid,uuid,bigint)
  to authenticated;

create or replace function public.merge_points_v2(
  p_match_id uuid,
  p_point_ids uuid[],
  p_outcome text,
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
  v_ordered uuid[];
  v_survivor public.points%rowtype;
  v_last public.points%rowtype;
  v_last_t1 numeric;
  v_before jsonb;
  v_after jsonb;
  v_affected uuid[];
begin
  v_context := public._canonical_score_command_context(
    p_match_id,p_request_id,p_expected_revision,'merge_points'
  );
  if v_context->>'state'<>'new' then return v_context->'response'; end if;
  if p_point_ids is null or cardinality(p_point_ids) not between 2 and 3
     or cardinality(array(select distinct unnest(p_point_ids)))<>cardinality(p_point_ids)
     or not public._canonical_point_outcome_valid(p_outcome) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  perform 1 from public.points p join public.matches m on m.id=p.match_id
   where p.id=any(p_point_ids) and p.match_id=p_match_id and not p.deleted
     and p.processing_version_id=m.active_processing_version_id
   order by coalesce(p.t0,9999999),p.idx for update of p;
  select array_agg(p.id order by coalesce(p.t0,9999999),p.idx),
         max(p.t1),jsonb_agg(to_jsonb(p) order by coalesce(p.t0,9999999),p.idx)
    into v_ordered,v_last_t1,v_before
    from public.points p join public.matches m on m.id=p.match_id
   where p.id=any(p_point_ids) and p.match_id=p_match_id and not p.deleted
     and p.processing_version_id=m.active_processing_version_id;
  if v_ordered is null or v_ordered<>p_point_ids or exists (
    select 1 from public.points p join public.matches m on m.id=p.match_id
     where p.match_id=p_match_id and p.processing_version_id=m.active_processing_version_id
       and not p.deleted and not (p.id=any(p_point_ids))
       and (coalesce(p.t0,9999999),p.idx)>(
         select coalesce(t0,9999999),idx from public.points where id=p_point_ids[1]
       ) and (coalesce(p.t0,9999999),p.idx)<(
         select coalesce(t0,9999999),idx from public.points where id=p_point_ids[cardinality(p_point_ids)]
       )
  ) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into v_survivor from public.points where id=p_point_ids[1];
  select * into v_last from public.points
   where id=p_point_ids[cardinality(p_point_ids)];
  update public.points set
    t1=v_last_t1,tight_end=false,edited=true,end_authority='manual',
    game_end_override=v_last.game_end_override,
    game_winner_override=v_last.game_winner_override,
    scored_at_cut_s=v_last.scored_at_cut_s,
    rally_end_cut_s=v_last.rally_end_cut_s
   where id=v_survivor.id;
  perform public._canonical_apply_point_outcome(v_survivor.id,p_outcome);
  update public.points set deleted=true where id=any(p_point_ids[2:cardinality(p_point_ids)]);
  update public.point_timing_observations
     set invalidated_at=coalesce(invalidated_at,clock_timestamp()),
         invalidated_reason=coalesce(invalidated_reason,'merged_point')
   where (point_id=v_survivor.id and kind='point_end')
      or point_id=any(p_point_ids[2:cardinality(p_point_ids)]);
  with cleared as (
    update public.points p set server_override=null
     where p.match_id=p_match_id and p.processing_version_id=v_survivor.processing_version_id
       and not p.deleted and p.server_override is not null and p.id<>v_survivor.id
       and (coalesce(p.t0,9999999),p.idx)>(coalesce(v_survivor.t0,9999999),v_survivor.idx)
     returning p.id
  ) select p_point_ids || coalesce(array_agg(id),'{}'::uuid[])
      into v_affected from cleared;
  perform public.request_reclip(p_match_id);
  select jsonb_agg(to_jsonb(p) order by p.id) into v_after
    from public.points p where p.id=any(p_point_ids);
  return public._canonical_score_finish_command(
    p_match_id,p_request_id,'merge_points',(v_context->>'baseRevision')::bigint,
    v_affected,jsonb_build_object('points',v_before),
    jsonb_build_object('survivorPointId',v_survivor.id,
      'archivedPointIds',to_jsonb(p_point_ids[2:cardinality(p_point_ids)]),'points',v_after)
  );
end;
$$;

revoke all on function public.merge_points_v2(uuid,uuid[],text,uuid,bigint)
  from public, anon;
grant execute on function public.merge_points_v2(uuid,uuid[],text,uuid,bigint)
  to authenticated;

create or replace function public.adjust_point_v2(
  p_match_id uuid,
  p_point_id uuid,
  p_t0 numeric,
  p_t1 numeric,
  p_tight_start boolean,
  p_tight_end boolean,
  p_scored_at_cut_s numeric,
  p_rally_end_cut_s numeric,
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
  v_before public.points%rowtype;
  v_after public.points%rowtype;
  v_start_moved boolean;
  v_end_moved boolean;
begin
  v_context:=public._canonical_score_command_context(
    p_match_id,p_request_id,p_expected_revision,'adjust_point'
  );
  if v_context->>'state'<>'new' then return v_context->'response'; end if;
  select p.* into v_before from public.points p join public.matches m on m.id=p.match_id
   where p.id=p_point_id and p.match_id=p_match_id and not p.deleted
     and p.processing_version_id=m.active_processing_version_id for update of p;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  v_start_moved:=p_t0 is distinct from v_before.t0;
  v_end_moved:=p_t1 is distinct from v_before.t1;
  if p_t0 is null or p_t1 is null or p_t0<0 or p_t1-p_t0<0.5 then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select a.* into v_after from public.adjust_point(
    p_point_id,p_t0,p_t1,p_tight_start,p_tight_end,p_scored_at_cut_s,p_rally_end_cut_s
  ) a;
  if v_end_moved then
    update public.points set end_authority='manual' where id=p_point_id returning * into v_after;
  end if;
  update public.point_timing_observations
     set invalidated_at=coalesce(invalidated_at,clock_timestamp()),
         invalidated_reason=coalesce(invalidated_reason,'point_edge_adjusted')
   where point_id=p_point_id and invalidated_at is null
     and ((kind='serve_start' and v_start_moved) or (kind='point_end' and v_end_moved));
  perform public.request_reclip(p_match_id);
  return public._canonical_score_finish_command(
    p_match_id,p_request_id,'adjust_point',(v_context->>'baseRevision')::bigint,
    array[p_point_id],jsonb_build_object('point',to_jsonb(v_before)),
    jsonb_build_object('point',to_jsonb(v_after))
  );
end;
$$;

revoke all on function public.adjust_point_v2(
  uuid,uuid,numeric,numeric,boolean,boolean,numeric,numeric,uuid,bigint
) from public, anon;
grant execute on function public.adjust_point_v2(
  uuid,uuid,numeric,numeric,boolean,boolean,numeric,numeric,uuid,bigint
) to authenticated;

create or replace function public.insert_point_v2(
  p_match_id uuid,
  p_prev_id uuid,
  p_next_id uuid,
  p_t0 numeric,
  p_t1 numeric,
  p_cut_t0 numeric,
  p_outcome text,
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
  v_prev public.points%rowtype;
  v_next public.points%rowtype;
  v_created public.points%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_affected uuid[];
begin
  v_context:=public._canonical_score_command_context(
    p_match_id,p_request_id,p_expected_revision,'insert_point'
  );
  if v_context->>'state'<>'new' then return v_context->'response'; end if;
  if (p_prev_id is null and p_next_id is null) or p_t0 is null or p_t1 is null
     or p_t0<0 or p_t1-p_t0<0.5 or not public._canonical_point_outcome_valid(p_outcome) then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  if p_prev_id is not null then
    select p.* into v_prev from public.points p join public.matches m on m.id=p.match_id
     where p.id=p_prev_id and p.match_id=p_match_id and not p.deleted
       and p.processing_version_id=m.active_processing_version_id for update of p;
    if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  end if;
  if p_next_id is not null then
    select p.* into v_next from public.points p join public.matches m on m.id=p.match_id
     where p.id=p_next_id and p.match_id=p_match_id and not p.deleted
       and p.processing_version_id=m.active_processing_version_id for update of p;
    if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into v_before
    from public.points p where p.id=any(array_remove(array[p_prev_id,p_next_id],null));
  select i.* into v_created from public.insert_point(
    p_prev_id,p_next_id,p_t0,p_t1,p_cut_t0
  ) i;
  update public.points set end_authority='manual' where id=v_created.id returning * into v_created;
  perform public._canonical_apply_point_outcome(v_created.id,p_outcome);
  if v_prev.id is not null and v_prev.t1 is distinct from (
    select t1 from public.points where id=v_prev.id
  ) then
    update public.point_timing_observations set
      invalidated_at=coalesce(invalidated_at,clock_timestamp()),
      invalidated_reason=coalesce(invalidated_reason,'point_edge_inserted')
     where point_id=v_prev.id and kind='point_end' and invalidated_at is null;
  end if;
  if v_next.id is not null and v_next.t0 is distinct from (
    select t0 from public.points where id=v_next.id
  ) then
    update public.point_timing_observations set
      invalidated_at=coalesce(invalidated_at,clock_timestamp()),
      invalidated_reason=coalesce(invalidated_reason,'point_edge_inserted')
     where point_id=v_next.id and kind='serve_start' and invalidated_at is null;
  end if;
  with cleared as (
    update public.points p set server_override=null
     where p.match_id=p_match_id and p.processing_version_id=v_created.processing_version_id
       and not p.deleted and p.server_override is not null and p.id<>v_created.id
       and (coalesce(p.t0,9999999),p.idx)>(coalesce(v_created.t0,9999999),v_created.idx)
     returning p.id
  ) select array_remove(array[p_prev_id,p_next_id,v_created.id],null)
             || coalesce(array_agg(id),'{}'::uuid[])
      into v_affected from cleared;
  perform public.request_reclip(p_match_id);
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into v_after
    from public.points p where p.id=any(v_affected);
  return public._canonical_score_finish_command(
    p_match_id,p_request_id,'insert_point',(v_context->>'baseRevision')::bigint,
    v_affected,jsonb_build_object('points',v_before),
    jsonb_build_object('pointId',v_created.id,'points',v_after)
  );
end;
$$;

revoke all on function public.insert_point_v2(
  uuid,uuid,uuid,numeric,numeric,numeric,text,uuid,bigint
) from public, anon;
grant execute on function public.insert_point_v2(
  uuid,uuid,uuid,numeric,numeric,numeric,text,uuid,bigint
) to authenticated;

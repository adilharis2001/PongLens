-- Canonical scored-match state, phase 2: command kernel only.
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

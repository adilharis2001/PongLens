-- Canonical scored-match state, phase 3 foundation: private reader boundary.
--
-- This migration does not switch a display or downstream consumer. It adds a
-- separate, default-off account canary and one access-checked snapshot RPC so
-- web and native can shadow-compare a whole revision before any reader moves.

insert into public.app_config (key, value)
values ('canonical_score_readers', 'off')
on conflict (key) do nothing;

create or replace function public.canonical_score_readers_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and exists (
    select 1
      from public.app_config c
     where c.key = 'canonical_score_readers'
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
  );
$$;

revoke all on function public.canonical_score_readers_enabled()
  from public, anon, authenticated;
grant execute on function public.canonical_score_readers_enabled()
  to authenticated;

comment on function public.canonical_score_readers_enabled() is
  'Separate account-scoped reader canary. It never inherits command rollout or admin status.';

create or replace function public.canonical_score_snapshot_v1(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_projection_ready boolean;
begin
  if not public.canonical_score_readers_enabled() then
    return jsonb_build_object('ok', false, 'code', 'not_enabled');
  end if;

  -- Match access is the established owner/accepted-coach boundary. Admins
  -- need the same snapshot for diagnosis, but admin status never enables the
  -- canary itself: their account must still be explicitly allowlisted.
  if not exists (
    select 1 from public.matches m where m.id = p_match_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not (
    public.has_match_access(p_match_id)
    or public.is_admin()
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- This is a reader, never a repair path. Lock one already-current match row
  -- so a concurrent score write cannot make the internal snapshot helper take
  -- its refresh branch between validation and assembly. Stale/error state is
  -- diagnosed elsewhere and falls back to the established fold here.
  select true into v_projection_ready
    from public.matches m
   where m.id = p_match_id
     and m.score_revision = m.score_projection_revision
     and m.score_projection_status in ('current', 'empty')
   for share;
  if not found or not v_projection_ready then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;

  begin
    v_snapshot := public._canonical_score_snapshot(p_match_id);
  exception when others then
    -- Readers receive one stable rule code, never SQL text or projection
    -- internals. The admin diagnostic remains the place to investigate.
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end;

  return jsonb_build_object('ok', true, 'snapshot', v_snapshot);
end;
$$;

revoke all on function public.canonical_score_snapshot_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_score_snapshot_v1(uuid)
  to authenticated;

comment on function public.canonical_score_snapshot_v1(uuid) is
  'Revision-pinned score projection for allowlisted authenticated owner, coach or admin readers.';

-- Match-library and summary consumers need one bounded request, not one RPC
-- per card. This returns only already-current summaries visible through the
-- existing match boundary. Missing, inaccessible and stale rows are omitted
-- together so the batch never becomes a match-existence oracle or repair job.
create or replace function public.canonical_score_summaries_v1(
  p_match_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_summaries jsonb;
begin
  if not public.canonical_score_readers_enabled() then
    return jsonb_build_object('ok', false, 'code', 'not_enabled');
  end if;

  if coalesce(array_length(p_match_ids, 1), 0) > 250 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'matchId', m.id,
             'revision', m.score_revision,
             'status', m.score_projection_status,
             'match', jsonb_build_object(
               'gamesUser', s.games_user,
               'gamesOpponent', s.games_opponent,
               'currentGameNumber', s.current_game_number,
               'currentScoreUser', s.current_score_user,
               'currentScoreOpponent', s.current_score_opponent,
               'completedGames', s.completed_games,
               'visiblePointCount', s.visible_point_count,
               'answeredPointCount', s.answered_point_count,
               'skippedPointCount', s.skipped_point_count,
               'allVisiblePointsAnswered', s.all_visible_points_answered,
               'firstServer', s.first_server,
               'firstServerSource', s.first_server_source,
               'ordering', s.ordering
             )
           ) order by m.id), '[]'::jsonb)
      into v_summaries
      from public.matches m
      join public.match_score_state s
        on s.match_id = m.id
       and s.score_revision = m.score_revision
     where m.id = any(coalesce(p_match_ids, '{}'::uuid[]))
       and m.score_revision = m.score_projection_revision
       and m.score_projection_status in ('current', 'empty')
       and (public.has_match_access(m.id) or public.is_admin());
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end;

  return jsonb_build_object('ok', true, 'summaries', v_summaries);
end;
$$;

revoke all on function public.canonical_score_summaries_v1(uuid[])
  from public, anon, authenticated;
grant execute on function public.canonical_score_summaries_v1(uuid[])
  to authenticated;

comment on function public.canonical_score_summaries_v1(uuid[]) is
  'Bounded revision-current summaries for allowlisted authenticated owner, coach or admin readers.';

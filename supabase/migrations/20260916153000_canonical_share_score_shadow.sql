-- Canonical scored-match state, phase 3: public-share shadow boundary.
--
-- The public page still renders its established score fold. This service-only
-- RPC gives that server component one revision-pinned canonical snapshot and
-- the exact legacy source rows behind the same live token. It is deliberately
-- not executable by anon/authenticated: possession of a share token continues
-- to expose only the existing public resolver payloads.

create or replace function public.canonical_share_score_shadow_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_owner_id uuid;
  v_processing_version_id uuid;
  v_first_server text;
  v_snapshot jsonb;
  v_legacy_points jsonb;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Resolve only the two live scored-share kinds. Missing, revoked, and
  -- score-hidden links intentionally have one indistinguishable answer.
  select m.id, m.user_id
    into v_match_id, v_owner_id
    from public.share_links sl
    join public.matches m on m.id = sl.match_id
   where sl.token = p_token
     and sl.revoked_at is null
     and sl.kind in ('match', 'highlights')
     and sl.show_score;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Anonymous viewers do not choose the rollout. A shared match shadows only
  -- when its owner is in the same separate reader canary as authenticated
  -- surfaces; admin/service status never enables it implicitly.
  if not exists (
    select 1
      from public.app_config c
     where c.key = 'canonical_score_readers'
       and (
         c.value = 'on'
         or c.value = 'user:' || v_owner_id::text
         or (
           c.value like 'users:%'
           and v_owner_id::text = any(string_to_array(
             replace(substr(c.value, 7), ' ', ''), ','
           ))
         )
       )
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_enabled');
  end if;

  -- Revalidate the token while pinning one already-current match revision.
  -- Canonical writers lock this row for update before changing owner score
  -- inputs, so the snapshot and legacy source below cannot straddle writes.
  select m.id, m.active_processing_version_id, m.first_server
    into v_match_id, v_processing_version_id, v_first_server
    from public.share_links sl
    join public.matches m on m.id = sl.match_id
   where sl.token = p_token
     and sl.revoked_at is null
     and sl.kind in ('match', 'highlights')
     and sl.show_score
     and m.score_revision = m.score_projection_revision
     and m.score_projection_status in ('current', 'empty')
   for share of m;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;

  begin
    v_snapshot := public._canonical_score_snapshot(v_match_id);

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id,
             'idx', p.idx,
             't0', p.t0,
             'deleted', false,
             'is_let', p.is_let,
             'confirmed_how', p.confirmed_how,
             'confirmed_winner', p.confirmed_winner,
             'server_override', p.server_override,
             'game_end_override', p.game_end_override,
             'game_winner_override', p.game_winner_override
           ) order by coalesce(p.t0, p.idx), p.idx, p.id), '[]'::jsonb)
      into v_legacy_points
      from public.points p
     where p.match_id = v_match_id
       and p.processing_version_id = v_processing_version_id
       and not p.deleted;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end;

  return jsonb_build_object(
    'ok', true,
    'snapshot', v_snapshot,
    -- Public share historically treats any stored first_server as the
    -- rotation anchor, including a detector-authored value. Preserve that
    -- exact oracle here so the shadow identifies the discrepancy rather than
    -- accidentally comparing canonical state with itself.
    'legacy', jsonb_build_object(
      'firstServer', v_first_server,
      'points', v_legacy_points
    )
  );
end;
$$;

revoke all on function public.canonical_share_score_shadow_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.canonical_share_score_shadow_v1(text)
  to service_role;

comment on function public.canonical_share_score_shadow_v1(text) is
  'Service-only, live-token, revision-pinned score shadow for public match and highlight pages.';

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

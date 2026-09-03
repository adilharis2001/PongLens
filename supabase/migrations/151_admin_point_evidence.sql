-- 151 — the touches and the worker's own call, per point, for the admin portal.
--
-- /research/serve-accuracy reads three rules over the events the placement
-- reconstruction stored — the ball died, the ball went off the table, the
-- ball never came back — and it reads them for six hand-listed matches. The
-- data those rules run on is `points.placement` and `points.suggestion`,
-- which every processed match has had all along. Only the page was narrow.
--
-- This is the read that lets /admin/uploads/<id> ask the same questions of
-- any upload. It exists because `points` is the OWNER's row: RLS gives an
-- admin nothing, so the portal cannot select another player's placement
-- without a definer function. Same shape as admin_upload_detail (144).
--
-- Deleted points are left out on purpose. The rules are judged against the
-- scored rotation, and the rotation is arithmetic over the visible list —
-- including a deleted point would shift the server for every point after
-- it, and the verdicts would be wrong in a way that reads as a rule failure.
--
-- Roughly 200 KB on a hundred-point match, read server-side and never sent
-- to the browser: the page ships the verdicts, not the candidates.

create or replace function public.admin_point_evidence(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',         p.id,
             'idx',        p.idx,
             't0',         p.t0,
             't1',         p.t1,
             'placement',  p.placement,
             'suggestion', p.suggestion
           ) order by p.idx), '[]'::jsonb)
    into v_out
    from public.points p
   where p.match_id = p_match_id
     and not p.deleted;

  return v_out;
end;
$$;

revoke execute on function public.admin_point_evidence(uuid) from public, anon;
grant execute on function public.admin_point_evidence(uuid) to authenticated;

comment on function public.admin_point_evidence(uuid) is
  'Placement candidates and the worker''s suggestion per visible point, for '
  'the admin upload portal. Admin only; deleted points excluded so the '
  'serve rotation matches the one the owner scored against.';

-- 100 — one serve correction heals the rest of the match.
--
-- points.server_override is the rotation ANCHOR: computeServing walks the
-- match and re-anchors at the most recent override before each point. So a
-- correction made earlier in the match loses to one made later, even when
-- the later one is stale — the owner fixes point 4, and from point 12 the
-- old correction takes back over and quietly undoes it. Fixing one wrong
-- rotation meant re-tapping every correction downstream of it.
--
-- A correction now clears the corrections after it. Earlier ones stand
-- (they anchor a stretch this one does not speak for); later ones were
-- answers to a rotation that no longer exists.
--
-- Server-side rather than three client round trips: the same write happens
-- from the Keep-score serve balls, the point sheet's "Who served?" and the
-- point-list chip menu, and doing it in one statement means the anchor and
-- its cleanup can never half-land.

create or replace function public.set_server_override(
  p_id uuid,
  p_value text default null
)
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_match uuid;
  v_t0 numeric;
  v_idx integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_value is not null and p_value not in ('user', 'opponent') then
    raise exception 'invalid server' using errcode = '23514';
  end if;

  -- Ownership is the gate, exactly as split_point does it.
  select p.match_id, p.t0, p.idx
    into v_match, v_t0, v_idx
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_id
     and m.user_id = auth.uid()
   for update of p;
  if v_match is null then
    raise exception 'point not found' using errcode = 'P0002';
  end if;

  update public.points set server_override = p_value where id = p_id;

  -- "After" in TIMELINE order, which is what the rotation walks:
  -- sortPoints() orders by t0 with idx as the tiebreak, so the same pair
  -- orders here. Deleted points are not in the walk and keep whatever
  -- they carry, in case they are ever restored.
  return query
    with cleared as (
      update public.points p
         set server_override = null
       where p.match_id = v_match
         and p.id <> p_id
         and not p.deleted
         and p.server_override is not null
         and (coalesce(p.t0, 9999999), p.idx)
             > (coalesce(v_t0, 9999999), v_idx)
      returning p.id
    )
    select cleared.id from cleared;
end;
$$;

revoke all on function public.set_server_override(uuid, text) from public;
grant execute on function public.set_server_override(uuid, text) to authenticated;

comment on function public.set_server_override(uuid, text) is
  'Set (or clear, with null) a point''s serve correction and clear every '
  'correction after it in timeline order. Returns the ids cleared.';

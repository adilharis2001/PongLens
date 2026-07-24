-- 027: merge_points() — the atomic "Join" for Keep-score's Modify modal.
-- Fuse 2-3 adjacent points the auto-splitter cut apart (the reviewer watched
-- the merged rally play out and only THEN decides it was one point). Applied
-- via direct Postgres connection (worker pooler URL); keep in sync with the
-- Supabase project.
--
-- Keeps the FIRST point passed (the caller sends ids in timeline order),
-- grows its t1 to the LAST point's t1 so the survivor spans the whole run,
-- clears tight_end (the survivor's end is now a real rally end, not a split
-- boundary — the reclip must cut it with the full strictness post pad, not
-- the 0.3s tight sliver), marks it edited so the reclip regenerates the
-- clip over the merged span, and HARD-DELETES the others.
--
-- Like unsplit_point (026), this is SECURITY DEFINER: authenticated has no
-- DELETE grant on points (migration 003 revoked it), so merged-away rows can
-- never be removed client-side. Every id must belong to ONE match owned by
-- the caller. The client sets the survivor's winner separately, right after.
--
-- NOTE: growing t1 re-fires points_mark_edited (007) — edited=true is forced
-- regardless, which is exactly what we want. game_end_override / server on
-- the deleted rows are dropped with them; the survivor keeps its own. Join
-- is NOT reversible from the pad (the deleted rows are gone), so the client
-- gates it behind an explicit confirm.

create or replace function public.merge_points(p_ids uuid[])
returns public.points
language plpgsql
security definer
set search_path = public
as $$
declare
  survivor public.points;
  n int;
  n_matches int;
  last_t1 numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null
     or array_length(p_ids, 1) < 2 then
    raise exception 'merge needs at least two points';
  end if;

  -- Lock every target row (a plain row lock — FOR UPDATE can't ride an
  -- aggregate), then count how many the caller actually owns.
  perform 1
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = any(p_ids)
     and m.user_id = auth.uid()
   for update of p;
  select count(*), count(distinct p.match_id)
    into n, n_matches
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = any(p_ids)
     and m.user_id = auth.uid();
  if n <> array_length(p_ids, 1) then
    raise exception 'some points not found or not owned by caller';
  end if;
  if n_matches <> 1 then
    raise exception 'points belong to different matches';
  end if;

  -- Survivor = the first id passed (timeline-first). Its new end is the
  -- latest t1 across the whole set (the last rally's real end).
  select max(t1) into last_t1 from public.points where id = any(p_ids);

  update public.points
     set t1 = last_t1,
         tight_end = false,
         edited = true
   where id = p_ids[1]
   returning * into survivor;
  if survivor.id is null then
    raise exception 'survivor point not found';
  end if;

  delete from public.points
   where id = any(p_ids) and id <> survivor.id;

  return survivor;
end;
$$;

revoke execute on function public.merge_points(uuid[]) from public, anon;
grant execute on function public.merge_points(uuid[]) to authenticated;

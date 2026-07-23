-- 023: split-born points get a cut_t0, so time-based surfaces can see them.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- split_point() used to insert the child with cut_t0 NULL, which made the
-- child invisible to everything that resolves the cut-video playhead to a
-- point (Keep-score chip/pause mapping, playingPointId, deleted spans,
-- reel segments): that stretch of the cut video kept resolving to the
-- surviving parent. The cut video is time-contiguous within an activity
-- span, so the client CAN compute the child's padded start at split time:
--
--   child_cut_t0 = parent_cut_t0
--                + (at_t - min(pre, TIGHT_PAD))            -- child anchor
--                - max(0, parent_t0 - parent_effective_pre) -- parent anchor
--
-- (see PointDetail.splitHere + playhead.ts anchoring notes). The RPC just
-- accepts the value — the client knows the job's strictness pads, the
-- database does not. NULL stays NULL (legacy pre-011 parents without
-- cut_t0: no regression, the child falls back like the parent does).
--
-- The old 2-arg overload is dropped so PostgREST never sees an ambiguous
-- function family.

drop function if exists public.split_point(uuid, numeric);

create or replace function public.split_point(
  p_id uuid,
  at_t numeric,
  child_cut_t0 numeric default null
)
returns public.points
language plpgsql
security definer
set search_path = public
as $$
declare
  orig public.points;
  new_row public.points;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select p.* into orig
    from public.points p
    join public.matches m on m.id = p.match_id
   where p.id = p_id
     and m.user_id = auth.uid()
     for update of p;
  if orig.id is null then
    raise exception 'point not found';
  end if;
  if orig.deleted then
    raise exception 'point is deleted';
  end if;
  if orig.t0 is null or orig.t1 is null
     or at_t < orig.t0 + 0.2 or at_t > orig.t1 - 0.2 then
    raise exception 'split time outside the point window';
  end if;
  -- The child's cut_t0 only makes sense as an offset from the parent's:
  -- without a parent anchor, store NULL (legacy pre-011 cut).
  if orig.cut_t0 is null then
    child_cut_t0 := null;
  elsif child_cut_t0 is not null then
    child_cut_t0 := greatest(child_cut_t0, 0);
  end if;
  update public.points
     set t1 = at_t, edited = true, tight_end = true
   where id = orig.id;
  insert into public.points
    (match_id, idx, t0, t1, server, edited, tight_start, tight_end, cut_t0)
  values (
    orig.match_id,
    (select max(idx) + 1 from public.points where match_id = orig.match_id),
    at_t,
    orig.t1,
    orig.server,
    true,
    true,
    orig.tight_end,
    child_cut_t0
  )
  returning * into new_row;
  return new_row;
end;
$$;

revoke execute on function public.split_point(uuid, numeric, numeric)
  from public, anon;
grant execute on function public.split_point(uuid, numeric, numeric)
  to authenticated;

-- insert_point: trimmed neighbour edges are split boundaries, and a moved
-- start keeps its place in the cut video.
--
-- When an inserted card overlaps a neighbour, the neighbour gives that
-- footage up: its t1 (or t0) moves to the card's edge. 101 left the tight
-- flags alone, so the re-cut padded the moved edge with the FULL strictness
-- pad — the previous card's clip ran 1.6 s into the new rally while the new
-- card's clip started 0.3 s before it, the double-padded seam TIGHT_PAD
-- exists to prevent (clipEdit.ts, split_point). The moved edge is a shared
-- boundary exactly like a split's, so it is marked tight the same way.
--
-- 101 also left the next card's cut_t0 alone while moving its t0, the
-- same drift adjust_point (20260906060000) fixes for Adjust. The anchor now
-- moves by the change in the padded start, with the pad this match's clips
-- were cut with. That pad lookup is shared with adjust_point through
-- match_pre_pad so the two functions can never disagree.

create or replace function public.match_pre_pad(p_match_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.clip_pads is not null and jsonb_typeof(m.clip_pads->'pre') = 'number'
      then (m.clip_pads->>'pre')::numeric
    else case coalesce(j.options->>'strictness', 'normal')
           when 'tight' then 0.5
           when 'loose' then 1.6
           else 1.0
         end
  end
  from public.matches m
  left join public.jobs j on j.id = m.job_id
  where m.id = p_match_id
$$;

revoke execute on function public.match_pre_pad(uuid) from public, anon;
grant execute on function public.match_pre_pad(uuid) to authenticated;

create or replace function public.adjust_point(
  p_id uuid,
  p_t0 numeric,
  p_t1 numeric,
  p_tight_start boolean default null,
  p_tight_end boolean default null,
  p_scored_at_cut_s numeric default null,
  p_rally_end_cut_s numeric default null
)
returns public.points
language plpgsql
security definer
set search_path = public
as $$
declare
  orig public.points;
  v_pre numeric;
  v_eff_pre_old numeric;
  v_eff_pre_new numeric;
  v_anchor_old numeric;
  v_anchor_new numeric;
  v_tight_start boolean;
  v_tight_end boolean;
  v_cut_t0 numeric;
  v_end_moved boolean;
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
  if orig.t0 is null or orig.t1 is null then
    raise exception 'point has no timing';
  end if;
  if p_t0 is null or p_t1 is null or p_t0 < 0 or p_t1 - p_t0 < 0.5 then
    raise exception 'point window too short';
  end if;

  v_pre := public.match_pre_pad(orig.match_id);

  v_tight_start := coalesce(
    p_tight_start,
    case when orig.tight_start and p_t0 <> orig.t0 then false
         else orig.tight_start end);
  v_tight_end := coalesce(
    p_tight_end,
    case when orig.tight_end and p_t1 <> orig.t1 then false
         else orig.tight_end end);

  v_eff_pre_old := case when orig.tight_start then least(v_pre, 0.3) else v_pre end;
  v_eff_pre_new := case when v_tight_start then least(v_pre, 0.3) else v_pre end;
  v_anchor_old := greatest(0, orig.t0 - v_eff_pre_old);
  v_anchor_new := greatest(0, p_t0 - v_eff_pre_new);
  if orig.cut_t0 is null then
    v_cut_t0 := null;
  else
    v_cut_t0 := greatest(0, round(orig.cut_t0 + v_anchor_new - v_anchor_old, 2));
  end if;

  v_end_moved := p_t1 <> orig.t1;

  update public.points
     set t0 = p_t0,
         t1 = p_t1,
         tight_start = v_tight_start,
         tight_end = v_tight_end,
         cut_t0 = v_cut_t0,
         scored_at_cut_s = case when v_end_moved then p_scored_at_cut_s
                                else scored_at_cut_s end,
         rally_end_cut_s = case when v_end_moved then p_rally_end_cut_s
                                else rally_end_cut_s end
   where id = orig.id
   returning * into new_row;
  return new_row;
end;
$$;

create or replace function public.insert_point(
  p_prev_id uuid,
  p_next_id uuid,
  p_t0 numeric,
  p_t1 numeric,
  p_cut_t0 numeric default null
)
returns public.points
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  prev public.points;
  nxt public.points;
  v_match uuid;
  v_new public.points;
  v_pre numeric;
  v_anchor_old numeric;
  v_anchor_new numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_prev_id is null and p_next_id is null then
    raise exception 'insert needs a neighbour' using errcode = '23514';
  end if;
  if p_t0 is null or p_t1 is null or p_t1 <= p_t0 then
    raise exception 'window is empty' using errcode = '23514';
  end if;
  -- Half a second is below any real rally; shorter is a mis-drag.
  if p_t1 - p_t0 < 0.5 then
    raise exception 'window is too short' using errcode = '23514';
  end if;

  -- Ownership is the join, exactly as split_point does it.
  if p_prev_id is not null then
    select p.* into prev
      from public.points p
      join public.matches m on m.id = p.match_id
     where p.id = p_prev_id and m.user_id = auth.uid()
     for update of p;
    if prev.id is null then
      raise exception 'point not found' using errcode = 'P0002';
    end if;
    v_match := prev.match_id;
  end if;

  if p_next_id is not null then
    select p.* into nxt
      from public.points p
      join public.matches m on m.id = p.match_id
     where p.id = p_next_id and m.user_id = auth.uid()
     for update of p;
    if nxt.id is null then
      raise exception 'point not found' using errcode = 'P0002';
    end if;
    if v_match is not null and nxt.match_id <> v_match then
      raise exception 'neighbours are from different matches'
        using errcode = '23514';
    end if;
    v_match := nxt.match_id;
  end if;

  -- The new card must leave each neighbour something to be. Swallowing one
  -- whole is a Join, which already exists and keeps that card's answers.
  if prev.id is not null and p_t0 < prev.t0 + 0.3 then
    raise exception 'window swallows the previous point' using errcode = '23514';
  end if;
  if nxt.id is not null and p_t1 > nxt.t1 - 0.3 then
    raise exception 'window swallows the next point' using errcode = '23514';
  end if;

  insert into public.points
    (match_id, idx, t0, t1, cut_t0, edited, tight_start, tight_end)
  values (
    v_match,
    (select coalesce(max(idx), 0) + 1
       from public.points where match_id = v_match),
    p_t0,
    p_t1,
    -- Timeline order comes from sortPoints (t0 first, idx as the tiebreak),
    -- so the high idx above is fine: the card slots in by its own t0, the
    -- same way split_point's children do. cut_t0 is not optional in
    -- practice: the Keep-score strip skips any point without one. The
    -- caller computes it with the same pad arithmetic split_point's
    -- child_cut_t0 uses.
    greatest(coalesce(p_cut_t0, 0), 0),
    true,
    -- A shared edge keeps only a sliver of context, or the pad is counted
    -- twice across the boundary — split_point's rule. An OUTER edge (no
    -- neighbour that side) keeps the full strictness pad.
    prev.id is not null,
    nxt.id is not null
  )
  returning * into v_new;

  -- Neighbours give up only what the new card actually took. The moved
  -- edge becomes a split boundary (tight), exactly as split_point marks
  -- its parent's end, so the re-cut keeps 0.3 s past the new card rather
  -- than a full pad of it. A moved START also moves the cut anchor by the
  -- change in the padded start (the adjust_point rule).
  if prev.id is not null and prev.t1 > p_t0 then
    update public.points
       set t1 = p_t0, edited = true, tight_end = true
     where id = prev.id;
  end if;
  if nxt.id is not null and nxt.t0 < p_t1 then
    v_pre := public.match_pre_pad(v_match);
    v_anchor_old := greatest(0, nxt.t0
      - case when nxt.tight_start then least(v_pre, 0.3) else v_pre end);
    v_anchor_new := greatest(0, p_t1 - least(v_pre, 0.3));
    update public.points
       set t0 = p_t1, edited = true, tight_start = true,
           cut_t0 = case when nxt.cut_t0 is null then null
                         else greatest(0, round(
                           nxt.cut_t0 + v_anchor_new - v_anchor_old, 2))
                    end
     where id = nxt.id;
  end if;

  -- An insert is a correction upstream: the rotation from here on just
  -- changed, so any correction after it was answering a rotation that no
  -- longer exists. Same rule as set_server_override (100).
  update public.points p
     set server_override = null
   where p.match_id = v_match
     and p.id <> v_new.id
     and not p.deleted
     and p.server_override is not null
     and (coalesce(p.t0, 9999999), p.idx) > (p_t0, v_new.idx);

  return v_new;
end;
$$;

revoke execute on function public.insert_point(uuid, uuid, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.insert_point(uuid, uuid, numeric, numeric, numeric)
  to authenticated;

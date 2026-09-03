-- 101 — put back a rally the cut missed.
--
-- The serve rotation is a COUNT: two serves each, alternating. A rally the
-- cutter dropped is therefore not a labelling problem, it is a missing beat,
-- and no amount of correcting who served can express it — the walk comes out
-- right on every other card, which reads as broken rather than merely wrong.
-- Restoring the card fixes the rotation, the score, the deuce switch and the
-- game boundaries at once, with no correction at all.
--
-- Measured across 9,433 seams in production: 55% of them are CONTINUOUS —
-- the footage between two cards is already in the cut video, so the new card
-- plays straight away with no worker involved. At the rest some footage was
-- removed and only the raw has it, which the reclip job then cuts.
--
-- The new window may overlap its neighbours on purpose. A bad cut often
-- smears the missing rally across the end of one card and the start of the
-- next, so the owner drags the new card's edges INTO them; wherever it
-- overlaps, the neighbour gives that footage up. A card placed purely in the
-- gap touches nobody.

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
    -- same way split_point's children do.
    --
    -- cut_t0 is not optional in practice. The Keep-score strip skips any
    -- point without one, so a card created without it would be invisible in
    -- the very screen it was created from. The caller computes it with the
    -- same pad arithmetic split_point's child_cut_t0 uses.
    greatest(coalesce(p_cut_t0, 0), 0),
    true,
    -- A shared edge keeps only a sliver of context, or the pad is counted
    -- twice across the boundary — split_point's rule. An OUTER edge (no
    -- neighbour that side) keeps the full strictness pad.
    prev.id is not null,
    nxt.id is not null
  )
  returning * into v_new;

  -- Neighbours give up only what the new card actually took.
  --
  -- Their tight flags and cut_t0 are deliberately left alone, following
  -- adjustPatch: a hand-moved edge is re-cut with full strictness context,
  -- and cut_t0 anchors the span in the CUT video, which is not regenerated.
  if prev.id is not null and prev.t1 > p_t0 then
    update public.points
       set t1 = p_t0, edited = true
     where id = prev.id;
  end if;
  if nxt.id is not null and nxt.t0 < p_t1 then
    update public.points
       set t0 = p_t1, edited = true
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

revoke all on function public.insert_point(uuid, uuid, numeric, numeric, numeric)
  from public;
grant execute on function public.insert_point(uuid, uuid, numeric, numeric, numeric)
  to authenticated;

comment on function public.insert_point(uuid, uuid, numeric, numeric, numeric) is
  'Insert a card for a rally the cut missed, between two neighbours. Trims '
  'each neighbour only where the new window overlaps it, and clears serve '
  'corrections after it. Returns the new row.';

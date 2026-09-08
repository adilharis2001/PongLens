-- adjust_point: one timing write that keeps a point's place in the cut video.
--
-- ANCHORING FACT (playhead.ts, Playhead.swift): points.cut_t0 is where the
-- point's PADDED clip starts inside the cut video — source t0 minus the
-- point's effective pre pad. Every playback rule on every surface is built
-- on it: where Score the Match seeks, where the countdown ring ends, where
-- the deleted-span skip lands, where a reel segment starts.
--
-- Adjust used to write t0/t1 straight to the row and leave cut_t0 alone.
-- Move a point's start three seconds earlier and cut_t0 still named the old
-- padded start, so every cut-clock consumer computed the serve three
-- seconds late — on every replay, forever, because the worker's re-cut
-- fixes the FILE and never touches the anchor. That is also the only real
-- reason the Modify sheet locked Adjust while a re-cut was pending: the
-- sheet's map of the cut video was only right until the first Adjust.
--
-- This function does the whole Adjust in one statement:
--   * dissolves a tight flag on any edge that moved (today's rule), unless
--     the caller pins the flags (the undo path restores them);
--   * re-anchors cut_t0 by the change in the padded start, using the pads
--     the clips were actually cut with (matches.clip_pads, else the frozen
--     per-strictness table pre-048 matches were cut with);
--   * clears the observed endings (scored_at_cut_s, rally_end_cut_s) when
--     the END moved. Those say "the rally was over by here"; a player who
--     deliberately extended the end has overruled them, and until now the
--     old tap won again the moment the stale flag cleared, so the extension
--     was never played in Score the Match and was cut from reels. The undo
--     path passes the previous values back.
--   * leaves `edited` to the points_mark_edited trigger, as before.
--
-- The apps mirror the same arithmetic optimistically (clipEdit.ts /
-- Playhead.swift reanchorCutT0) and then take this function's row as truth.

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
  v_pads jsonb;
  v_strictness text;
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

  -- The pads this match's clips were cut with (048), else the frozen
  -- table pre-048 clips were cut with (clipEdit.ts CLIP_PAD).
  select m.clip_pads, j.options->>'strictness'
    into v_pads, v_strictness
    from public.matches m
    left join public.jobs j on j.id = m.job_id
   where m.id = orig.match_id;
  if v_pads is not null and jsonb_typeof(v_pads->'pre') = 'number' then
    v_pre := (v_pads->>'pre')::numeric;
  else
    v_pre := case coalesce(v_strictness, 'normal')
               when 'tight' then 0.5
               when 'loose' then 1.6
               else 1.0
             end;
  end if;

  v_tight_start := coalesce(
    p_tight_start,
    case when orig.tight_start and p_t0 <> orig.t0 then false
         else orig.tight_start end);
  v_tight_end := coalesce(
    p_tight_end,
    case when orig.tight_end and p_t1 <> orig.t1 then false
         else orig.tight_end end);

  -- A split edge keeps min(pad, 0.3) of context (TIGHT_PAD, clipEdit.ts /
  -- worker TIGHT_PAD); a full edge keeps the whole pad.
  v_eff_pre_old := case when orig.tight_start then least(v_pre, 0.3) else v_pre end;
  v_eff_pre_new := case when v_tight_start then least(v_pre, 0.3) else v_pre end;
  v_anchor_old := greatest(0, orig.t0 - v_eff_pre_old);
  v_anchor_new := greatest(0, p_t0 - v_eff_pre_new);
  if orig.cut_t0 is null then
    v_cut_t0 := null;   -- legacy pre-011 cut: nothing to anchor against
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

revoke execute on function public.adjust_point(
  uuid, numeric, numeric, boolean, boolean, numeric, numeric)
  from public, anon;
grant execute on function public.adjust_point(
  uuid, numeric, numeric, boolean, boolean, numeric, numeric)
  to authenticated;

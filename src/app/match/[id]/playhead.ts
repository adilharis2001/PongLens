import type { Point } from "@/lib/types";
import { effectivePad } from "./clipEdit";

/**
 * Shared playhead -> point resolvers for the cut video.
 *
 * ANCHORING FACT (the root of every helper here): points.cut_t0 is the
 * PADDED clip start inside the cut video — source t0 MINUS the point's
 * EFFECTIVE pre pad — not the serve itself. worker/points_pipeline.py
 * anchors cut_t0 on c0 = max(0, t0 - pre) "so a seek lands on the same
 * frame the point clip opens on", and the reel route's segment math builds
 * on the same fact. The worker keeps source durations intact in the cut,
 * so in cut-video seconds a rally spans:
 *
 *   cut_t0 ──pre──> serve ──(t1 - t0)──> rally end ──post──> clip end
 *
 * Anything that treated cut_t0 + (t1 - t0) as the rally end was
 * systematically pad.pre (~1s at normal strictness) EARLY — the
 * Keep-score auto-pause fired before the deciding shot. Every end helper
 * therefore takes the job's ClipPad (clipPad(strictness), threaded down
 * from the match page).
 *
 * TIGHT SPLIT EDGES: a split-boundary edge (points.tight_start/tight_end)
 * is padded with min(pad, TIGHT_PAD)=0.3s, not the full strictness pad —
 * both in the reclipped preview clip AND in the cut_t0 anchoring of
 * split-born points (the split flow anchors the child's cut_t0 on
 * child_t0 - 0.3 inside the still-contiguous cut footage). So every
 * helper here derives the point's effectivePad() from its tight flags:
 * with a full pre on a tight_start point the serve would be placed
 * pad.pre - 0.3 (~0.7s at normal) LATE, and a full post on a tight_end
 * parent would overhang into the sibling's rally (the boundary pause and
 * deleted-span extents must stop ~at the split moment).
 */

export type ClipPad = { pre: number; post: number };

/** Seconds into the cut video where a point's rally actually ends (the
 *  deciding shot): cut_t0 + effective pre + (t1 - t0). */
export function rallyEnd(p: Point, pad: ClipPad): number | null {
  if (p.cut_t0 === null || p.t0 === null || p.t1 === null) return null;
  const eff = effectivePad(pad, p.tight_start, p.tight_end);
  return (
    Number(p.cut_t0) + eff.pre + Math.max(0, Number(p.t1) - Number(p.t0))
  );
}

/** Full padded clip end — rallyEnd + the whole effective post pad. Matches
 *  the reel route's segment end exactly: cut_t0 + effPre + (t1 - t0) +
 *  effPost. Use for footage extents (deleted spans, review clip clamp). */
export function paddedEnd(p: Point, pad: ClipPad): number | null {
  const end = rallyEnd(p, pad);
  if (end === null) return null;
  return end + effectivePad(pad, p.tight_start, p.tight_end).post;
}

/**
 * Inverse of the ANCHORING FACT: the SOURCE-video time for a cut-video
 * time T that lies inside point p's span. The cut preserves source
 * durations within an activity span and anchors cut_t0 on
 * max(0, t0 - effPre) (the padded clip start), so mapping a cut time back
 * to source is exact:
 *
 *   source(T) = max(0, t0 - effPre) + (T - cut_t0)
 *
 * This is the read-side twin of PointDetail's cut(x) = cut_t0 + (x - anchor)
 * and the single source of truth for turning a Keep-score playhead into a
 * split's source at_t. Returns null on legacy points without the offsets.
 */
export function cutToSource(p: Point, t: number, pad: ClipPad): number | null {
  if (p.cut_t0 === null || p.t0 === null) return null;
  const eff = effectivePad(pad, p.tight_start, p.tight_end);
  const anchor = Math.max(0, Number(p.t0) - eff.pre);
  return anchor + (t - Number(p.cut_t0));
}

/** Keep-score pause-at-point-end boundary: the rally end plus a beat of
 *  the effective post pad (capped at 0.6s) so the ball's landing and the
 *  players' reaction are on screen when the video freezes for the answer.
 *  (On a tight_end point that beat is the 0.3s sliver before the sibling's
 *  serve — the split moment is shared footage.) */
export function pauseEnd(p: Point, pad: ClipPad): number | null {
  const end = rallyEnd(p, pad);
  if (end === null) return null;
  return end + Math.min(effectivePad(pad, p.tight_start, p.tight_end).post, 0.6);
}

/**
 * WYSIWYG resolver: the point the playhead is inside (or just passed) —
 * the last point whose padded span start (cut_t0, with a 0.25s lead so a
 * ~250ms-granularity timeupdate still flips it by the serve) the playhead
 * has reached. This is the single source of truth for Keep-score: the
 * on-screen chip AND winner/skip/star taps both use it, so a tap always
 * scores exactly the rally the user is watching.
 * `points` must be the visible timeline, in order.
 * (Deliberately pad-free: cut_t0 IS the padded start — flipping there is
 * the intended "chip flips at/just before the serve" behavior.)
 */
export function playingPointId(points: Point[], t: number): string | null {
  let id: string | null = null;
  for (const p of points) {
    if (p.cut_t0 === null) continue;
    if (t >= Number(p.cut_t0) - 0.25) id = p.id;
    else break;
  }
  return id;
}

/**
 * Legacy "armed" resolver: the point whose rally END the playhead most
 * recently crossed. Keep-score no longer leads with it (it lagged one
 * rally behind what was on screen); it survives only as a defensive
 * fallback when playingPointId is null — which it never is anywhere
 * armedPointId would match, since a rally's end is always after its start.
 */
export function armedPointId(
  points: Point[],
  t: number,
  pad: ClipPad
): string | null {
  let id: string | null = null;
  for (const p of points) {
    const end = rallyEnd(p, pad);
    if (end === null) continue;
    if (t >= end - 0.15) id = p.id;
    else break;
  }
  return id;
}

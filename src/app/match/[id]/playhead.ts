import type { Point } from "@/lib/types";

/**
 * Shared playhead -> point resolvers for the cut video.
 *
 * ANCHORING FACT (the root of every helper here): points.cut_t0 is the
 * PADDED clip start inside the cut video — source t0 MINUS pad.pre — not
 * the serve itself. worker/points_pipeline.py anchors cut_t0 on
 * c0 = max(0, t0 - pre) "so a seek lands on the same frame the point clip
 * opens on", and the reel route's segment math builds on the same fact
 * (segEnd = cut_t0 + (t1 - t0) + pre + post). The worker keeps source
 * durations intact in the cut, so in cut-video seconds a rally spans:
 *
 *   cut_t0 ──pre──> serve ──(t1 - t0)──> rally end ──post──> clip end
 *
 * Anything that treated cut_t0 + (t1 - t0) as the rally end was
 * systematically pad.pre (~1s at normal strictness) EARLY — the
 * Keep-score auto-pause fired before the deciding shot. Every end helper
 * therefore takes the job's ClipPad (clipPad(strictness), threaded down
 * from the match page).
 */

export type ClipPad = { pre: number; post: number };

/** Seconds into the cut video where a point's rally actually ends (the
 *  deciding shot): cut_t0 + pre + (t1 - t0). */
export function rallyEnd(p: Point, pad: ClipPad): number | null {
  if (p.cut_t0 === null || p.t0 === null || p.t1 === null) return null;
  return (
    Number(p.cut_t0) + pad.pre + Math.max(0, Number(p.t1) - Number(p.t0))
  );
}

/** Full padded clip end — rallyEnd + the whole post pad. Matches the reel
 *  route's segment end exactly: cut_t0 + pre + (t1 - t0) + post. Use for
 *  footage extents (deleted spans, review clip clamp). */
export function paddedEnd(p: Point, pad: ClipPad): number | null {
  const end = rallyEnd(p, pad);
  return end === null ? null : end + pad.post;
}

/** Keep-score pause-at-point-end boundary: the rally end plus a beat of
 *  the post pad (capped at 0.6s) so the ball's landing and the players'
 *  reaction are on screen when the video freezes for the answer. */
export function pauseEnd(p: Point, pad: ClipPad): number | null {
  const end = rallyEnd(p, pad);
  return end === null ? null : end + Math.min(pad.post, 0.6);
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

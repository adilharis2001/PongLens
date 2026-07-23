import type { Point } from "@/lib/types";

/**
 * Shared playhead -> point resolvers for the cut video.
 *
 * Both the "Go to point" chip highlight and Keep-score mode read the same
 * timeline: points.cut_t0 is where a point starts inside the cut video and
 * its rally ends cut_t0 + (t1 - t0) later (the worker keeps source-video
 * durations intact in the cut).
 */

/** Seconds into the cut video where a point's rally ends. */
export function cutEnd(p: Point): number | null {
  if (p.cut_t0 === null || p.t0 === null || p.t1 === null) return null;
  return Number(p.cut_t0) + Math.max(0, Number(p.t1) - Number(p.t0));
}

/**
 * WYSIWYG resolver: the point the playhead is inside (or just passed) —
 * the last point whose padded span start (cut_t0, with a 0.25s lead so a
 * ~250ms-granularity timeupdate still flips it by the serve) the playhead
 * has reached. This is the single source of truth for Keep-score: the
 * on-screen chip AND winner/skip/star taps both use it, so a tap always
 * scores exactly the rally the user is watching.
 * `points` must be the visible timeline, in order.
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
 * Legacy "armed" resolver: the point whose END the playhead most recently
 * crossed. Keep-score no longer leads with it (it lagged one rally behind
 * what was on screen); it survives only as a defensive fallback when
 * playingPointId is null — which it never is anywhere armedPointId would
 * match, since a rally's end is always after its start.
 */
export function armedPointId(points: Point[], t: number): string | null {
  let id: string | null = null;
  for (const p of points) {
    const end = cutEnd(p);
    if (end === null) continue;
    if (t >= end - 0.15) id = p.id;
    else break;
  }
  return id;
}

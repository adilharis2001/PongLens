import type { Placement, Point } from "@/lib/types";
import { effectivePad } from "./clipEdit";
import type { ClipPad } from "./playhead";

/**
 * "Does this clip actually hold two rallies?"
 *
 * The cutter splits on quiet: when two points are played back to back the
 * gap between them can fall under its threshold and both land in one clip.
 * The reviewer then answers the first rally, the pad advances, and the
 * second rally is never seen — which surfaces much later as a serve
 * rotation that stops matching, or a game that ends at 10.
 *
 * The evidence is already in the row. points.placement carries every
 * detected bounce/contact with a timestamp (SOURCE seconds), so a stretch
 * with no ball activity, with real play on both sides of it, is exactly the
 * between-points gap the cutter missed. No worker round trip, no new column.
 *
 * This is a HINT, never an action: a false gap (a long serve routine, a ball
 * chased down the hall) must never split a point on its own. It only decides
 * WHERE a split lands once a human asks for one, and how confidently the
 * offer is worded.
 */

/** A quiet stretch has to be at least this long to read as "between points". */
const MIN_GAP_S = 1.5;
/** Play on both sides means at least this many detections each side. */
const MIN_SIDE_EVENTS = 2;
/** Matches split_point's interior window (and PointDetail's guard). */
const EDGE_S = 0.3;

/** Detection times inside a point, SOURCE seconds, ascending. */
function eventTimes(placement: Placement | null): number[] {
  if (!placement || !("v" in placement) || placement.v !== 3) return [];
  const out: number[] = [];
  for (const c of placement.candidates ?? []) {
    if (typeof c.t === "number" && Number.isFinite(c.t)) out.push(c.t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The best place to cut a clip that looks like two points, in CUT-video
 * seconds, or null when nothing about it looks fused.
 *
 * The midpoint of the longest qualifying quiet stretch — a better cut than
 * "wherever the playhead was when you noticed", which is always late.
 */
export function fusedSplitCut(p: Point, pad: ClipPad): number | null {
  if (p.cut_t0 === null || p.t0 === null || p.t1 === null) return null;
  const times = eventTimes(p.placement);
  if (times.length < MIN_SIDE_EVENTS * 2) return null;

  const t0 = Number(p.t0);
  const t1 = Number(p.t1);
  let best: { at: number; gap: number } | null = null;
  for (let i = MIN_SIDE_EVENTS - 1; i < times.length - MIN_SIDE_EVENTS; i++) {
    const gap = times[i + 1] - times[i];
    if (gap < MIN_GAP_S) continue;
    const at = times[i] + gap / 2;
    // A gap at the very edge is the pre/post pad, not a second rally.
    if (at <= t0 + EDGE_S || at >= t1 - EDGE_S) continue;
    if (!best || gap > best.gap) best = { at, gap };
  }
  if (!best) return null;

  // Source -> cut seconds: the cut keeps source durations inside a span and
  // anchors cut_t0 on the padded start (see playhead.ts).
  const eff = effectivePad(pad, p.tight_start, p.tight_end);
  const anchor = Math.max(0, t0 - eff.pre);
  return Math.round((Number(p.cut_t0) + (best.at - anchor)) * 100) / 100;
}

import type { Point } from "@/lib/types";
// The .ts extension keeps this module runnable under node --test (see
// playhead.test.ts); allowImportingTsExtensions covers the app build.
import { effectivePad } from "./clipEdit.ts";

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

/** Margin kept after the winner tap: the 2026-08-16 boundary study puts
 *  the tap at the rally's true end at the median but up to ~0.7s early,
 *  so half a second stays on before the cut. */
const TAP_END_GUARD_S = 0.5;

/**
 * Where a point's footage EFFECTIVELY ends, for playback and renders.
 *
 * When the owner scored the point in Keep score's flowing session,
 * scored_at_cut_s is the playhead at the winner tap — a human saying
 * "decided by here" (067). Everything after tap + 0.5s is ball retrieval
 * and walking: median 1.4s per point, ~25% of a scored match's cut
 * (docs/research/2026-08-25-tap-end-shave.md).
 *
 * A CLAMP, never an extension: min(paddedEnd, tap + 0.5s). The tap is
 * ignored — the padded end stands — when
 *   - `on` is false (app_config.tap_end_playback, the kill switch),
 *   - the point was hand-edited: the clip editor is explicit intent
 *     about boundaries and the tap predates the edit,
 *   - the tap lands before its own clip's start, which describes no
 *     point that can happen (a stale or slipped tap).
 */
export function effectiveEnd(
  p: Point,
  pad: ClipPad,
  on: boolean
): number | null {
  const padded = paddedEnd(p, pad);
  if (padded === null || !on) return padded;
  const tap = p.scored_at_cut_s;
  if (tap === null || tap === undefined || p.edited) return padded;
  if (p.cut_t0 === null || p.cut_t0 === undefined) return padded;
  if (Number(tap) < Number(p.cut_t0)) return padded;
  return Math.min(padded, Number(tap) + TAP_END_GUARD_S);
}

/**
 * The highlights tape's ONE authority for what happens at a playhead
 * position. While the tape is up, everything outside the picked spans is
 * dead by definition — including deleted cards and lets — so the tape
 * must never delegate to the other skip mechanisms: doing so crossed the
 * gap between two picks in two or three visible hops (deleted-span skip
 * first, tape second), each rendering a beat of an unpicked serve. One
 * rule, one hop.
 *
 *   stay — inside a pick (with the 0.05s entry lead a seek deserves)
 *   jump — outside, with a pick still ahead: go straight to its start
 *   end  — past the last pick: the tape is over
 *
 * The 0.01s end epsilon makes a boundary fired exactly AT a span's end
 * read as outside it, so a frame-accurate callback jumps immediately
 * instead of waiting a tick. Mirrored in ScoreLogic.swift tapeMove —
 * the two must stay rule-identical.
 */
export type TapeMove =
  | { kind: "stay" }
  | { kind: "jump"; to: number }
  | { kind: "end" };

export function tapeMove(
  spans: { start: number; end: number }[],
  t: number
): TapeMove {
  if (spans.some((s) => t >= s.start - 0.05 && t < s.end - 0.01)) {
    return { kind: "stay" };
  }
  const next = spans.find((s) => s.start - 0.05 > t);
  return next ? { kind: "jump", to: next.start } : { kind: "end" };
}

/**
 * Dead footage spans for surfaces WITHOUT their own span builders (the
 * coach review workspace, the public share page). The match page's
 * Player/MatchView build these inline with per-mode nuances; this is the
 * plain union for players that only ever watch:
 *
 *   - every deleted card's footage, clamped to the next visible start
 *   - with tapEnd on, every tap-trimmed tail (effectiveEnd → next
 *     visible start; the last rally's tail runs only to its padded end)
 *
 * `rows` is EVERY point with cut offsets, deleted included, in timeline
 * order. Overlaps are merged. A player jumps a span's footage while
 * playing (never mid-scrub): seek to `end` when currentTime lands inside.
 */
export function skipSpans(
  rows: Point[],
  pad: ClipPad,
  tapEnd: boolean
): { start: number; end: number }[] {
  const withCut = rows.filter(
    (p) => p.cut_t0 !== null && p.cut_t0 !== undefined
  );
  const visible = withCut.filter((p) => !p.deleted);
  const spans: { start: number; end: number }[] = [];
  for (const p of withCut) {
    if (!p.deleted) continue;
    const start = Number(p.cut_t0);
    let end = paddedEnd(p, pad) ?? start;
    const next = visible.find((q) => Number(q.cut_t0) > start);
    if (next && end > Number(next.cut_t0)) end = Number(next.cut_t0);
    if (end > start) spans.push({ start, end });
  }
  if (tapEnd) {
    for (let i = 0; i < visible.length; i++) {
      const p = visible[i];
      const padded = paddedEnd(p, pad);
      const eff = effectiveEnd(p, pad, true);
      if (padded === null || eff === null || eff >= padded) continue;
      const next =
        i + 1 < visible.length ? Number(visible[i + 1].cut_t0) : padded;
      const end = Math.max(next, eff);
      if (end > eff + 0.05) spans.push({ start: eff, end });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp.start <= last.end + 0.01) {
      last.end = Math.max(last.end, sp.end);
    } else {
      merged.push({ ...sp });
    }
  }
  return merged;
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

/** How much of the post pad plays before the answer freeze. Was 0.6s,
 *  and the scoring taps showed it was too tight: on the first matches cut
 *  with the 1.3s post pad, 23-43% of taps landed within half a second of
 *  the boundary, and on points whose t1 lands early the freeze could
 *  arrive before the ball's bounce was even on screen. 1.2s stays inside
 *  the footage every pad era guarantees (post is 1.3s at minimum). */
const PAUSE_BEAT_S = 1.2;

/** Keep-score pause-at-point-end boundary: the rally end plus a beat of
 *  the effective post pad (capped at PAUSE_BEAT_S) so the ball's landing
 *  and the players' reaction are on screen when the video freezes for
 *  the answer. (On a tight_end point that beat is the 0.3s sliver before
 *  the sibling's serve — the split moment is shared footage.)
 *
 *  nextStart: the next visible point's cut_t0, when the caller knows it.
 *  The longer beat would otherwise overhang an adjacent rally's serve on
 *  dense cuts, so the freeze clamps to just before the next padded start
 *  — never earlier than the rally end itself. */
export function pauseEnd(
  p: Point,
  pad: ClipPad,
  nextStart?: number | null,
): number | null {
  const end = rallyEnd(p, pad);
  if (end === null) return null;
  const beat = Math.min(
    effectivePad(pad, p.tight_start, p.tight_end).post,
    PAUSE_BEAT_S,
  );
  const stop = end + beat;
  if (nextStart === null || nextStart === undefined) return stop;
  return Math.max(end, Math.min(stop, nextStart - 0.05));
}

/** The next visible point's padded start after p, for pauseEnd's clamp.
 *  `points` is the visible timeline in order. */
export function nextCutStart(points: Point[], p: Point): number | null {
  const i = points.findIndex((q) => q.id === p.id);
  if (i < 0) return null;
  for (let j = i + 1; j < points.length; j++) {
    const c = points[j].cut_t0;
    if (c !== null) return Number(c);
  }
  return null;
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

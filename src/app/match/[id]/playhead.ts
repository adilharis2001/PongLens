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

/** app_config.unscored_rally_end and its buffer, threaded from the server
 *  the same way tapEnd is. Absent means off. */
export type RallyEndConfig = { on: boolean; bufferS: number };

/**
 * How far the point's own end may sit past the observed ending before the
 * ending is refused.
 *
 * points_v2.rally_end_ev sets a card's end to min(lastBounce + 2.6, ...),
 * so when the bounce is what ended the card the gap CANNOT exceed
 * TAIL_AFTER_BOUNCE. A bigger gap is proof the end came from somewhere
 * else — the crossing chain, the rally cap, or a bounce the detector never
 * found — and the "ending" is then just the last bounce it happened to
 * see, which can be most of a rally early.
 *
 * This is not hypothetical. On the review page the very first row was a
 * 16.5s Chris rally with ONE bounce detected, at 2.2s: trimming to it
 * would have thrown away thirteen seconds of live play. 19% of backfilled
 * points fail this test, and every one of them keeps today's behaviour.
 */
const RALLY_END_MAX_TAIL_S = 2.7;

/**
 * Which endings are allowed to shorten a point.
 *
 * An object rather than a second boolean: there are ten call sites, and a
 * positional flag that quietly means one thing at some of them and another
 * at the rest is how the surfaces drift apart. Naming both forces every
 * caller to say what it wants.
 */
export type EndOptions = {
  /** app_config.tap_end_playback. */
  tapEnd: boolean;
  rallyEnd?: RallyEndConfig | null;
};

/**
 * Where a point's footage EFFECTIVELY ends, for playback and renders.
 *
 * Two endings can shorten a point, and they are ranked, not combined.
 *
 * 1. THE TAP. When the owner scored the point in Keep score's flowing
 *    session, scored_at_cut_s is the playhead at the winner tap — a human
 *    saying "decided by here" (067). Everything after tap + 0.5s is ball
 *    retrieval and walking: median 1.4s per point, ~25% of a scored
 *    match's cut (docs/research/2026-08-25-tap-end-shave.md).
 *
 * 2. THE RALLY. When nobody scored, points.rally_end_cut_s holds the last
 *    moment the ball was played — the last bounce on the user's own table,
 *    or a bat touch after it, since a defender standing metres back leaves
 *    the ball in the air for over a second between the two. t1 pads that
 *    by 2.6s precisely so a winner tap would land inside, and no tap is
 *    coming on an unscored match, so the padding is ball retrieval
 *    (docs/superpowers/specs/2026-08-27-unscored-rally-end.md).
 *
 * The tap WINS wherever it exists. It is a person watching the point; the
 * bounce is a detector that can miss the last shot of a rally that ended
 * off the table. Falling back to the bounce on a scored point would trade
 * better evidence for worse.
 *
 * A CLAMP, never an extension, at every rung: the result can only be
 * earlier than paddedEnd, never later. Both are ignored when
 *   - the flag is off (each has its own kill switch),
 *   - the point was hand-edited: the clip editor is explicit intent about
 *     boundaries and both signals predate the edit,
 *   - the mark lands before its own clip's start, which describes no
 *     point that can happen (a stale or slipped value).
 */
export function effectiveEnd(
  p: Point,
  pad: ClipPad,
  opts: EndOptions
): number | null {
  const padded = paddedEnd(p, pad);
  if (padded === null) return null;
  if (p.cut_t0 === null || p.cut_t0 === undefined) return padded;
  // A hand edit outranks every automatic ending, so this test comes before
  // either rung rather than inside both.
  if (p.edited) return padded;
  const start = Number(p.cut_t0);

  // A SCORED point is settled here either way. If the tap is usable and
  // its flag is on, it trims; otherwise the padded end stands. It never
  // falls through to the rally, and that is the point of testing for the
  // tap's existence rather than for its flag: switching tap trimming off
  // must not quietly hand these points to a weaker signal, and a tap that
  // slipped is not evidence that a detector should be trusted instead.
  const tap = p.scored_at_cut_s;
  if (tap !== null && tap !== undefined) {
    if (opts.tapEnd && Number(tap) >= start) {
      return Math.min(padded, Number(tap) + TAP_END_GUARD_S);
    }
    return padded;
  }

  const rally = p.rally_end_cut_s;
  const own = rallyEnd(p, pad);
  if (
    opts.rallyEnd?.on
    && rally !== null && rally !== undefined
    && Number(rally) >= start
    // The ending must explain where this point already ends. When it does
    // not, the detector lost the ball rather than watched it stop.
    && own !== null && own - Number(rally) <= RALLY_END_MAX_TAIL_S
  ) {
    return Math.min(padded, Number(rally) + opts.rallyEnd.bufferS);
  }
  return padded;
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
 *   - every trimmed tail, whether the trim came from the winner tap or
 *     from the observed rally end (effectiveEnd → next visible start; the
 *     last rally's tail runs only to its padded end)
 *
 * `rows` is EVERY point with cut offsets, deleted included, in timeline
 * order. Overlaps are merged. A player jumps a span's footage while
 * playing (never mid-scrub): seek to `end` when currentTime lands inside.
 */
/**
 * Two skips closer than this fuse into one.
 *
 * The cut keeps a sliver of footage between adjacent clips — a few tenths
 * of a second of padding belonging to no card — so a RUN of deleted
 * rallies came out as a run of separate jumps with a flash of dead footage
 * between each, and every jump costs a seek. Measured on the shared Louis
 * match, whose first nineteen rallies were a deleted warm-up: nineteen
 * jumps, 6.5s of warm-up played between them, before the first real point.
 * Under the old 0.01 tolerance not one of those nineteen fused.
 *
 * A second is comfortably inside the padding it targets and comfortably
 * under the shortest rally — but the tolerance is not what makes this
 * safe. `overAKeptRally` is: no merge may ever span a point somebody kept,
 * at any tolerance.
 */
const SKIP_MERGE_GAP_S = 1;
/** Float slop when comparing two cut-clock seconds for "same moment". */
const EDGE_EPS_S = 0.01;

export function skipSpans(
  rows: Point[],
  pad: ClipPad,
  opts: EndOptions
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
  // Either ending shortens a point, so either one leaves a tail to jump.
  // Asking effectiveEnd rather than re-deriving the trim is what keeps the
  // skipped footage and the stopping point the same number.
  if (opts.tapEnd || opts.rallyEnd?.on) {
    for (let i = 0; i < visible.length; i++) {
      const p = visible[i];
      const padded = paddedEnd(p, pad);
      const eff = effectiveEnd(p, pad, opts);
      if (padded === null || eff === null || eff >= padded) continue;
      const next =
        i + 1 < visible.length ? Number(visible[i + 1].cut_t0) : padded;
      const end = Math.max(next, eff);
      if (end > eff + 0.05) spans.push({ start: eff, end });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // A rally somebody KEPT may never be fused across — the guard, not the
  // tolerance, is what makes merging safe. Sorted here rather than trusted
  // from the caller: skipSpans takes whatever row order it is handed.
  const visibleStarts = visible
    .map((p) => Number(p.cut_t0))
    .sort((a, b) => a - b);
  const merged: { start: number; end: number }[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    // Only a genuine forward gap can hide a kept rally; overlapping spans
    // invert this range and match nothing, which is the intent.
    const overAKeptRally =
      last !== undefined &&
      visibleStarts.some(
        (s) => s >= last.end - EDGE_EPS_S && s <= sp.start + EDGE_EPS_S
      );
    if (last && !overAKeptRally && sp.start <= last.end + SKIP_MERGE_GAP_S) {
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

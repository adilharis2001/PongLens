import type { Point } from "@/lib/types";
import { effectivePad } from "./clipEdit.ts";
import type { ClipPad } from "./playhead.ts";

/**
 * The geometry behind "add a missing rally".
 *
 * A rally the cutter dropped is a missing BEAT, not a mislabelled one: the
 * serve rotation is a count, so restoring the card fixes the rotation, the
 * score and the game boundaries at once, where correcting who served can
 * only paper over it. This module works out where such a card can go and
 * where it lands in the cut video.
 *
 * THE COORDINATE SPACE IS SOURCE SECONDS, not cut seconds — the one real
 * difference from every other clip surface in the app. Within a single
 * point's span the cut keeps source duration intact, so Split and Adjust
 * can use one linear map and work in cut seconds throughout. Across a SEAM
 * they cannot: the cutter removed footage between the two cards, so the cut
 * timeline jumps while the source runs on. Measured across 9,433 seams,
 * 55% are continuous and the rest drop anything from a fraction of a second
 * to over a minute. Source seconds are the only axis the whole
 * neighbourhood shares, so the timeline is drawn on that and mapped INTO
 * the cut for playback.
 */

/** A point with the timing fields this module needs. */
export type Neighbour = Pick<
  Point,
  "id" | "t0" | "t1" | "cut_t0" | "tight_start" | "tight_end"
> | null;

export interface SpanGeometry {
  /** rally start / end, in cut-video seconds */
  rallyStart: number;
  rallyEnd: number;
  /** source seconds */
  t0: number;
  t1: number;
}

/** Where a card's rally sits in the cut video. Null when it has no timing
 *  or predates cut_t0 (legacy matches), which makes it unusable as an
 *  anchor. */
export function spanOf(p: Neighbour, pad: ClipPad): SpanGeometry | null {
  if (!p || p.cut_t0 === null || p.t0 === null || p.t1 === null) return null;
  const eff = effectivePad(pad, p.tight_start, p.tight_end);
  const t0 = Number(p.t0);
  const t1 = Number(p.t1);
  const rallyStart = Number(p.cut_t0) + eff.pre;
  return { rallyStart, rallyEnd: rallyStart + Math.max(0, t1 - t0), t0, t1 };
}

export interface Seam {
  /** the whole neighbourhood, in source seconds */
  from: number;
  to: number;
  /** the hole between the two cards, in source seconds */
  gapFrom: number;
  gapTo: number;
  /** source seconds in the gap that are NOT in the cut video */
  removed: number;
  /** the cut is unbroken here: everything in the gap is watchable */
  continuous: boolean;
  prev: SpanGeometry | null;
  next: SpanGeometry | null;
}

/** How much room to show either side when a card is missing on one side. */
const OPEN_END_S = 15;
/** Below this, "removed" is padding arithmetic rather than lost footage. */
const CONTINUOUS_S = 0.25;

export function seamBetween(
  prevPoint: Neighbour,
  nextPoint: Neighbour,
  pad: ClipPad
): Seam | null {
  const prev = spanOf(prevPoint, pad);
  const next = spanOf(nextPoint, pad);
  if (!prev && !next) return null;
  const gapFrom = prev ? prev.t1 : (next as SpanGeometry).t0 - OPEN_END_S;
  const gapTo = next ? next.t0 : (prev as SpanGeometry).t1 + OPEN_END_S;
  // What the cut dropped between the two rallies: how far the source
  // travelled between the two rally starts, less how far the cut did.
  const removed =
    prev && next
      ? Math.max(
          0,
          next.t0 - prev.t0 - (next.rallyStart - prev.rallyStart)
        )
      : 0;
  return {
    from: prev ? prev.t0 : gapFrom,
    to: next ? next.t1 : gapTo,
    gapFrom,
    gapTo,
    removed,
    continuous: removed < CONTINUOUS_S,
    prev,
    next,
  };
}

/**
 * Source second -> cut second.
 *
 * Inside either neighbour's rally the map is exact. Inside the gap there is
 * no answer to give — that footage is not in this video — so it returns the
 * seam itself, which is where the cut jumps from one card to the other.
 * Callers use `playableAt` to know whether they are being told a real
 * moment or the edge of one.
 */
export function sourceToCut(seam: Seam, s: number): number {
  const { prev, next } = seam;
  if (prev && s <= prev.t1) {
    return prev.rallyStart + (s - prev.t0);
  }
  if (next && s >= next.t0) {
    return next.rallyStart + (s - next.t0);
  }
  // In the hole: hold at the last frame the cut actually has.
  if (prev) return prev.rallyEnd;
  if (next) return next.rallyStart;
  return 0;
}

/** Whether a source second is footage this video can show. */
export function playableAt(seam: Seam, s: number): boolean {
  if (seam.continuous) return true;
  const { prev, next } = seam;
  if (prev && s <= prev.t1) return true;
  if (next && s >= next.t0) return true;
  return false;
}

export interface Window {
  t0: number;
  t1: number;
}

/** The shortest thing that can be a rally. Matches insert_point's guard. */
export const MIN_LEN_S = 0.5;
/** How much of each neighbour the new card must leave behind. Matches
 *  insert_point's "swallows the previous/next point" guard. */
export const EDGE_S = 0.3;

/**
 * Where the handles open.
 *
 * The gap itself when there is a real one — the common case, a rally the
 * cutter dropped whole. When the gap is too small to be a rally the missing
 * one was smeared across the neighbours instead, so the window opens
 * straddling the seam and the owner drags it out into them.
 */
export function defaultWindow(seam: Seam): Window {
  const gap = seam.gapTo - seam.gapFrom;
  if (gap >= 1.5) return { t0: seam.gapFrom, t1: seam.gapTo };
  const mid = (seam.gapFrom + seam.gapTo) / 2;
  return clampWindow(seam, { t0: mid - 0.75, t1: mid + 0.75 });
}

/** The furthest the handles may travel, in source seconds. */
export function bounds(seam: Seam): { lo: number; hi: number } {
  return {
    lo: seam.prev ? seam.prev.t0 + EDGE_S : seam.from,
    hi: seam.next ? seam.next.t1 - EDGE_S : seam.to,
  };
}

/** Hold a window inside the neighbours and no shorter than a rally. */
export function clampWindow(seam: Seam, w: Window): Window {
  const { lo, hi } = bounds(seam);
  let t0 = Math.min(Math.max(w.t0, lo), hi - MIN_LEN_S);
  let t1 = Math.max(Math.min(w.t1, hi), lo + MIN_LEN_S);
  if (t1 - t0 < MIN_LEN_S) t1 = t0 + MIN_LEN_S;
  t0 = Math.round(t0 * 100) / 100;
  t1 = Math.round(t1 * 100) / 100;
  return { t0, t1 };
}

/** Drag one handle, keeping the other still and the window legal. */
export function moveHandle(
  seam: Seam,
  w: Window,
  edge: "start" | "end",
  to: number
): Window {
  const { lo, hi } = bounds(seam);
  if (edge === "start") {
    const t0 = Math.min(Math.max(to, lo), w.t1 - MIN_LEN_S);
    return { t0: Math.round(t0 * 100) / 100, t1: w.t1 };
  }
  const t1 = Math.max(Math.min(to, hi), w.t0 + MIN_LEN_S);
  return { t0: w.t0, t1: Math.round(t1 * 100) / 100 };
}

/**
 * The new card's cut_t0 — the span start, so the rally start less the pad
 * the clip will actually be cut with.
 *
 * NOT optional: the Keep-score strip skips any point without a cut_t0, so a
 * card created without one would be invisible in the very screen it was
 * created from. Both of the new card's edges are shared with a neighbour,
 * so both take the split pad (clipEdit's effectivePad), the same
 * arithmetic split_point's child_cut_t0 uses.
 */
export function cutT0For(seam: Seam, w: Window, pad: ClipPad): number {
  const eff = effectivePad(pad, !!seam.prev, !!seam.next);
  return Math.max(0, Math.round((sourceToCut(seam, w.t0) - eff.pre) * 100) / 100);
}

/**
 * Whether this seam is worth offering a "+" on.
 *
 * A rally plus the pauses either side of it is around ten seconds, and
 * ordinary between-point time is under four. Measured over 9,433 seams,
 * 19% clear eight seconds — roughly one offer per five cards, which reads
 * as "the video skipped here" rather than as a row of buttons.
 */
export const GAP_WORTH_OFFERING_S = 8;

export function gapWorthOffering(
  prevPoint: Neighbour,
  nextPoint: Neighbour,
  pad: ClipPad
): Seam | null {
  if (!prevPoint || !nextPoint) return null;
  const seam = seamBetween(prevPoint, nextPoint, pad);
  if (!seam || !seam.prev || !seam.next) return null;
  return seam.gapTo - seam.gapFrom >= GAP_WORTH_OFFERING_S ? seam : null;
}

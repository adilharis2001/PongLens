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
 * FOUR seconds, which is low on purpose. The first cut of this was eight,
 * reasoned from the length of a rally plus the pauses either side — and it
 * was blind to the case that actually hurts: a missed serve is re-served
 * within a couple of seconds, so the gap that swallowed one is short. There
 * is no signal that says a point was eaten (the serve detector fires on
 * about a third of serves, and we have no independent read of who served),
 * so the choice is only ever where to put an arbitrary line.
 *
 * The cost is real and was accepted with the numbers in hand: measured over
 * 9,433 seams, eight seconds offers on ~13 of a 73-card match and four on
 * ~33 — closer to one between every other pair. Adil's call, over a
 * two-tier version that would have kept a quiet affordance everywhere and a
 * loud one on the long gaps: a second visual language on this strip costs
 * more than the buttons do.
 */
export const GAP_WORTH_OFFERING_S = 4;

export function gapWorthOffering(
  prevPoint: Neighbour,
  nextPoint: Neighbour,
  pad: ClipPad
): Seam | null {
  const seam = seamBetween(prevPoint, nextPoint, pad);
  if (!seam) return null;
  // A seam with only ONE neighbour is the start or the end of the match, and
  // it always offers. A rally missing after the last card was unreachable
  // until 2026-08-31 — the offer was only ever drawn BETWEEN two cards, so
  // the loop that pairs each card with the one before it had nothing to pair
  // at either end. Kyle (cropped) ended with 17.6s of footage and a missed
  // final serve in it, and no way to say so.
  //
  // Whether that trailing footage exists at all is not knowable here (the
  // points' clock is the TRIMMED one, and the match row carries the raw
  // duration), so these two always appear and the sheet clamps the handles
  // to the file's real length once it loads. One extra offer per match end
  // is a cheaper mistake than an unreachable rally.
  if (!seam.prev || !seam.next) return seam;
  return seam.gapTo - seam.gapFrom >= GAP_WORTH_OFFERING_S ? seam : null;
}

/**
 * Whether the cut video can actually show this card, or whether the
 * ScoreKeeper has to play the card's OWN clip instead.
 *
 * The cut video is never re-assembled. An inserted card gets a cut_t0 so
 * the strip can show it, but if the seam it went into had footage removed,
 * that footage is not in the cut file — so playing from its cut_t0 plays
 * whatever comes next and the rally is silently skipped. Terry 2, card 45:
 * 12.5s removed at its seam, 14.5s of rally, and the cut jumps straight
 * from card 44's end to card 46's start.
 *
 * The test is room. Between the previous card's rally END and the next
 * card's rally START, the cut holds some number of seconds; if that is less
 * than this card's own duration, the cut cannot be showing it. A normally
 * cut card always has room by construction — the cut was built around it.
 *
 * Returns false when it cannot tell (no neighbours, missing timings), which
 * keeps the cut as the default and matches every card that predates this.
 */
export function needsOwnClip(
  prevPoint: Neighbour,
  point: Neighbour,
  nextPoint: Neighbour,
  pad: ClipPad,
  /** The cut file's real length, when the caller has the metadata. Only
   *  the one-sided cases need it: a card at the match's edge has a file
   *  edge where a neighbour would be. */
  cutDuration?: number | null
): boolean {
  const self = spanOf(point, pad);
  if (!self) return false;
  const prev = spanOf(prevPoint, pad);
  const next = spanOf(nextPoint, pad);
  const needed = self.t1 - self.t0;
  // Half a second of slack throughout: pads and rounding move these by
  // fractions, and a false positive costs a needless file swap.
  if (prev && next) {
    return next.rallyStart - prev.rallyEnd + 0.5 < needed;
  }
  // A card at the start or the end of the match: the room is bounded by
  // the file itself, so it needs the cut's real duration. A neighbour that
  // EXISTS but cannot anchor (legacy, no cut_t0) is not a file edge — that
  // stays "cannot tell", which keeps the cut as the default.
  if (cutDuration == null || cutDuration <= 0) return false;
  if (prev && nextPoint === null) {
    return cutDuration - prev.rallyEnd + 0.5 < needed;
  }
  if (next && prevPoint === null) {
    return next.rallyStart + 0.5 < needed;
  }
  return false;
}

/**
 * Which cards, over a whole timeline, the cut video cannot show.
 *
 * `rows` is the PHYSICAL timeline — deleted cards included, because their
 * footage still occupies the cut and they are true brackets for how much
 * room a seam holds. Order does not matter; anything without a cut anchor
 * is ignored.
 *
 * A RETROFITTED card must never bracket its neighbours. insert_point and
 * split_point both mint idx = max + 1, so a card whose idx is larger than
 * a later card's was added to the timeline after the cut was built — and
 * its span can describe footage the cut does not hold. On the Terry seam,
 * bracketing naively with the insert flagged real card 46 as unplayable,
 * because the insert's 14.5s virtual span overhangs 46's room. The room a
 * neighbour has is always measured between cards the cut was BUILT from.
 * (Known miss, accepted: two separate rallies inserted into one seam can
 * each fit the seam's room alone and neither gets flagged.)
 */
export function ownClipIds(
  rows: (NonNullable<Neighbour> & { idx: number })[],
  pad: ClipPad,
  cutDuration?: number | null
): Set<string> {
  const cut = rows
    .filter((p) => p.cut_t0 !== null)
    .sort((a, b) => Number(a.cut_t0) - Number(b.cut_t0));
  // idx of the earliest-created card AFTER each position; a card created
  // later than something that follows it was retrofitted in.
  const minIdxAfter: number[] = new Array(cut.length).fill(Infinity);
  for (let i = cut.length - 2; i >= 0; i--) {
    minIdxAfter[i] = Math.min(cut[i + 1].idx, minIdxAfter[i + 1]);
  }
  const retro = cut.map((p, i) => p.idx > minIdxAfter[i]);
  const out = new Set<string>();
  for (let i = 0; i < cut.length; i++) {
    let prev: Neighbour = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!retro[j]) { prev = cut[j]; break; }
    }
    let next: Neighbour = null;
    for (let j = i + 1; j < cut.length; j++) {
      if (!retro[j]) { next = cut[j]; break; }
    }
    if (needsOwnClip(prev, cut[i], next, pad, cutDuration)) {
      out.add(cut[i].id);
    }
  }
  return out;
}

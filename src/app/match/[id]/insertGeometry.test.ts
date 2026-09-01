import assert from "node:assert/strict";
import test from "node:test";

import type { Point } from "../../../lib/types.ts";
import type { ClipPad } from "./playhead.ts";
import {
  bounds,
  clampWindow,
  cutT0For,
  defaultWindow,
  gapWorthOffering,
  moveHandle,
  playableAt,
  needsOwnClip,
  ownClipIds,
  seamBetween,
  sourceToCut,
  spanOf,
} from "./insertGeometry.ts";

const PAD: ClipPad = { pre: 1.0, post: 1.6 };

function pt(
  id: string,
  t0: number,
  t1: number,
  cutT0: number,
  tight: { start?: boolean; end?: boolean } = {}
): Point {
  return {
    id,
    t0,
    t1,
    cut_t0: cutT0,
    tight_start: tight.start ?? false,
    tight_end: tight.end ?? false,
  } as unknown as Point;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * THE REAL SEAM — cards 2 and 3 of the Jose Suarez match
 * (5a6d1a61-c250-48cf-9a18-64548fc61e04, Westchester, 2026-08-29), where
 * the cutter dropped both of the owner's serves. 24.1 seconds of source
 * between the two rallies, 23.1 of which never made it into the cut.
 */
const JOSE_PREV = pt("c2", 24.47, 33.77, 20.02);
const JOSE_NEXT = pt("c3", 57.87, 64.77, 30.32);

test("a span is the rally's place in the cut video", () => {
  const s = spanOf(JOSE_PREV, PAD)!;
  assert.equal(round(s.rallyStart), 21.02); // cut_t0 + full pre pad
  assert.equal(round(s.rallyEnd), 30.32); // + the rally's own 9.30s
});

test("a split edge keeps only a sliver of pad", () => {
  const tight = spanOf(pt("x", 10, 20, 5, { start: true }), PAD)!;
  assert.equal(round(tight.rallyStart), 5.3); // 0.3, not 1.0
});

test("the Jose seam: 24.1s of source, 23.1s of it missing", () => {
  const seam = seamBetween(JOSE_PREV, JOSE_NEXT, PAD)!;
  assert.equal(round(seam.gapFrom), 33.77);
  assert.equal(round(seam.gapTo), 57.87);
  assert.equal(round(seam.gapTo - seam.gapFrom), 24.1);
  assert.equal(round(seam.removed), 23.1);
  assert.equal(seam.continuous, false);
  // The whole neighbourhood the handles can reach.
  assert.equal(round(seam.from), 24.47);
  assert.equal(round(seam.to), 64.77);
});

test("a continuous seam reports nothing removed", () => {
  // next starts in the cut exactly where prev's rally ended.
  const prev = pt("a", 10, 20, 4); // rally 5..15 in cut
  const next = pt("b", 21, 30, 15); // rally 16..25 in cut; source +1, cut +1
  const seam = seamBetween(prev, next, PAD)!;
  assert.equal(round(seam.removed), 0);
  assert.equal(seam.continuous, true);
});

test("source maps into the cut inside either rally, and holds at the seam", () => {
  const seam = seamBetween(JOSE_PREV, JOSE_NEXT, PAD)!;
  // inside prev
  assert.equal(round(sourceToCut(seam, 24.47)), 21.02);
  assert.equal(round(sourceToCut(seam, 33.77)), 30.32);
  // inside next
  assert.equal(round(sourceToCut(seam, 57.87)), 31.32);
  assert.equal(round(sourceToCut(seam, 64.77)), 38.22);
  // in the hole: the cut has nothing, so it holds at prev's last frame
  assert.equal(round(sourceToCut(seam, 45)), 30.32);
  assert.equal(playableAt(seam, 45), false);
  assert.equal(playableAt(seam, 30), true);
  assert.equal(playableAt(seam, 60), true);
});

test("every second of a continuous seam is watchable", () => {
  const seam = seamBetween(pt("a", 10, 20, 4), pt("b", 21, 30, 15), PAD)!;
  assert.equal(playableAt(seam, 20.5), true);
});

test("the handles open on the gap when there is a real one", () => {
  const seam = seamBetween(JOSE_PREV, JOSE_NEXT, PAD)!;
  const w = defaultWindow(seam);
  assert.equal(round(w.t0), 33.77);
  assert.equal(round(w.t1), 57.87);
});

test("a smeared rally opens straddling the seam instead", () => {
  // Neighbours almost touching: the missing rally is inside THEM, so the
  // window has to start on the boundary and be dragged outwards.
  const prev = pt("a", 10, 20, 4);
  const next = pt("b", 20.4, 30, 15);
  const seam = seamBetween(prev, next, PAD)!;
  const w = defaultWindow(seam);
  assert.ok(w.t0 < 20.2 && w.t1 > 20.2, `straddles the seam: ${w.t0}-${w.t1}`);
  assert.ok(w.t1 - w.t0 >= 1.4);
});

test("handles cannot swallow a neighbour whole", () => {
  const seam = seamBetween(JOSE_PREV, JOSE_NEXT, PAD)!;
  const b = bounds(seam);
  assert.equal(round(b.lo), 24.77); // prev.t0 + 0.3
  assert.equal(round(b.hi), 64.47); // next.t1 - 0.3
  const w = clampWindow(seam, { t0: 0, t1: 999 });
  assert.equal(round(w.t0), 24.77);
  assert.equal(round(w.t1), 64.47);
});

test("dragging one handle leaves the other alone and keeps a rally's length", () => {
  const seam = seamBetween(JOSE_PREV, JOSE_NEXT, PAD)!;
  const w = { t0: 33.77, t1: 57.87 };
  const pulledBack = moveHandle(seam, w, "start", 28);
  assert.equal(round(pulledBack.t0), 28); // reaches into prev, as intended
  assert.equal(round(pulledBack.t1), 57.87);
  // cannot cross the other handle
  const crossed = moveHandle(seam, w, "start", 99);
  assert.equal(round(crossed.t0), round(57.87 - 0.5));
  const pushedOn = moveHandle(seam, w, "end", 62);
  assert.equal(round(pushedOn.t1), 62); // reaches into next
});

test("the new card lands between its neighbours in the cut timeline", () => {
  const seam = seamBetween(JOSE_PREV, JOSE_NEXT, PAD)!;
  const cutT0 = cutT0For(seam, defaultWindow(seam), PAD);
  // Both edges are shared, so both take the 0.3 split pad.
  assert.equal(round(cutT0), 30.02);
  // The whole point of it: strictly after card 2's anchor and before card
  // 3's, so the strip shows the new card in the gap rather than dropping
  // it (a null cut_t0 is skipped by the strip entirely).
  assert.ok(cutT0 > Number(JOSE_PREV.cut_t0));
  assert.ok(cutT0 < Number(JOSE_NEXT.cut_t0));
});

test("a card can be added before the first rally or after the last", () => {
  const first = seamBetween(null, JOSE_NEXT, PAD)!;
  assert.equal(first.prev, null);
  assert.equal(round(first.gapTo), 57.87);
  assert.ok(first.gapFrom < first.gapTo);
  const last = seamBetween(JOSE_PREV, null, PAD)!;
  assert.equal(last.next, null);
  assert.equal(round(last.gapFrom), 33.77);
  // With no neighbour that side the outer edge keeps its full pad.
  assert.ok(cutT0For(last, defaultWindow(last), PAD) >= 0);
});

test("the offer appears where the video skipped, not between every card", () => {
  // The Jose seam: 24.1s, worth offering.
  assert.ok(gapWorthOffering(JOSE_PREV, JOSE_NEXT, PAD));
  // Ordinary between-point time: not.
  assert.equal(gapWorthOffering(pt("a", 10, 20, 4), pt("b", 21.2, 30, 15), PAD), null);
  // A missed serve, re-served quickly — the case eight seconds was blind to.
  assert.ok(gapWorthOffering(pt("a", 10, 20, 4), pt("b", 24.5, 30, 15), PAD));
  // Just under the line stays quiet.
  assert.equal(gapWorthOffering(pt("a", 10, 20, 4), pt("b", 23.5, 30, 15), PAD), null);
  // The two ENDS always offer: a rally missing after the last card was
  // unreachable until 2026-08-31, which is how Kyle (cropped) ended with a
  // missed serve in 17.6s of trailing footage and no way to add it.
  assert.ok(gapWorthOffering(null, JOSE_NEXT, PAD), "before the first card");
  assert.ok(gapWorthOffering(JOSE_PREV, null, PAD), "after the last card");
});

test("a legacy point with no cut_t0 cannot anchor anything", () => {
  const legacy = { id: "z", t0: 1, t1: 2, cut_t0: null } as unknown as Point;
  assert.equal(spanOf(legacy, PAD), null);
  // It is not rejected outright any more — the two ends of a match offer
  // with one neighbour — but it must never become the ANCHOR: a point with
  // no place in the cut cannot say where anything else goes. The strip
  // never passes one anyway, since it filters on cut_t0 first.
  const seam = gapWorthOffering(legacy, JOSE_NEXT, PAD);
  assert.equal(seam?.prev, null);
});

/**
 * TERRY 2, CARD 45 — the inserted card that played the wrong rally.
 * Real numbers: card 44 ends at cut 678.9, card 46 starts at cut 690.6, and
 * the 14.5s rally inserted between them had 12.5s removed at its seam. The
 * cut holds 11.7s there, so it cannot be showing a 14.5s rally.
 */
const T_PREV = pt("c44", 860.0, 868.4, 670.5);
const T_INSERT = pt("c45", 880.9, 895.4, 678.9);
const T_NEXT = pt("c46", 895.4, 904.3, 690.6);

test("an insert into a cut-away seam has to play its own clip", () => {
  assert.equal(needsOwnClip(T_PREV, T_INSERT, T_NEXT, PAD), true);
});

test("a normally cut card is shown by the cut video", () => {
  // The cut was built around it, so there is always room.
  assert.equal(needsOwnClip(T_PREV, T_NEXT, pt("c47", 906, 915, 701.2), PAD), false);
  assert.equal(
    needsOwnClip(JOSE_PREV, JOSE_NEXT, pt("x", 70, 78, 43.5), PAD),
    false
  );
});

test("an insert into a CONTINUOUS seam stays on the cut video", () => {
  // Nothing was removed, so the footage is already in the file.
  const a = pt("a", 10, 20, 4);
  const mid = pt("m", 21, 29, 15);
  const b = pt("b", 30, 40, 24);
  assert.equal(needsOwnClip(a, mid, b, PAD), false);
});

test("it cannot tell without both neighbours, and says so", () => {
  assert.equal(needsOwnClip(null, T_INSERT, T_NEXT, PAD), false);
  assert.equal(needsOwnClip(T_PREV, T_INSERT, null, PAD), false);
});

/**
 * One-sided seams: a card at the match's edge has a file edge where a
 * neighbour would be, so the room test needs the cut's real duration.
 * This is the Kyle (cropped) shape — a missed final serve added after the
 * last card, with nothing behind it in the file.
 */
test("a tail insert past the cut's end needs its own clip", () => {
  const last = pt("last", 895.4, 904.3, 690.6); // rally end at cut 700.5
  const added = pt("add", 910.0, 914.0, 700.2); // 4s rally
  assert.equal(needsOwnClip(last, added, null, PAD, 701.8), true);
  // Without the duration it cannot tell, and stays on the cut.
  assert.equal(needsOwnClip(last, added, null, PAD), false);
});

test("the real first and last cards never trip the edge rules", () => {
  // The first card's footage opens the cut; the room from 0 to the next
  // rally covers it by construction.
  const first = pt("f", 10, 18, 0);
  const second = pt("s", 25, 31, 12.3);
  assert.equal(needsOwnClip(null, first, second, PAD, 600), false);
  // The last card's clip is what the cut ends with.
  const beforeLast = pt("bl", 500, 507, 570);
  const lastReal = pt("lr", 512, 519, 579.3);
  assert.equal(needsOwnClip(beforeLast, lastReal, null, PAD, 588.9), false);
});

/**
 * ownClipIds over the whole timeline. The trap this pins: the insert's own
 * 14.5s virtual span overhangs card 46's room, so bracketing 46 against it
 * flags a REAL card. The idx rule (insert_point mints max+1) keeps the
 * retrofitted card out of everyone else's brackets.
 */
test("ownClipIds flags the insert and never its real neighbours", () => {
  const rows = [
    { ...pt("c44", 860.0, 868.4, 670.5), idx: 44 },
    { ...pt("c45", 880.9, 895.4, 678.9), idx: 75 }, // the insert
    { ...pt("c46", 895.4, 904.3, 690.6), idx: 45 },
    { ...pt("c47", 906.0, 915.0, 701.2), idx: 46 },
  ];
  const ids = ownClipIds(rows, PAD, 720);
  assert.deepEqual([...ids], ["c45"]);
});

test("ownClipIds is quiet on an untouched timeline", () => {
  const rows = [
    { ...pt("a", 10, 18, 0), idx: 0 },
    { ...pt("b", 25, 31, 12.3), idx: 1 },
    { ...pt("c", 40, 49, 21.5), idx: 2 },
  ];
  // Duration = the last clip's padded end.
  assert.equal(ownClipIds(rows, PAD, 33.1).size, 0);
  // A split-born card (idx max+1, footage contiguous in the cut) is
  // retrofitted by idx but has room, so it stays on the cut too.
  const split = [
    { ...pt("a", 10, 18, 0), idx: 0 },
    { ...pt("b1", 25, 28, 12.3, { end: true }), idx: 3 },
    { ...pt("b2", 28.5, 31, 15.1, { start: true }), idx: 4 },
    { ...pt("c", 40, 49, 21.5), idx: 2 },
  ];
  assert.equal(ownClipIds(split, PAD, 33.1).size, 0);
});

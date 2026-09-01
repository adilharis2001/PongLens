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
  // Nothing to offer at the ends of the match.
  assert.equal(gapWorthOffering(null, JOSE_NEXT, PAD), null);
  assert.equal(gapWorthOffering(JOSE_PREV, null, PAD), null);
});

test("a legacy point with no cut_t0 cannot anchor anything", () => {
  const legacy = { id: "z", t0: 1, t1: 2, cut_t0: null } as unknown as Point;
  assert.equal(spanOf(legacy, PAD), null);
  assert.equal(gapWorthOffering(legacy, JOSE_NEXT, PAD), null);
});

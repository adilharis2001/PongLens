import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveEnd,
  nextCutStart,
  paddedEnd,
  pauseEnd,
  rallyEnd,
  skipSpans,
} from "./playhead.ts";
import type { Point } from "@/lib/types";

const PAD = { pre: 1.2, post: 1.3 };

function pt(over: Partial<Point>): Point {
  return {
    id: "p1",
    t0: 100,
    t1: 104,
    cut_t0: 50,
    tight_start: false,
    tight_end: false,
    ...over,
  } as Point;
}

test("the answer freeze sits a full beat after the rally end", () => {
  const p = pt({});
  const end = rallyEnd(p, PAD);
  assert.ok(end !== null);
  // effective post is 1.3, beat caps at 1.2 -> freeze at end + 1.2
  assert.equal(pauseEnd(p, PAD), end! + 1.2);
});

test("the freeze clamps just before an adjacent rally's padded start", () => {
  const p = pt({});
  const end = rallyEnd(p, PAD)!;
  // next card starts 0.4s after the rally end: freeze stops 0.05 short
  assert.equal(pauseEnd(p, PAD, end + 0.4), end + 0.35);
  // and never lands before the rally end itself, however close the next is
  assert.equal(pauseEnd(p, PAD, end - 1.0), end);
  // a far next card leaves the full beat intact
  assert.equal(pauseEnd(p, PAD, end + 10), end + 1.2);
});

test("a tight_end point keeps its 0.3s sliver", () => {
  const p = pt({ tight_end: true });
  const end = rallyEnd(p, PAD)!;
  assert.equal(pauseEnd(p, PAD), end + 0.3);
});

test("nextCutStart walks to the next visible cut point", () => {
  const a = pt({ id: "a", cut_t0: 10 });
  const b = pt({ id: "b", cut_t0: null });
  const c = pt({ id: "c", cut_t0: 30 });
  assert.equal(nextCutStart([a, b, c], a), 30);
  assert.equal(nextCutStart([a, b, c], c), null);
  assert.equal(nextCutStart([b, c], a), null);
});

// effectiveEnd (2026-08-25): the winner tap ends the point. A clamp,
// never an extension, and every doubtful case falls back to paddedEnd —
// the exact behavior the flag replaces.

test("the winner tap trims the padded end, plus its half-second guard", () => {
  // pt(): cut_t0 50, rally 100..104, pre 1.2 post 1.3 -> padded end 56.5.
  const p = pt({ scored_at_cut_s: 54.8 });
  assert.equal(paddedEnd(p, PAD), 56.5);
  assert.equal(effectiveEnd(p, PAD, true), 55.3);
});

test("a tap near the clip's end never pushes past it", () => {
  // tap + 0.5 would land at 56.9, beyond the 56.5 padded end: clamp wins.
  const p = pt({ scored_at_cut_s: 56.4 });
  assert.equal(effectiveEnd(p, PAD, true), 56.5);
});

test("the kill switch restores the padded end exactly", () => {
  const p = pt({ scored_at_cut_s: 54.8 });
  assert.equal(effectiveEnd(p, PAD, false), paddedEnd(p, PAD));
});

test("an untapped point keeps its padded end", () => {
  const p = pt({});
  assert.equal(effectiveEnd(p, PAD, true), paddedEnd(p, PAD));
  const cleared = pt({ scored_at_cut_s: null });
  assert.equal(effectiveEnd(cleared, PAD, true), paddedEnd(cleared, PAD));
});

test("a hand-edited point keeps its edited end, tap or no tap", () => {
  const p = pt({ scored_at_cut_s: 54.8, edited: true });
  assert.equal(effectiveEnd(p, PAD, true), paddedEnd(p, PAD));
});

test("a tap before its own clip start is a slip, not a boundary", () => {
  const p = pt({ scored_at_cut_s: 49.0 });
  assert.equal(effectiveEnd(p, PAD, true), paddedEnd(p, PAD));
});

test("no cut offsets, no answer — same null as paddedEnd", () => {
  const p = pt({ cut_t0: null, scored_at_cut_s: 54.8 });
  assert.equal(effectiveEnd(p, PAD, true), null);
});

// skipSpans: the plain dead-footage union for players without their own
// span builders (coach workspace, share page).

test("a deleted card's footage is a span, clamped to the next rally", () => {
  // a: rally 50..56.5 padded; junk: 58..64.5 padded; b starts at 62.
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104 });
  const junk = pt({ id: "j", cut_t0: 58, t0: 110, t1: 114, deleted: true });
  const b = pt({ id: "b", cut_t0: 62, t0: 120, t1: 124 });
  assert.deepEqual(skipSpans([a, junk, b], PAD, false), [
    { start: 58, end: 62 },
  ]);
});

test("a tap tail swallows the junk card behind it, one merged span", () => {
  // a tapped at 54: tail starts 54.5 and runs to b's start at 62,
  // absorbing the junk card's span on the way.
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104, scored_at_cut_s: 54 });
  const junk = pt({ id: "j", cut_t0: 58, t0: 110, t1: 114, deleted: true });
  const b = pt({ id: "b", cut_t0: 62, t0: 120, t1: 124 });
  assert.deepEqual(skipSpans([a, junk, b], PAD, true), [
    { start: 54.5, end: 62 },
  ]);
  // Flag off: only the junk card's footage is dead.
  assert.deepEqual(skipSpans([a, junk, b], PAD, false), [
    { start: 58, end: 62 },
  ]);
});

test("the last rally's tail stops at its own padded end", () => {
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104, scored_at_cut_s: 54 });
  // padded end 56.5: the zone is [54.5, 56.5), never to infinity.
  assert.deepEqual(skipSpans([a], PAD, true), [{ start: 54.5, end: 56.5 }]);
});

test("an untapped rally leaves no span — its tail plays as it always has", () => {
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104 });
  const b = pt({ id: "b", cut_t0: 62, t0: 120, t1: 124 });
  assert.deepEqual(skipSpans([a, b], PAD, true), []);
});

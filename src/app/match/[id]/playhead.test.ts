import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveEnd,
  nextCutStart,
  paddedEnd,
  pauseEnd,
  rallyEnd,
  skipSpans,
  tapeMove,
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
const TAP = { tapEnd: true };
const OFF = { tapEnd: false };
/** Both rungs live, which is how production runs it. */
const BOTH = { tapEnd: true, rallyEnd: { on: true, bufferS: 0.5 } };
/** Only the rally rung, for asserting it in isolation. */
const RALLY = { tapEnd: false, rallyEnd: { on: true, bufferS: 0.5 } };

test("the winner tap trims the padded end, plus its half-second guard", () => {
  // pt(): cut_t0 50, rally 100..104, pre 1.2 post 1.3 -> padded end 56.5.
  const p = pt({ scored_at_cut_s: 54.8 });
  assert.equal(paddedEnd(p, PAD), 56.5);
  assert.equal(effectiveEnd(p, PAD, TAP), 55.3);
});

test("a tap near the clip's end never pushes past it", () => {
  // tap + 0.5 would land at 56.9, beyond the 56.5 padded end: clamp wins.
  const p = pt({ scored_at_cut_s: 56.4 });
  assert.equal(effectiveEnd(p, PAD, TAP), 56.5);
});

test("the kill switch restores the padded end exactly", () => {
  const p = pt({ scored_at_cut_s: 54.8 });
  assert.equal(effectiveEnd(p, PAD, OFF), paddedEnd(p, PAD));
});

test("an untapped point keeps its padded end", () => {
  const p = pt({});
  assert.equal(effectiveEnd(p, PAD, TAP), paddedEnd(p, PAD));
  const cleared = pt({ scored_at_cut_s: null });
  assert.equal(effectiveEnd(cleared, PAD, TAP), paddedEnd(cleared, PAD));
});

test("a hand-edited point keeps its edited end, tap or no tap", () => {
  const p = pt({ scored_at_cut_s: 54.8, edited: true });
  assert.equal(effectiveEnd(p, PAD, TAP), paddedEnd(p, PAD));
});

test("a tap before its own clip start is a slip, not a boundary", () => {
  const p = pt({ scored_at_cut_s: 49.0 });
  assert.equal(effectiveEnd(p, PAD, TAP), paddedEnd(p, PAD));
});

test("no cut offsets, no answer — same null as paddedEnd", () => {
  const p = pt({ cut_t0: null, scored_at_cut_s: 54.8 });
  assert.equal(effectiveEnd(p, PAD, TAP), null);
});

// skipSpans: the plain dead-footage union for players without their own
// span builders (coach workspace, share page).

test("a deleted card's footage is a span, clamped to the next rally", () => {
  // a: rally 50..56.5 padded; junk: 58..64.5 padded; b starts at 62.
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104 });
  const junk = pt({ id: "j", cut_t0: 58, t0: 110, t1: 114, deleted: true });
  const b = pt({ id: "b", cut_t0: 62, t0: 120, t1: 124 });
  assert.deepEqual(skipSpans([a, junk, b], PAD, OFF), [
    { start: 58, end: 62 },
  ]);
});

test("a tap tail swallows the junk card behind it, one merged span", () => {
  // a tapped at 54: tail starts 54.5 and runs to b's start at 62,
  // absorbing the junk card's span on the way.
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104, scored_at_cut_s: 54 });
  const junk = pt({ id: "j", cut_t0: 58, t0: 110, t1: 114, deleted: true });
  const b = pt({ id: "b", cut_t0: 62, t0: 120, t1: 124 });
  assert.deepEqual(skipSpans([a, junk, b], PAD, TAP), [
    { start: 54.5, end: 62 },
  ]);
  // Flag off: only the junk card's footage is dead.
  assert.deepEqual(skipSpans([a, junk, b], PAD, OFF), [
    { start: 58, end: 62 },
  ]);
});

test("the last rally's tail stops at its own padded end", () => {
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104, scored_at_cut_s: 54 });
  // padded end 56.5: the zone is [54.5, 56.5), never to infinity.
  assert.deepEqual(skipSpans([a], PAD, TAP), [{ start: 54.5, end: 56.5 }]);
});

test("an untapped rally leaves no span — its tail plays as it always has", () => {
  const a = pt({ id: "a", cut_t0: 50, t0: 100, t1: 104 });
  const b = pt({ id: "b", cut_t0: 62, t0: 120, t1: 124 });
  assert.deepEqual(skipSpans([a, b], PAD, TAP), []);
});

// tapeMove: the highlights tape's one authority. The Swift twin pins the
// SAME numbers in ScoreLogicTests — change both or neither.

test("inside a pick the tape stays put", () => {
  const spans = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ];
  assert.deepEqual(tapeMove(spans, 15), { kind: "stay" });
  // The 0.05 entry lead: a seek that lands a breath early still counts.
  assert.deepEqual(tapeMove(spans, 9.96), { kind: "stay" });
});

test("outside a pick the tape jumps straight to the next one — one hop", () => {
  const spans = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ];
  assert.deepEqual(tapeMove(spans, 22), { kind: "jump", to: 30 });
  // Before the first pick: jump to it, never play the lead-in.
  assert.deepEqual(tapeMove(spans, 3), { kind: "jump", to: 10 });
});

test("a boundary fired exactly at a span's end jumps immediately", () => {
  const spans = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ];
  // t === end is already outside (the 0.01 end epsilon): no extra tick
  // of the next unpicked serve gets shown.
  assert.deepEqual(tapeMove(spans, 20), { kind: "jump", to: 30 });
  assert.deepEqual(tapeMove(spans, 19.995), { kind: "jump", to: 30 });
});

test("past the last pick the tape ends", () => {
  const spans = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ];
  assert.deepEqual(tapeMove(spans, 40), { kind: "end" });
  assert.deepEqual(tapeMove(spans, 55), { kind: "end" });
  assert.deepEqual(tapeMove([], 5), { kind: "end" });
});

// The rally rung (2026-08-27, 143): an UNSCORED point ends when the rally
// was last observed. Ranked below the tap, never combined with it, and the
// same clamp discipline throughout.

test("an unscored point ends at its observed rally end plus the buffer", () => {
  // pt(): cut_t0 50, rally 100..104, padded end 56.5. A rally observed to
  // end at 53.9 plus the 0.5s buffer is 54.4 — 2.1s earlier than today.
  const p = pt({ rally_end_cut_s: 53.9 });
  assert.equal(paddedEnd(p, PAD), 56.5);
  assert.equal(effectiveEnd(p, PAD, RALLY), 54.4);
  assert.equal(effectiveEnd(p, PAD, BOTH), 54.4);
});

test("the tap outranks the rally wherever both exist", () => {
  // The bounce would trim harder (54.4 vs 55.3). It still loses: a person
  // watched this point, and a detector can miss the last shot of a rally
  // that ended off the table.
  const p = pt({ scored_at_cut_s: 54.8, rally_end_cut_s: 53.9 });
  assert.equal(effectiveEnd(p, PAD, BOTH), 55.3);
});

test("a slipped tap falls back to the padded end, never to the rally", () => {
  // The point IS scored. Its human mark being unusable is no reason to
  // start trusting the detector on it.
  const p = pt({ scored_at_cut_s: 49.0, rally_end_cut_s: 53.9 });
  assert.equal(effectiveEnd(p, PAD, BOTH), paddedEnd(p, PAD));
});

test("with the tap flag off, a scored point still refuses the rally", () => {
  const p = pt({ scored_at_cut_s: 54.8, rally_end_cut_s: 53.9 });
  assert.equal(
    effectiveEnd(p, PAD, { tapEnd: false, rallyEnd: { on: true, bufferS: 0.5 } }),
    paddedEnd(p, PAD)
  );
});

test("the rally kill switch restores the padded end exactly", () => {
  const p = pt({ rally_end_cut_s: 53.9 });
  assert.equal(effectiveEnd(p, PAD, OFF), paddedEnd(p, PAD));
  assert.equal(effectiveEnd(p, PAD, TAP), paddedEnd(p, PAD));
});

test("a rally end near the clip's end never pushes past it", () => {
  const p = pt({ rally_end_cut_s: 56.4 });
  assert.equal(effectiveEnd(p, PAD, RALLY), 56.5);
});

test("no observed rally end means today's behaviour, not an early cut", () => {
  assert.equal(effectiveEnd(pt({}), PAD, RALLY), paddedEnd(pt({}), PAD));
  const cleared = pt({ rally_end_cut_s: null });
  assert.equal(effectiveEnd(cleared, PAD, RALLY), paddedEnd(cleared, PAD));
});

test("a rally end before its own clip start is refused", () => {
  const p = pt({ rally_end_cut_s: 49.0 });
  assert.equal(effectiveEnd(p, PAD, RALLY), paddedEnd(p, PAD));
});

test("a hand-edited point keeps its edited end, rally or no rally", () => {
  const p = pt({ rally_end_cut_s: 53.9, edited: true });
  assert.equal(effectiveEnd(p, PAD, BOTH), paddedEnd(p, PAD));
});

test("a bigger buffer trims less, and zero is not silently substituted", () => {
  const p = pt({ rally_end_cut_s: 53.9 });
  const at = (bufferS: number) =>
    effectiveEnd(p, PAD, { tapEnd: false, rallyEnd: { on: true, bufferS } });
  assert.equal(at(0.5), 54.4);
  assert.equal(at(1.5), 55.4);
  // Wide enough to exceed the clip: the clamp holds.
  assert.equal(at(9), 56.5);
});

test("skipSpans jumps a rally-trimmed tail, not only a tapped one", () => {
  const a = pt({ id: "a", cut_t0: 50, rally_end_cut_s: 53.9 });
  const b = pt({ id: "b", cut_t0: 60 });
  const spans = skipSpans([a, b], PAD, RALLY);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].start, 54.4);
  assert.equal(spans[0].end, 60);
  // Off, there is nothing to jump.
  assert.deepEqual(skipSpans([a, b], PAD, OFF), []);
});

test("an ending that cannot explain the point's own end is refused", () => {
  // pt(): the rally ends at 55.2 in cut seconds. An "ending" at 51.0 is
  // 4.2s before that, so it did not set this point's end — the detector
  // lost the ball. This is the 16.5s Chris rally with one bounce found.
  const lost = pt({ rally_end_cut_s: 51.0 });
  assert.equal(effectiveEnd(lost, PAD, RALLY), paddedEnd(lost, PAD));
  // 2.6s before is TAIL_AFTER_BOUNCE exactly: the ending explains the end.
  const good = pt({ rally_end_cut_s: 52.6 });
  assert.equal(effectiveEnd(good, PAD, RALLY), 53.1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveEnd,
  handCutGaps,
  handCutTape,
  markEnd,
  markStart,
  markedSpans,
  nextMarkStart,
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

test("a run of deleted cards fuses into one jump, not one per card", () => {
  // Three deleted warm-up cards, each separated by the sliver of padding
  // the cut keeps between adjacent clips. Padded spans: 0..6.5, 7..13.5,
  // 14..20.5 — 0.5s gaps. The real match that found this played 6.5s of
  // warm-up across nineteen separate jumps.
  const rows = [
    pt({ id: "w1", cut_t0: 0, t0: 100, t1: 104, deleted: true }),
    pt({ id: "w2", cut_t0: 7, t0: 110, t1: 114, deleted: true }),
    pt({ id: "w3", cut_t0: 14, t0: 120, t1: 124, deleted: true }),
    pt({ id: "first", cut_t0: 30, t0: 140, t1: 144 }),
  ];
  assert.deepEqual(skipSpans(rows, PAD, OFF), [{ start: 0, end: 20.5 }]);
});

test("a merge never spans a rally somebody kept", () => {
  // Same shape, but a KEPT rally sits in the gap between the two deleted
  // ones. Fusing would jump straight over it. Two spans, and the kept
  // rally plays.
  const rows = [
    pt({ id: "j1", cut_t0: 0, t0: 100, t1: 104, deleted: true }),
    pt({ id: "keep", cut_t0: 6.5, t0: 110, t1: 114 }),
    pt({ id: "j2", cut_t0: 20, t0: 130, t1: 134, deleted: true }),
    pt({ id: "last", cut_t0: 40, t0: 150, t1: 154 }),
  ];
  const spans = skipSpans(rows, PAD, OFF);
  assert.equal(spans.length, 2);
  // The kept rally's start is inside no span.
  for (const sp of spans) {
    assert.ok(
      !(6.5 > sp.start && 6.5 < sp.end),
      `span ${sp.start}-${sp.end} swallowed the kept rally`
    );
  }
});

test("a gap wider than the tolerance stays two jumps", () => {
  // 5s of un-carded footage between two deleted cards: not padding, so it
  // is not assumed dead.
  const rows = [
    pt({ id: "j1", cut_t0: 0, t0: 100, t1: 104, deleted: true }),
    pt({ id: "j2", cut_t0: 11.5, t0: 110, t1: 114, deleted: true }),
    pt({ id: "first", cut_t0: 30, t0: 140, t1: 144 }),
  ];
  assert.deepEqual(skipSpans(rows, PAD, OFF), [
    { start: 0, end: 6.5 },
    { start: 11.5, end: 18 },
  ]);
});


// A rally we watched stop can be cut harder than one we lost (2026-09-09).
const ev = (over: Record<string, unknown> = {}) => ({
  end_source: "observed",
  connected_crossings: 6,
  max_crossing_gap_s: 0.9,
  ...over,
});
const TIGHT = {
  tapEnd: false,
  rallyEnd: { on: true, bufferS: 1.75, tightBufferS: 0.4 },
};

test("a watched rally ends at the tight buffer", () => {
  const p = pt({ rally_end_cut_s: 54, highlight_evidence: ev() });
  assert.equal(effectiveEnd(p, PAD, TIGHT), 54.4);
});

test("a rally the tracker lost keeps the wide tail", () => {
  const p = pt({
    rally_end_cut_s: 54,
    highlight_evidence: ev({ max_crossing_gap_s: 2.4 }),
  });
  assert.equal(effectiveEnd(p, PAD, TIGHT), 55.75);
});

test("an end nobody observed keeps the wide tail", () => {
  const p = pt({
    rally_end_cut_s: 54,
    highlight_evidence: ev({ end_source: "card" }),
  });
  assert.equal(effectiveEnd(p, PAD, TIGHT), 55.75);
});

test("a point with no evidence at all keeps the wide tail", () => {
  const p = pt({ rally_end_cut_s: 54 });
  assert.equal(effectiveEnd(p, PAD, TIGHT), 55.75);
});

test("without a tight buffer configured nothing changes", () => {
  const p = pt({ rally_end_cut_s: 54, highlight_evidence: ev() });
  assert.equal(
    effectiveEnd(p, PAD, { tapEnd: false, rallyEnd: { on: true, bufferS: 1.75 } }),
    55.75,
  );
});

test("a scored point is unaffected by the tight buffer", () => {
  const p = pt({
    scored_at_cut_s: 53,
    rally_end_cut_s: 54,
    highlight_evidence: ev(),
  });
  assert.equal(effectiveEnd(p, PAD, { ...TIGHT, tapEnd: true }), 53.5);
});

/* ------------------------------------------------ hand-cut tape (2026-09-25) */

// A hand cut as the worker cuts it: each mark padded 1.2 s before and
// 1.3 s after, clips laid end to end on the cut clock.
function marked(id: string, t0: number, t1: number, cut: number, over: Partial<Point> = {}): Point {
  return pt({ id, t0, t1, cut_t0: cut, deleted: false, is_let: false, ...over });
}

test("a mark starts pre after its clip start, and ends the rally after that", () => {
  const p = marked("a", 30, 36.5, 10);
  assert.equal(markStart(p, PAD), 11.2);
  assert.equal(markEnd(p, PAD), 17.7);
  // Unclamped, the end is exactly rallyEnd.
  assert.equal(markEnd(p, PAD), rallyEnd(p, PAD));
});

test("a clip clamped at the top of the video: the mark sits t0 in", () => {
  // Marked 0.5 s into the recording: the clip could only start at 0.
  const p = marked("first", 0.5, 6, 0);
  assert.equal(markStart(p, PAD), 0.5);
  assert.equal(markEnd(p, PAD), 6);
  // rallyEnd would assume the full pre pad and run 0.7 s late here.
  assert.ok(Math.abs(rallyEnd(p, PAD)! - 6.7) < 1e-9);
});

test("the tape plays each mark and cuts straight to the next", () => {
  const a = marked("a", 30, 36, 0); // clip 0..9.8 on the cut clock
  const b = marked("b", 50, 58, 9.8); // clip 9.8..20.3
  const c = marked("c", 70, 75, 20.3);
  const tape = handCutTape([a, b, c], PAD);
  assert.deepEqual(
    tape.map((s) => [Number(s.start.toFixed(3)), Number(s.end.toFixed(3))]),
    [[1.2, 7.2], [11, 19], [21.5, 26.5]]
  );
  // tapeMove over it: inside a mark stays, the tail and the next lead jump
  // straight to the next mark, after the last mark the tape is over.
  assert.deepEqual(tapeMove(tape, 5), { kind: "stay" });
  assert.deepEqual(tapeMove(tape, 7.2), { kind: "jump", to: 11 });
  assert.deepEqual(tapeMove(tape, 0), { kind: "jump", to: 1.2 });
  assert.deepEqual(tapeMove(tape, 26.5), { kind: "end" });
});

test("lets and deleted cards play nothing on the tape", () => {
  const a = marked("a", 30, 36, 0);
  const skipped = marked("let", 50, 58, 9.8, { is_let: true });
  const gone = marked("gone", 70, 75, 20.3, { deleted: true });
  const d = marked("d", 90, 96, 28.8);
  const tape = handCutTape([a, skipped, gone, d], PAD);
  assert.deepEqual(
    tape.map((s) => [Number(s.start.toFixed(3)), Number(s.end.toFixed(3))]),
    [[1.2, 7.2], [30, 36]]
  );
  assert.deepEqual(tapeMove(tape, 7.3), { kind: "jump", to: 30 });
});

test("a point added after a hand cut plays exactly its marks (audit S5)", () => {
  const a = marked("a", 30, 36, 0);
  const inserted = marked("ins", 40, 44, 6.5);
  const b = marked("b", 50, 58, 13);
  // The card that plays its own clip is on the tape by its marks, like
  // every other point: 6.5 + 1.2 to that plus 4, never its padded card
  // (6.5 .. 13). The iPhone's HandCutPlayback.spans does the same.
  const tape = handCutTape([a, inserted, b], PAD);
  assert.deepEqual(
    tape.map((s) => [Number(s.start.toFixed(3)), Number(s.end.toFixed(3))]),
    [[1.2, 7.2], [7.7, 11.7], [14.2, 22.2]]
  );
  assert.deepEqual(tapeMove(tape, 7.2), { kind: "jump", to: 7.7 });
  assert.deepEqual(tapeMove(tape, 11.7), { kind: "jump", to: 14.2 });
  // Standing alone, the card is its mark, not its padded clip.
  assert.deepEqual(handCutTape([marked("ins", 40, 44, 30)], PAD), [{ start: 31.2, end: 35.2 }]);
  // The unmerged tape names each point.
  assert.deepEqual(
    markedSpans([a, inserted, b], PAD).map((s) => s.id),
    ["a", "ins", "b"]
  );
});

test("after a point, a hand-cut watch-through goes to the next point's Begin mark", () => {
  const a = marked("a", 30, 36, 0);
  const inserted = marked("ins", 40, 44, 6.5);
  const skipped = marked("let", 46, 48, 11, { is_let: true });
  const b = marked("b", 50, 58, 13);
  const points = [a, inserted, skipped, b];
  // The detour hands back here, not to the next card's padded start.
  assert.equal(nextMarkStart(points, PAD, "ins"), 14.2);
  assert.equal(nextMarkStart(points, PAD, "a"), 7.7);
  // The last kept point has nowhere to go; a let is not on the tape.
  assert.equal(nextMarkStart(points, PAD, "b"), null);
  assert.equal(nextMarkStart(points, PAD, "let"), null);
  // The detour stops at the card's End mark.
  assert.equal(markEnd(inserted, PAD), 6.5 + 1.2 + 4);
});

test("the gaps for a jump-only player end exactly on the next mark", () => {
  const a = marked("a", 30, 36, 0);
  const b = marked("b", 50, 58, 9.8);
  const skipped = marked("let", 60, 64, 20.3, { is_let: true });
  const gaps = handCutGaps([a, b, skipped], PAD);
  const r = (x: number) => Number(x.toFixed(3));
  assert.deepEqual(
    gaps.map((g) => [r(g.start), r(g.end)]),
    // lead, between a and b, then from b's end through the let to the
    // end of the last card (the file's end)
    [[0, 1.2], [7.2, 11], [19, 20.3 + 1.2 + 4 + 1.3]]
  );
  assert.deepEqual(handCutGaps([], PAD), []);
});

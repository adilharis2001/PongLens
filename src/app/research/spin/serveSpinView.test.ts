import assert from "node:assert/strict";
import { test } from "node:test";
import {
  disagrees,
  filterPoints,
  formatClock,
  isBlind,
  labeled,
  productPrefill,
  refusalText,
  serveWindow,
  summarize,
  type SpinNote,
  type SpinPointRow,
  type SpinPrediction,
} from "./serveSpinView.ts";

function point(id: string, over: Partial<SpinPointRow> = {}): SpinPointRow {
  return {
    pointId: id,
    matchId: "m1",
    idx: 1,
    cutT0: 10,
    serveSpin: null,
    serveSidespin: null,
    ...over,
  };
}

function pred(
  id: string,
  spin: SpinPrediction["predicted_spin"],
  over: Partial<SpinPrediction> = {},
): SpinPrediction {
  return {
    point_id: id,
    algo: "ratio-v1",
    predicted_spin: spin,
    confidence: 0.8,
    ratio1: 0.4,
    kick1_deg: 3,
    hop_t: 0.4,
    hop_speed: 3,
    pre_speed: 4,
    post_speed: 1.6,
    serve_cut_s: 12,
    quality: {},
    ...over,
  };
}

function note(id: string, over: Partial<SpinNote> = {}): SpinNote {
  return {
    point_id: id,
    spin: null,
    side: null,
    strength: null,
    note: null,
    predicted_spin: null,
    predicted_confidence: null,
    algo: null,
    blind: false,
    ...over,
  };
}

test("isBlind is deterministic and hits roughly a fifth", () => {
  const ids = Array.from(
    { length: 2000 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  const first = ids.map(isBlind);
  const second = ids.map(isBlind);
  assert.deepEqual(first, second);
  const share = first.filter(Boolean).length / ids.length;
  assert.ok(share > 0.12 && share < 0.28, `blind share ${share}`);
});

test("labeled and disagrees", () => {
  assert.equal(labeled(undefined), false);
  assert.equal(labeled(note("p", { spin: null })), false);
  assert.equal(labeled(note("p", { spin: "top" })), true);
  // cant_tell and unmeasurable never count as disagreement
  assert.equal(disagrees(note("p", { spin: "cant_tell" }), pred("p", "top")), false);
  assert.equal(disagrees(note("p", { spin: "back" }), pred("p", "unmeasurable")), false);
  assert.equal(disagrees(note("p", { spin: "back" }), pred("p", "top")), true);
  assert.equal(disagrees(note("p", { spin: "top" }), pred("p", "top")), false);
});

test("filterPoints modes", () => {
  const points = [point("a"), point("b"), point("c")];
  const notes = new Map([
    ["a", note("a", { spin: "back" })],
    ["c", note("c", { spin: "cant_tell" })],
  ]);
  const preds = new Map([
    ["a", pred("a", "top")],
    ["b", pred("b", "unmeasurable")],
  ]);
  assert.deepEqual(
    filterPoints(points, notes, preds, "unlabeled", "any").map((p) => p.pointId),
    ["b"],
  );
  assert.deepEqual(
    filterPoints(points, notes, preds, "predicted", "any").map((p) => p.pointId),
    ["a"],
  );
  assert.deepEqual(
    filterPoints(points, notes, preds, "disagree", "any").map((p) => p.pointId),
    ["a"],
  );
  assert.deepEqual(
    filterPoints(points, notes, preds, "cant_tell", "any").map((p) => p.pointId),
    ["c"],
  );
  assert.deepEqual(
    filterPoints(points, notes, preds, "all", "top").map((p) => p.pointId),
    ["a"],
  );
});

test("summarize splits open and blind agreement and fills the confusion", () => {
  const points = [point("a"), point("b"), point("c"), point("d")];
  const notes = new Map([
    ["a", note("a", { spin: "top", blind: false })],
    ["b", note("b", { spin: "back", blind: true })],
    ["c", note("c", { spin: "cant_tell" })],
  ]);
  const preds = new Map([
    ["a", pred("a", "top")],
    ["b", pred("b", "top")],
    ["c", pred("c", "back")],
    ["d", pred("d", "unmeasurable")],
  ]);
  const s = summarize(points, notes, preds);
  assert.equal(s.total, 4);
  assert.equal(s.labeledCount, 3);
  assert.equal(s.measured, 3);
  assert.equal(s.agreeOpen, 1);
  assert.equal(s.totalOpen, 1);
  assert.equal(s.agreeBlind, 0);
  assert.equal(s.totalBlind, 1);
  assert.equal(s.confusion.top.top, 1);
  assert.equal(s.confusion.back.top, 1);
  assert.equal(s.confusion.none.none, 0);
});

test("serveWindow anchors on the prediction and falls back to the head", () => {
  const p = point("a", { cutT0: 30 });
  const withPred = serveWindow(p, pred("a", "back", { serve_cut_s: 33 }));
  assert.ok(Math.abs(withPred.start - 32.1) < 1e-9);
  assert.ok(Math.abs(withPred.end - 35.6) < 1e-9);
  const noPred = serveWindow(p, undefined);
  assert.ok(Math.abs(noPred.start - 29.1) < 1e-9);
  const noBounce = serveWindow(p, pred("a", "unmeasurable", { serve_cut_s: null }));
  assert.ok(Math.abs(noBounce.start - 29.1) < 1e-9);
});

test("productPrefill renders the review-flow label without inventing direction", () => {
  assert.equal(productPrefill(point("a")), null);
  assert.equal(
    productPrefill(point("a", { serveSpin: "back", serveSidespin: true })),
    "backspin + sidespin",
  );
  assert.equal(
    productPrefill(point("a", { serveSpin: "top", serveSidespin: false })),
    "topspin + no sidespin",
  );
  // pure sidespin is stored as spin null + sidespin true (033 shape)
  assert.equal(
    productPrefill(point("a", { serveSpin: null, serveSidespin: true })),
    "sidespin",
  );
});

test("refusalText names the gate", () => {
  assert.equal(refusalText(undefined), null);
  assert.equal(refusalText(pred("a", "back")), null);
  assert.equal(
    refusalText(pred("a", "unmeasurable", { quality: { reason: "fake_serve_reversal" } })),
    "looks like pre-serve ball bouncing",
  );
});

test("formatClock", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65.7), "1:05");
});

import assert from "node:assert/strict";
import test from "node:test";
import { CLIP_PAD, TIGHT_PAD, effectivePad, reanchorCutT0 } from "./clipEdit.ts";

// cut_t0 is the padded clip start on the cut video's clock (playhead.ts).
// Adjust moves t0; the anchor must move by the change in the padded start,
// or every cut-clock rule places the serve wrong by the amount moved.
// adjust_point (migration 20260906174457) applies the same arithmetic.

const pad = CLIP_PAD.normal; // pre 1.0

test("moving the start earlier moves the anchor by the same amount", () => {
  const p = { cut_t0: 100, t0: 50, tight_start: false, tight_end: false };
  assert.equal(reanchorCutT0(p, 47, false, pad), 97);
  assert.equal(reanchorCutT0(p, 52.5, false, pad), 102.5);
});

test("moving only the end leaves the anchor alone", () => {
  const p = { cut_t0: 100, t0: 50, tight_start: false, tight_end: true };
  assert.equal(reanchorCutT0(p, 50, false, pad), 100);
});

test("dissolving a tight start restores the full pad in front", () => {
  // A split child keeps 0.3s before its serve; re-timing that edge by hand
  // gives it the full pad again, so the anchor moves back by the difference
  // as well as by the edge's own move.
  const p = { cut_t0: 100, t0: 50, tight_start: true, tight_end: false };
  const effOld = effectivePad(pad, true, false).pre; // 0.3
  assert.equal(effOld, TIGHT_PAD);
  // Same t0, tight dissolved: anchor moves earlier by (1.0 - 0.3).
  assert.equal(reanchorCutT0(p, 50, false, pad), 99.3);
  // Undo pins the tight flag back: the anchor returns exactly.
  const after = { cut_t0: 99.3, t0: 50, tight_start: false, tight_end: false };
  assert.equal(reanchorCutT0(after, 50, true, pad), 100);
});

test("an anchor clamped at the start of the video stays consistent", () => {
  // The first point's padded start was clamped to 0 at cut time; moving
  // its start does not pull the anchor negative.
  const p = { cut_t0: 0, t0: 0.4, tight_start: false, tight_end: false };
  assert.equal(reanchorCutT0(p, 0.2, false, pad), 0);
  assert.equal(reanchorCutT0(p, 3, false, pad), 2);
});

test("a legacy point with no anchor keeps none", () => {
  const p = { cut_t0: null, t0: 50, tight_start: false, tight_end: false };
  assert.equal(reanchorCutT0(p, 40, false, pad), null);
});

test("a round trip through undo is exact", () => {
  const p = { cut_t0: 312.47, t0: 200.13, tight_start: false, tight_end: true };
  const moved = reanchorCutT0(p, 197.9, false, pad);
  assert.equal(moved, 310.24);
  const back = reanchorCutT0(
    { cut_t0: moved, t0: 197.9, tight_start: false, tight_end: true },
    200.13,
    false,
    pad
  );
  assert.equal(back, 312.47);
});

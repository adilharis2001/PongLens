import assert from "node:assert/strict";
import { test } from "node:test";
import { netSegment, netSegmentFromQuad, netSegmentOriented } from "./netDeath.ts";

// Real calibrated corners from the Terry and Koko matches — end-on
// cameras, where perspective compression is largest and the old
// pixel-midpoint net sat ~0.4 m into the near half.
const TERRY: Record<string, [number, number]> = {
  A_near_1: [866.4, 740.9],
  B_near_2: [1259.2, 698.9],
  C_far_2: [1038.6, 608.7],
  D_far_1: [808.2, 623.7],
};
const KOKO: Record<string, [number, number]> = {
  A_near_1: [836.1, 822.9],
  B_near_2: [1307.6, 747.5],
  C_far_2: [975.1, 631.6],
  D_far_1: [697.5, 658.9],
};

// The worker's net_segment (research_serve_misses.py) on the same
// corners, via the inverse homography. The two implementations state one
// rule in two languages, so they are held to each other the way the
// placement port is held to serve-parity.json.
const WORKER_TERRY = [
  [828.583, 664.747],
  [1119.136, 641.63],
];
const WORKER_KOKO = [
  [744.764, 714.825],
  [1094.701, 673.289],
];

const asQuad = (c: Record<string, [number, number]>) => [
  c.A_near_1,
  c.B_near_2,
  c.C_far_2,
  c.D_far_1,
];

test("matches the worker's inverse-homography net on real corners", () => {
  for (const [corners, expected] of [
    [TERRY, WORKER_TERRY],
    [KOKO, WORKER_KOKO],
  ] as const) {
    const seg = netSegment(corners);
    assert.ok(seg);
    for (const [got, want] of [
      [seg.e1, expected[0]],
      [seg.e2, expected[1]],
    ] as const) {
      assert.ok(Math.abs(got[0] - want[0]) < 0.01, `${got} vs ${want}`);
      assert.ok(Math.abs(got[1] - want[1]) < 0.01, `${got} vs ${want}`);
    }
  }
});

test("the quad form answers exactly like the record form", () => {
  for (const corners of [TERRY, KOKO]) {
    const a = netSegment(corners);
    const b = netSegmentFromQuad(asQuad(corners));
    assert.ok(a && b);
    assert.deepEqual(b, a);
  }
});

test("each endpoint lies on its sideline", () => {
  // Colinearity with A-D (left) and B-C (right): the net ends where the
  // net line meets the sidelines, never inside or outside the table.
  const colinear = (
    p: [number, number],
    q: [number, number],
    r: [number, number],
  ) =>
    Math.abs(
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
    ) < 1;
  for (const c of [TERRY, KOKO]) {
    const seg = netSegment(c);
    assert.ok(seg);
    assert.ok(colinear(c.A_near_1, c.D_far_1, seg.e1));
    assert.ok(colinear(c.B_near_2, c.C_far_2, seg.e2));
  }
});

test("the net sits nearer the far end than the pixel midpoint", () => {
  // The direction of the old bug, kept as a tripwire. Image y decreases
  // toward the far end on these cameras.
  for (const c of [TERRY, KOKO]) {
    const seg = netSegment(c);
    assert.ok(seg);
    const midY =
      (c.A_near_1[1] + c.D_far_1[1] + c.B_near_2[1] + c.C_far_2[1]) / 4;
    const segY = (seg.e1[1] + seg.e2[1]) / 2;
    assert.ok(segY < midY, `net at y=${segY}, pixel midpoint at y=${midY}`);
  }
});

test("junk quads answer null, not a throw", () => {
  assert.equal(netSegmentFromQuad(null), null);
  assert.equal(netSegmentFromQuad(undefined), null);
  assert.equal(netSegmentFromQuad([]), null);
  assert.equal(netSegmentFromQuad([[1, 2], [3, 4]]), null);
  assert.equal(
    netSegmentFromQuad([[1, 2], [3, 4], [5], [7, 8]]),
    null,
  );
});

test("the oriented form matches, and end order does not matter", () => {
  for (const c of [TERRY, KOKO]) {
    const viaRecord = netSegment(c);
    const [A, B, C, D] = asQuad(c);
    const oriented = netSegmentOriented(A, B, C, D);
    assert.ok(viaRecord && oriented);
    assert.deepEqual(oriented, viaRecord);
    // swapping which end is "near" returns the same line, ends swapped
    const swapped = netSegmentOriented(C, D, A, B);
    assert.ok(swapped);
    for (const [got, want] of [
      [swapped.e1, oriented.e2],
      [swapped.e2, oriented.e1],
    ] as const) {
      assert.ok(Math.abs(got[0] - want[0]) < 1e-6);
      assert.ok(Math.abs(got[1] - want[1]) < 1e-6);
    }
  }
});

test("mistaking the sides for the ends draws a different line", () => {
  // The serve-detector corpus stores quads in inconsistent cyclic order,
  // so its page picks the pairing by matching the baked midpoints first.
  // This guards that the pairing genuinely matters.
  const [A, B, C, D] = asQuad(TERRY);
  const right = netSegmentOriented(A, B, C, D);
  const wrong = netSegmentOriented(B, C, D, A);
  assert.ok(right && wrong);
  assert.ok(
    Math.abs(right.e1[1] - wrong.e1[1]) > 5,
    "rotated pairing should give the lengthwise line, not the net",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  cornerErrors,
  frameToSource,
  isQuad,
  sameQuad,
  seedQuad,
  shippedProposal,
  sourceToFrame,
  summarise,
} from "./tableCalibrationView.ts";
import type { CalibrationRow, Corner, ProposalBlock } from "./types.ts";

const GEOMETRY = {
  frameWidth: 1600,
  frameHeight: 900,
  sourceWidth: 1920,
  sourceHeight: 1080,
};

test("source and frame coordinates round-trip", () => {
  const source: Corner = [1026, 729];
  const frame = sourceToFrame(source, GEOMETRY);
  assert.deepEqual(frame, [855, 607.5]);
  const back = frameToSource(frame, GEOMETRY);
  assert.ok(Math.abs(back[0] - source[0]) < 1e-9);
  assert.ok(Math.abs(back[1] - source[1]) < 1e-9);
});

test("a quad is four finite pairs and nothing else", () => {
  assert.equal(isQuad([[0, 0], [1, 0], [1, 1], [0, 1]]), true);
  assert.equal(isQuad([[0, 0], [1, 0], [1, 1]]), false);
  assert.equal(isQuad([[0, 0], [1, 0], [1, 1], [0, "1"]]), false);
  assert.equal(isQuad([[0, 0], [1, 0], [1, 1], [0, Number.NaN]]), false);
  assert.equal(isQuad(null), false);
});

test("corner error is normalised the way the worker normalises drift", () => {
  const a: Corner[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const b: Corner[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(cornerErrors(a, b, 100, 100), { median: 0, max: 0 });

  const shifted: Corner[] = [[3, 4], [10, 0], [10, 10], [0, 10]];
  const errors = cornerErrors(shifted, b, 100, 100);
  assert.equal(errors?.max, 5);
  assert.equal(errors?.median, 0);
});

test("mismatched lengths produce no error rather than a wrong one", () => {
  assert.equal(cornerErrors([[0, 0]], [[0, 0], [1, 1]], 10, 10), null);
});

test("the seed quad sits inside the frame", () => {
  const quad = seedQuad(1600, 900);
  assert.equal(quad.length, 4);
  for (const [x, y] of quad) {
    assert.ok(x > 0 && x < 1600, `x ${x} inside frame`);
    assert.ok(y > 0 && y < 900, `y ${y} inside frame`);
  }
});

test("sameQuad tolerates the float round-trip but not a real move", () => {
  const saved: Corner[] = [[100, 200], [300, 200], [290, 100], [110, 100]];
  assert.equal(sameQuad(saved, saved), true);
  // What a source -> frame -> source round-trip does to a coordinate.
  assert.equal(
    sameQuad(saved, [[100.02, 199.98], [300, 200], [290, 100], [110, 100]]),
    true,
  );
  // A corner the reviewer actually dragged.
  assert.equal(
    sameQuad(saved, [[104, 200], [300, 200], [290, 100], [110, 100]]),
    false,
  );
  assert.equal(sameQuad(null, null), true);
  assert.equal(sameQuad(saved, null), false);
  assert.equal(sameQuad(null, saved), false);
});

function block(accepted: boolean): ProposalBlock {
  return {
    trials: [],
    accepted,
    reason: accepted ? null : "unstable_proposals",
    max_drift_ratio: null,
    median_drift_ratio: null,
    corners_source: accepted ? [[0, 0], [1, 0], [1, 1], [0, 1]] : null,
  };
}

test("the shipped proposal follows the production ladder", () => {
  assert.equal(
    shippedProposal({ luna: block(true), sol: null, production: null })?.model,
    "luna",
  );
  // Sol only wins where Luna failed, which is the only case it is bought in.
  assert.equal(
    shippedProposal({ luna: block(false), sol: block(true), production: null })
      ?.model,
    "sol",
  );
  assert.equal(
    shippedProposal({ luna: block(false), sol: block(false), production: null }),
    null,
  );
  assert.equal(shippedProposal({ luna: null, sol: null, production: null }), null);
});

function row(over: Partial<CalibrationRow>): CalibrationRow {
  return {
    matchId: "m",
    frameKey: "k",
    ...GEOMETRY,
    duplicateOf: null,
    duplicateReason: null,
    proposals: { luna: null, sol: null, production: null },
    correctedCorners: null,
    verdict: null,
    notes: null,
    reviewedAt: null,
    opponent: null,
    venue: null,
    placementStatus: null,
    originalName: null,
    ...over,
  };
}

test("the summary counts what the header claims", () => {
  const summary = summarise([
    row({ proposals: { luna: block(true), sol: null, production: null } }),
    row({
      verdict: "correct",
      proposals: { luna: block(true), sol: null, production: null },
    }),
    row({
      duplicateOf: "other",
      proposals: { luna: block(false), sol: block(true), production: null },
    }),
    row({ proposals: { luna: block(false), sol: block(false), production: null } }),
  ]);
  assert.deepEqual(summary, {
    total: 4,
    reviewed: 1,
    lunaAgreed: 2,
    solRun: 2,
    solAgreed: 1,
    duplicates: 1,
    noProposal: 1,
  });
});

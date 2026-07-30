import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlacementHeatCells,
  placementHeatTone,
} from "./placementHeatMap.ts";
import type { PlacementZoneCounts } from "./placementAggregate.ts";

function counts(
  values: Partial<PlacementZoneCounts> = {},
): PlacementZoneCounts {
  return {
    short_left: 0,
    short_middle: 0,
    short_right: 0,
    medium_left: 0,
    medium_middle: 0,
    medium_right: 0,
    deep_left: 0,
    deep_middle: 0,
    deep_right: 0,
    ...values,
  };
}

function assertBounds(
  actual: {
    u0: number;
    u1: number;
    v0: number;
    v1: number;
  } | undefined,
  expected: {
    u0: number;
    u1: number;
    v0: number;
    v1: number;
  },
) {
  assert.ok(actual);
  for (const key of ["u0", "u1", "v0", "v1"] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9);
  }
}

test("outgoing cells place deep at the opponent end and preserve user-left", () => {
  const cells = buildPlacementHeatCells(
    counts({ deep_left: 4, short_right: 2 }),
    "myServes",
  );
  const deepLeft = cells.find((cell) => cell.zone === "deep_left");
  const shortRight = cells.find(
    (cell) => cell.zone === "short_right",
  );

  assertBounds(deepLeft?.bounds, {
    u0: 0,
    u1: 1.525 / 3,
    v0: 2.74 - 1.37 / 3,
    v1: 2.74,
  });
  assertBounds(shortRight?.bounds, {
    u0: (1.525 * 2) / 3,
    u1: 1.525,
    v0: 1.37,
    v1: 1.37 + 1.37 / 3,
  });
  assert.equal(deepLeft?.opacity, 0.8);
  assert.equal(shortRight?.opacity, 0.46);
});

test("incoming cells place deep at the user end without mirroring lateral zones", () => {
  const cells = buildPlacementHeatCells(
    counts({ deep_left: 3, short_right: 1 }),
    "theirRally",
  );
  const deepLeft = cells.find((cell) => cell.zone === "deep_left");
  const shortRight = cells.find(
    (cell) => cell.zone === "short_right",
  );

  assertBounds(deepLeft?.bounds, {
    u0: 0,
    u1: 1.525 / 3,
    v0: 0,
    v1: 1.37 / 3,
  });
  assertBounds(shortRight?.bounds, {
    u0: (1.525 * 2) / 3,
    u1: 1.525,
    v0: 1.37 - 1.37 / 3,
    v1: 1.37,
  });
});

test("empty heat maps stay subtle and hitter identity selects the existing tone", () => {
  const cells = buildPlacementHeatCells(counts(), "myRally");

  assert.equal(cells.length, 9);
  assert.equal(cells.every((cell) => cell.opacity === 0.06), true);
  assert.equal(placementHeatTone("myRally"), "#22d3ee");
  assert.equal(placementHeatTone("theirServes"), "#f59e0b");
});

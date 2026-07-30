import assert from "node:assert/strict";
import test from "node:test";
import type { TrustedPlacementObservation } from "./placementAggregate.ts";
import {
  buildPlacementAggregateView,
  placementAggregateFilterCopy,
  placementPageFromScroll,
  placementPageOffset,
} from "./placementAggregateView.ts";

function observation(
  pointId: string,
  filter: TrustedPlacementObservation["filter"],
): TrustedPlacementObservation {
  return {
    pointId,
    shotSeq: 1,
    filter,
    zone: "deep_left",
    u: 0.2,
    v: filter.startsWith("my") ? 2.5 : 0.2,
    confidence: 0.8,
  };
}

test("pager derives the visible page and target offset from the real viewport", () => {
  assert.equal(placementPageFromScroll(0, 320), "landings");
  assert.equal(placementPageFromScroll(150, 320), "landings");
  assert.equal(placementPageFromScroll(170, 320), "heatmap");
  assert.equal(placementPageFromScroll(640, 320), "heatmap");
  assert.equal(placementPageFromScroll(10, 0), "landings");
  assert.equal(placementPageOffset("landings", 320), 0);
  assert.equal(placementPageOffset("heatmap", 320), 320);
});

test("each filter explains exactly which post-contact landing is counted", () => {
  assert.equal(
    placementAggregateFilterCopy("myServes"),
    "Second bounce on their side.",
  );
  assert.equal(
    placementAggregateFilterCopy("theirServes"),
    "Second bounce on your side.",
  );
  assert.equal(
    placementAggregateFilterCopy("myRally"),
    "Your non-serve shots that bounced on their side.",
  );
  assert.equal(
    placementAggregateFilterCopy("theirRally"),
    "Their non-serve shots that bounced on your side.",
  );
});

test("one filtered view drives landing count, point count, and sparse state", () => {
  const observations = [
    observation("point-one", "myServes"),
    observation("point-one", "myServes"),
    observation("point-two", "myServes"),
    observation("point-three", "theirServes"),
  ];

  assert.deepEqual(
    buildPlacementAggregateView(observations, "myServes"),
    {
      observations: observations.slice(0, 3),
      landingCount: 3,
      pointCount: 2,
      sparse: false,
    },
  );
  assert.deepEqual(
    buildPlacementAggregateView(observations, "theirServes"),
    {
      observations: observations.slice(3),
      landingCount: 1,
      pointCount: 1,
      sparse: true,
    },
  );
});

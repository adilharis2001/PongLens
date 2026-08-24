import assert from "node:assert/strict";
import test from "node:test";
import type { TrustedPlacementObservation } from "./placementAggregate.ts";
import {
  buildPlacementAggregateView,
  placementAggregateCaption,
  placementAggregateFilterCopy,
  placementAxesFromFilter,
  placementCoverageLine,
  placementFilterFromAxes,
  placementPageFromScroll,
  placementPageOffset,
  placementSectionTitle,
  placementServeFilter,
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
    serverWon: null,
  };
}

test("pager derives the visible page and target offset from the card stride", () => {
  assert.equal(placementPageFromScroll(0, 320), "landings");
  assert.equal(placementPageFromScroll(150, 320), "landings");
  assert.equal(placementPageFromScroll(170, 320), "heatmap");
  assert.equal(placementPageFromScroll(640, 320), "heatmap");
  assert.equal(placementPageFromScroll(10, 0), "landings");
  assert.equal(placementPageOffset("landings", 320), 0);
  assert.equal(placementPageOffset("heatmap", 320), 320);
});

test("the two filter axes round-trip to every stored filter key", () => {
  assert.equal(placementFilterFromAxes("me", "serves"), "myServes");
  assert.equal(placementFilterFromAxes("me", "rally"), "myRally");
  assert.equal(placementFilterFromAxes("them", "serves"), "theirServes");
  assert.equal(placementFilterFromAxes("them", "rally"), "theirRally");

  // Every filter decomposes, and decomposing then recomposing is identity —
  // so no axis pair can ever address a filter the map cannot render.
  for (const filter of [
    "myServes",
    "myRally",
    "theirServes",
    "theirRally",
  ] as const) {
    const { who, shot } = placementAxesFromFilter(filter);
    assert.equal(placementFilterFromAxes(who, shot), filter);
  }
});

test("the card caption merges what a dot means with how much is behind it", () => {
  assert.equal(
    placementAggregateCaption("myServes", 34, 21),
    "Where your serves landed · 34 landings from 21 points",
  );
  assert.equal(
    placementAggregateCaption("theirRally", 1, 1),
    "Their non-serve shots that bounced on your side · 1 landing from 1 point",
  );
  // Nothing to count: the descriptor alone. The card's empty note carries
  // the "no data" message, so the caption must not repeat it as "0 landings".
  assert.equal(
    placementAggregateCaption("theirServes", 0, 0),
    "Where their serves landed",
  );
});

test("each filter explains exactly which post-contact landing is counted", () => {
  assert.equal(
    placementAggregateFilterCopy("myServes"),
    "Where your serves landed.",
  );
  assert.equal(
    placementAggregateFilterCopy("theirServes"),
    "Where their serves landed.",
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

test("serve mode keeps the who axis and drops the shot axis", () => {
  assert.equal(placementServeFilter("me"), "myServes");
  assert.equal(placementServeFilter("them"), "theirServes");
});

test("the two web surfaces get their title and count from one place", () => {
  // The share link is the version a stranger sees. A heading there saying
  // "Placement maps" over serves alone is the failure worth pinning.
  assert.equal(placementSectionTitle(true), "Serve placement");
  assert.equal(placementSectionTitle(false), "Placement maps");

  assert.equal(
    placementCoverageLine(true, 79, 98),
    "Serves mapped for 79 of 98 points.",
  );
  assert.equal(
    placementCoverageLine(false, 12, 98),
    "Mapped for 12 of 98 points.",
  );
  assert.equal(
    placementCoverageLine(true, 1, 1),
    "Serves mapped for 1 of 1 point.",
  );
});

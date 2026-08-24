import {
  PLACEMENT_ZONES,
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  type PlacementAggregateFilter,
  type PlacementDepth,
  type PlacementLateral,
  type PlacementZone,
  type PlacementZoneCounts,
} from "./placementAggregate.ts";

const NET_V_M = TABLE_LENGTH_M / 2;
const DEPTH_STEP_M = NET_V_M / 3;
const LATERAL_STEP_M = TABLE_WIDTH_M / 3;

const DEPTH_INDEX: Record<PlacementDepth, number> = {
  short: 0,
  medium: 1,
  deep: 2,
};
const LATERAL_INDEX: Record<PlacementLateral, number> = {
  left: 0,
  middle: 1,
  right: 2,
};

export interface PlacementHeatCell {
  zone: PlacementZone;
  /** Every landing in the zone. Drives the shading. */
  count: number;
  /** Landings whose point has a winner, and how many the server took. */
  scored: number;
  won: number;
  opacity: number;
  bounds: {
    u0: number;
    u1: number;
    v0: number;
    v1: number;
  };
}

function isIncoming(filter: PlacementAggregateFilter) {
  return filter === "theirServes" || filter === "theirRally";
}

export function placementHeatTone(
  filter: PlacementAggregateFilter,
) {
  return filter === "myServes" || filter === "myRally"
    ? "#22d3ee"
    : "#f59e0b";
}

export function buildPlacementHeatCells(
  counts: PlacementZoneCounts,
  filter: PlacementAggregateFilter,
): PlacementHeatCell[] {
  const maxCount = Math.max(
    ...Object.values(counts).map((tally) => tally.total),
  );
  return PLACEMENT_ZONES.map((zone) => {
    const [depth, lateral] = zone.split("_") as [
      PlacementDepth,
      PlacementLateral,
    ];
    const depthIndex = DEPTH_INDEX[depth];
    const lateralIndex = LATERAL_INDEX[lateral];
    const tally = counts[zone];
    const count = tally.total;
    const u0 = lateralIndex * LATERAL_STEP_M;
    const u1 =
      lateralIndex === 2
        ? TABLE_WIDTH_M
        : (lateralIndex + 1) * LATERAL_STEP_M;

    let v0: number;
    let v1: number;
    if (isIncoming(filter)) {
      v0 =
        depthIndex === 2
          ? 0
          : NET_V_M - (depthIndex + 1) * DEPTH_STEP_M;
      v1 =
        depthIndex === 0
          ? NET_V_M
          : NET_V_M - depthIndex * DEPTH_STEP_M;
    } else {
      v0 =
        depthIndex === 2
          ? TABLE_LENGTH_M - DEPTH_STEP_M
          : NET_V_M + depthIndex * DEPTH_STEP_M;
      v1 =
        depthIndex === 2
          ? TABLE_LENGTH_M
          : NET_V_M + (depthIndex + 1) * DEPTH_STEP_M;
    }

    return {
      zone,
      count,
      scored: tally.scored,
      won: tally.won,
      opacity:
        maxCount === 0
          ? 0.06
          : 0.12 + 0.68 * (count / maxCount),
      bounds: { u0, u1, v0, v1 },
    };
  });
}

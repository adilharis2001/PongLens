import type {
  PlacementAggregateFilter,
  TrustedPlacementObservation,
} from "./placementAggregate.ts";

export type PlacementAggregatePage = "landings" | "heatmap";

export function placementPageFromScroll(
  scrollLeft: number,
  viewportWidth: number,
): PlacementAggregatePage {
  if (viewportWidth <= 0) return "landings";
  return scrollLeft / viewportWidth >= 0.5
    ? "heatmap"
    : "landings";
}

export function placementPageOffset(
  page: PlacementAggregatePage,
  viewportWidth: number,
): number {
  return page === "heatmap" ? Math.max(0, viewportWidth) : 0;
}

export function placementAggregateFilterCopy(
  filter: PlacementAggregateFilter,
): string {
  switch (filter) {
    case "myServes":
      return "Second bounce on their side.";
    case "theirServes":
      return "Second bounce on your side.";
    case "myRally":
      return "Your non-serve shots that bounced on their side.";
    case "theirRally":
      return "Their non-serve shots that bounced on your side.";
  }
}

export function buildPlacementAggregateView(
  observations: readonly TrustedPlacementObservation[],
  filter: PlacementAggregateFilter,
) {
  const filtered = observations.filter(
    (observation) => observation.filter === filter,
  );
  return {
    observations: filtered,
    landingCount: filtered.length,
    pointCount: new Set(
      filtered.map((observation) => observation.pointId),
    ).size,
    sparse: filtered.length < 3,
  };
}

import type {
  PlacementAggregateFilter,
  TrustedPlacementObservation,
} from "./placementAggregate.ts";

export type PlacementAggregatePage = "landings" | "heatmap";

/**
 * Landings and the heat map are a two-card deck: a snap carousel on
 * mobile, both cards side by side on desktop. `strideWidth` is the
 * distance between card origins (card width + the deck's gap), NOT the
 * viewport — the cards are narrower than the scroller so the next one
 * peeks, which is the only affordance saying there is a second view.
 */
export function placementPageFromScroll(
  scrollLeft: number,
  strideWidth: number,
): PlacementAggregatePage {
  if (strideWidth <= 0) return "landings";
  return scrollLeft / strideWidth >= 0.5
    ? "heatmap"
    : "landings";
}

export function placementPageOffset(
  page: PlacementAggregatePage,
  strideWidth: number,
): number {
  return page === "heatmap" ? Math.max(0, strideWidth) : 0;
}

/**
 * The shot filter as the two axes it actually is: whose shots, and which
 * of their shots. Four flat labels ("My rally shots") overflowed a phone
 * and clipped mid-word; two 2-way controls fit one row at any width and
 * name the real structure. The stored filter key is unchanged — this is
 * a UI decomposition, not a data one.
 */
export type PlacementAggregateWho = "me" | "them";
export type PlacementAggregateShot = "serves" | "rally";

const FILTER_BY_AXES: Record<
  PlacementAggregateWho,
  Record<PlacementAggregateShot, PlacementAggregateFilter>
> = {
  me: { serves: "myServes", rally: "myRally" },
  them: { serves: "theirServes", rally: "theirRally" },
};

export function placementFilterFromAxes(
  who: PlacementAggregateWho,
  shot: PlacementAggregateShot,
): PlacementAggregateFilter {
  return FILTER_BY_AXES[who][shot];
}

export function placementAxesFromFilter(
  filter: PlacementAggregateFilter,
): { who: PlacementAggregateWho; shot: PlacementAggregateShot } {
  switch (filter) {
    case "myServes":
      return { who: "me", shot: "serves" };
    case "myRally":
      return { who: "me", shot: "rally" };
    case "theirServes":
      return { who: "them", shot: "serves" };
    case "theirRally":
      return { who: "them", shot: "rally" };
  }
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

/**
 * The single line under a placement card: what a dot means for the current
 * filter, then how much data is behind it. Replaces the old three-line
 * stack (a caption floating above the map plus two count lines below it) —
 * one sentence, anchored to the map it describes.
 *
 * With nothing to count the descriptor stands alone: the card's own empty
 * note already says there is no data here, so the caption must not also
 * announce "0 landings from 0 points".
 */
export function placementAggregateCaption(
  filter: PlacementAggregateFilter,
  landingCount: number,
  pointCount: number,
): string {
  const what = placementAggregateFilterCopy(filter).replace(/\.$/, "");
  if (landingCount <= 0) return what;
  const landings = `${landingCount} ${
    landingCount === 1 ? "landing" : "landings"
  }`;
  const points = `${pointCount} ${pointCount === 1 ? "point" : "points"}`;
  return `${what} · ${landings} from ${points}`;
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

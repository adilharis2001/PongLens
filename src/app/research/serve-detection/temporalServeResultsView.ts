import type {
  TemporalServeOutcome,
  TemporalServeResult,
  TemporalServeResultAssignment,
  TemporalServeResultFilter,
  TemporalServeResultSummary,
} from "./types";

export const TEMPORAL_SERVE_RESULT_SUMMARY: TemporalServeResultSummary = {
  recommendation: "research_only",
  qualification: "preliminary",
  total_points: 786,
  total_matches: 22,
  holdout_points: 403,
  raw_accuracy: 0.488834,
  fused_precision: 0.52381,
  fused_coverage: 0.052109,
  seconds_per_point: 6.076761,
  estimated_cost_per_100_points_usd: 0.0675,
};

export function filterTemporalServeResults(
  assignments: TemporalServeResultAssignment[],
  filter: TemporalServeResultFilter,
): TemporalServeResultAssignment[] {
  return assignments.filter(
    (assignment) =>
      (filter.match === "all" ||
        assignment.source.match_label === filter.match) &&
      (filter.outcome === "all" ||
        assignment.source.proposal.temporal_result.outcome === filter.outcome),
  );
}

export function temporalResultBadge(outcome: TemporalServeOutcome): {
  label: string;
  tone: "success" | "danger" | "warning";
} {
  switch (outcome) {
    case "correct":
      return { label: "Correct", tone: "success" };
    case "wrong":
      return { label: "Wrong", tone: "danger" };
    case "withheld":
      return { label: "Withheld", tone: "warning" };
  }
}

export function temporalResultJumpTargets(
  result: Pick<TemporalServeResult, "temporal" | "placement">,
): Array<{
  key: "onset" | "first_bounce" | "second_bounce";
  label: string;
  time_s: number;
}> {
  const values = [
    ["onset", "Model onset", result.temporal.onset_s],
    ["first_bounce", "Placement first bounce", result.placement.first_bounce_s],
    ["second_bounce", "Placement second bounce", result.placement.second_bounce_s],
  ] as const;
  return values.flatMap(([key, label, value]) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? [{ key, label, time_s: value }]
      : [],
  );
}

import type {
  TemporalServeOutcome,
  TemporalServeContactReview,
  TemporalServeIssueTag,
  TemporalServeOnsetReviewV1,
  TemporalServeResult,
  TemporalServeResultAssignment,
  TemporalServeResultFilter,
  TemporalServeResultSummary,
} from "./types";

const TEMPORAL_SERVE_ISSUE_TAGS = new Set<TemporalServeIssueTag>([
  "contact_occluded",
  "ball_hard_to_see",
  "wrong_player_motion",
  "non_serve_motion",
  "clip_missing_contact",
  "other",
]);

export function emptyTemporalServeContactReview(): TemporalServeContactReview {
  return {
    schema_version: 2,
    task: "serve_contact",
    contact_status: null,
    actual_contact_s: null,
    issue_tags: [],
    note: "",
    submitted_at: null,
    legacy_onset_review: null,
  };
}

function isLegacyOnsetReview(
  value: unknown,
): value is TemporalServeOnsetReviewV1 {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<TemporalServeOnsetReviewV1>;
  return (
    raw.schema_version === 1 &&
    (["correct", "incorrect", "not_visible"] as const).includes(
      raw.verdict as "correct" | "incorrect" | "not_visible",
    )
  );
}

export function hydrateTemporalServeContactReview(
  value: unknown,
): TemporalServeContactReview {
  const fallback = emptyTemporalServeContactReview();
  if (!value || typeof value !== "object") return fallback;
  if (isLegacyOnsetReview(value)) {
    return { ...fallback, legacy_onset_review: value };
  }
  const raw = value as Partial<TemporalServeContactReview>;
  if (raw.schema_version !== 2 || raw.task !== "serve_contact") return fallback;
  const contactStatus = (["exact", "not_visible"] as const).includes(
    raw.contact_status as "exact" | "not_visible",
  )
    ? raw.contact_status ?? null
    : null;
  const actualContact =
    typeof raw.actual_contact_s === "number" &&
    Number.isFinite(raw.actual_contact_s)
      ? raw.actual_contact_s
      : null;
  return {
    schema_version: 2,
    task: "serve_contact",
    contact_status: contactStatus,
    actual_contact_s: actualContact,
    issue_tags: Array.isArray(raw.issue_tags)
      ? raw.issue_tags.filter(
          (tag): tag is TemporalServeIssueTag =>
            typeof tag === "string" &&
            TEMPORAL_SERVE_ISSUE_TAGS.has(tag as TemporalServeIssueTag),
        )
      : [],
    note: typeof raw.note === "string" ? raw.note : "",
    submitted_at:
      typeof raw.submitted_at === "string" ? raw.submitted_at : null,
    legacy_onset_review: isLegacyOnsetReview(raw.legacy_onset_review)
      ? raw.legacy_onset_review
      : null,
  };
}

export function validateTemporalServeContactReview(
  review: TemporalServeContactReview,
  durationS: number,
): string[] {
  if (!review.contact_status) {
    return ["Mark the first serve paddle contact or choose not visible."];
  }
  if (review.contact_status !== "exact") return [];
  if (review.actual_contact_s === null) {
    return ["Mark the exact paddle contact before saving this miss."];
  }
  if (
    !Number.isFinite(review.actual_contact_s) ||
    review.actual_contact_s < 0 ||
    review.actual_contact_s > durationS
  ) {
    return ["The paddle contact must fall inside this clip."];
  }
  return [];
}

export function isTemporalServeContactReviewed(
  assignment: TemporalServeResultAssignment,
): boolean {
  return hydrateTemporalServeContactReview(assignment.human_label).submitted_at !== null;
}

export function nextTemporalServeReviewIndex(
  assignments: TemporalServeResultAssignment[],
  currentIndex: number,
): number {
  if (!assignments.length) return -1;
  for (let offset = 1; offset < assignments.length; offset += 1) {
    const index = (currentIndex + offset) % assignments.length;
    if (!isTemporalServeContactReviewed(assignments[index])) return index;
  }
  return (currentIndex + 1) % assignments.length;
}

export function temporalServeContactReviewProgress(
  assignments: TemporalServeResultAssignment[],
) {
  let exact = 0;
  let notVisible = 0;
  let legacyOnset = 0;
  const issueCounts: Partial<Record<TemporalServeIssueTag, number>> = {};
  for (const assignment of assignments) {
    const review = hydrateTemporalServeContactReview(assignment.human_label);
    if (review.legacy_onset_review) legacyOnset += 1;
    if (!review.submitted_at || !review.contact_status) continue;
    if (review.contact_status === "exact") exact += 1;
    if (review.contact_status === "not_visible") notVisible += 1;
    for (const tag of review.issue_tags) {
      issueCounts[tag] = (issueCounts[tag] ?? 0) + 1;
    }
  }
  const reviewed = exact + notVisible;
  return {
    total: assignments.length,
    reviewed,
    exact,
    not_visible: notVisible,
    remaining: assignments.length - reviewed,
    legacy_onset: legacyOnset,
    issue_counts: issueCounts,
  };
}

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
        assignment.source.proposal.temporal_result.outcome === filter.outcome) &&
      (filter.review === "all" ||
        (filter.review === "unreviewed"
          ? !isTemporalServeContactReviewed(assignment)
          : hydrateTemporalServeContactReview(assignment.human_label).contact_status ===
            filter.review)),
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
    ["onset", "Model motion-onset hint", result.temporal.onset_s],
    ["first_bounce", "Placement first bounce", result.placement.first_bounce_s],
    ["second_bounce", "Placement second bounce", result.placement.second_bounce_s],
  ] as const;
  return values.flatMap(([key, label, value]) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? [{ key, label, time_s: value }]
      : [],
  );
}

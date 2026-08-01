import assert from "node:assert/strict";
import test from "node:test";
import {
  TEMPORAL_SERVE_RESULT_SUMMARY,
  emptyTemporalServeContactReview,
  filterTemporalServeResults,
  hydrateTemporalServeContactReview,
  nextTemporalServeReviewIndex,
  temporalServeContactReviewProgress,
  temporalResultBadge,
  temporalResultJumpTargets,
  validateTemporalServeContactReview,
} from "./temporalServeResultsView.ts";
import type { TemporalServeResultAssignment } from "./types.ts";

const assignments = [
  {
    id: "result-1",
    sequence: 1,
    status: "submitted",
    human_label: {
      schema_version: 1,
      verdict: "correct",
      actual_contact_s: null,
      issue_tags: [],
      note: "",
      submitted_at: "2026-08-01T10:00:00.000Z",
    },
    source: {
      match_label: "Chris",
      proposal: {
        temporal_result: {
          outcome: "correct",
          expected_side: "near",
          predicted_side: "near",
          temporal: { onset_s: 1.2 },
          placement: { first_bounce_s: 1.5, second_bounce_s: 1.9 },
        },
      },
    },
  },
  {
    id: "result-2",
    sequence: 2,
    status: "submitted",
    human_label: {
      schema_version: 1,
      verdict: "incorrect",
      actual_contact_s: 1.6,
      issue_tags: ["contact_occluded"],
      note: "Body blocked the paddle until contact.",
      submitted_at: "2026-08-01T10:01:00.000Z",
    },
    source: {
      match_label: "Vaibhav",
      proposal: {
        temporal_result: {
          outcome: "wrong",
          expected_side: "far",
          predicted_side: "near",
          temporal: { onset_s: 4.2 },
          placement: { first_bounce_s: Number.NaN, second_bounce_s: 2.25 },
        },
      },
    },
  },
  {
    id: "result-3",
    sequence: 3,
    status: "not_started",
    human_label: null,
    source: {
      match_label: "Vaibhav",
      proposal: {
        temporal_result: {
          outcome: "withheld",
          expected_side: "far",
          predicted_side: null,
          temporal: { onset_s: null },
          placement: { first_bounce_s: null, second_bounce_s: null },
        },
      },
    },
  },
] as unknown as TemporalServeResultAssignment[];

test("filters temporal results by outcome and match without reordering", () => {
  assert.deepEqual(
    filterTemporalServeResults(assignments, {
      outcome: "all",
      match: "Vaibhav",
      review: "all",
    }).map((item) => item.id),
    ["result-2", "result-3"],
  );
  assert.deepEqual(
    filterTemporalServeResults(assignments, {
      outcome: "wrong",
      match: "all",
      review: "all",
    }).map((item) => item.id),
    ["result-2"],
  );
});

test("filters the review queue by human feedback state", () => {
  assert.deepEqual(
    filterTemporalServeResults(assignments, {
      outcome: "all",
      match: "all",
      review: "unreviewed",
    }).map((item) => item.id),
    ["result-3"],
  );
  assert.deepEqual(
    filterTemporalServeResults(assignments, {
      outcome: "all",
      match: "all",
      review: "incorrect",
    }).map((item) => item.id),
    ["result-2"],
  );
});

test("hydrates defensively and validates exact-contact feedback", () => {
  assert.deepEqual(emptyTemporalServeContactReview(), {
    schema_version: 1,
    verdict: null,
    actual_contact_s: null,
    issue_tags: [],
    note: "",
    submitted_at: null,
  });
  assert.deepEqual(
    hydrateTemporalServeContactReview(assignments[1].human_label),
    assignments[1].human_label,
  );
  assert.deepEqual(hydrateTemporalServeContactReview({ verdict: "mystery" }), {
    schema_version: 1,
    verdict: null,
    actual_contact_s: null,
    issue_tags: [],
    note: "",
    submitted_at: null,
  });

  assert.deepEqual(
    validateTemporalServeContactReview(
      { ...emptyTemporalServeContactReview(), verdict: "incorrect" },
      5,
    ),
    ["Mark the exact paddle contact before saving this miss."],
  );
  assert.deepEqual(
    validateTemporalServeContactReview(
      {
        ...emptyTemporalServeContactReview(),
        verdict: "incorrect",
        actual_contact_s: 5.1,
      },
      5,
    ),
    ["The paddle contact must fall inside this clip."],
  );
  assert.deepEqual(
    validateTemporalServeContactReview(
      {
        ...emptyTemporalServeContactReview(),
        verdict: "incorrect",
        actual_contact_s: 2.25,
      },
      5,
    ),
    [],
  );
});

test("summarizes timing error and advances to the next unreviewed clip", () => {
  assert.deepEqual(temporalServeContactReviewProgress(assignments), {
    total: 3,
    reviewed: 2,
    correct: 1,
    incorrect: 1,
    not_visible: 0,
    exact_contacts: 1,
    median_absolute_error_s: 2.6,
    issue_counts: { contact_occluded: 1 },
  });
  assert.equal(nextTemporalServeReviewIndex(assignments, 0), 2);
  assert.equal(nextTemporalServeReviewIndex(assignments, 2), 0);
});

test("result badge comes from the frozen sample stratum", () => {
  assert.deepEqual(temporalResultBadge("correct"), {
    label: "Correct",
    tone: "success",
  });
  assert.deepEqual(temporalResultBadge("wrong"), {
    label: "Wrong",
    tone: "danger",
  });
  assert.deepEqual(temporalResultBadge("withheld"), {
    label: "Withheld",
    tone: "warning",
  });
});

test("jump targets use exact non-negative times without padding", () => {
  const first = assignments[0].source.proposal.temporal_result;
  assert.deepEqual(temporalResultJumpTargets(first), [
    { key: "onset", label: "Model onset", time_s: 1.2 },
    { key: "first_bounce", label: "Placement first bounce", time_s: 1.5 },
    { key: "second_bounce", label: "Placement second bounce", time_s: 1.9 },
  ]);

  const invalid = {
    ...assignments[1].source.proposal.temporal_result,
    temporal: {
      ...assignments[1].source.proposal.temporal_result.temporal,
      onset_s: -1,
    },
  };
  assert.deepEqual(temporalResultJumpTargets(invalid), [
    { key: "second_bounce", label: "Placement second bounce", time_s: 2.25 },
  ]);
});

test("summary is frozen from the complete held-out experiment", () => {
  assert.deepEqual(TEMPORAL_SERVE_RESULT_SUMMARY, {
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
  });
});

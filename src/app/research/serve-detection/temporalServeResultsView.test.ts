import assert from "node:assert/strict";
import test from "node:test";
import {
  TEMPORAL_SERVE_RESULT_SUMMARY,
  filterTemporalServeResults,
  temporalResultBadge,
  temporalResultJumpTargets,
} from "./temporalServeResultsView.ts";
import type { TemporalServeResultAssignment } from "./types.ts";

const assignments = [
  {
    id: "result-1",
    sequence: 1,
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
    source: {
      match_label: "Vaibhav",
      proposal: {
        temporal_result: {
          outcome: "wrong",
          expected_side: "far",
          predicted_side: "near",
          temporal: { onset_s: -1 },
          placement: { first_bounce_s: Number.NaN, second_bounce_s: 2.25 },
        },
      },
    },
  },
  {
    id: "result-3",
    sequence: 3,
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
    }).map((item) => item.id),
    ["result-2", "result-3"],
  );
  assert.deepEqual(
    filterTemporalServeResults(assignments, {
      outcome: "wrong",
      match: "all",
    }).map((item) => item.id),
    ["result-2"],
  );
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

  const invalid = assignments[1].source.proposal.temporal_result;
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

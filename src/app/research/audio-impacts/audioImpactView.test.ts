import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateLoop,
  canReviewAudioImpact,
  filterAudioImpactAssignments,
  firstReviewTarget,
  nextReviewTargetInPoint,
  pointReviewState,
  previousReviewTarget,
  queueWithActive,
  shouldReloadAudioImpactMedia,
} from "./audioImpactView.ts";
import type { AudioImpactResearchAssignment } from "./types.ts";

function assignment(
  id: string,
  sequence: number,
  kinds: Array<string | null>,
  options: {
    venue?: "pingpod" | "westchester" | "lyttc";
    round?: "A" | "B" | "C";
    status?: "not_started" | "in_progress" | "submitted";
  } = {},
): AudioImpactResearchAssignment {
  const venue = options.venue ?? "pingpod";
  const round = options.round ?? "A";
  return {
    id,
    batch_id: "batch",
    source_id: `source-${id}`,
    sequence,
    status: options.status ?? "in_progress",
    human_label: {
      schema_version: 1,
      sequence_complete: options.status === "submitted",
      events: kinds.map((kind, index) => ({
        id: `${id}-${index + 1}`,
        candidate_id: `${id}-${index + 1}`,
        time_s: index + 0.5,
        unsnapped_time_s: null,
        origin: "proposal",
        kind: kind as never,
      })),
    },
    review_metrics: null,
    started_at: null,
    submitted_at: null,
    source: {
      id: `source-${id}`,
      source_point_idx: sequence,
      match_label: `Match ${venue}`,
      venue_label: venue,
      duration_s: 8,
      proposal: {
        schema_version: 1,
        automatic_prediction_withheld: true,
        audio: {
          detector_version: "test",
          sample_rate: 48_000,
          duration_s: 8,
          waveform_bin_ms: 10,
          waveform: [0, 0.5, 1],
          candidates: kinds.map((_kind, index) => ({
            id: `${id}-${index + 1}`,
            time_s: index + 0.5,
            detector_origins: ["high_frequency"],
            strength: 1,
            detector_scores: { high_frequency: 1 },
          })),
          low_threshold_candidates: [],
        },
        video: { duration_s: 8, width: 1920, height: 1080 },
      },
      prefill: {
        venue_category: venue,
        round,
        split: round === "C" ? "sealed_evaluation" : "development",
        source_recording_id: `recording-${id}`,
        source_media_sha256: "a".repeat(64),
        point_id: `point-${id}`,
        cohort_manifest_sha256: "b".repeat(64),
        detector_manifest_sha256: "c".repeat(64),
      },
    },
  };
}

test("candidate loop uses one second of context and clamps to the clip", () => {
  assert.deepEqual(candidateLoop(0.2, 8), { start_s: 0, end_s: 1.2 });
  assert.deepEqual(candidateLoop(4, 8), { start_s: 3, end_s: 5 });
  assert.deepEqual(candidateLoop(7.7, 8), { start_s: 6.7, end_s: 8 });
});

test("first target chooses the first unresolved sound before submitted points", () => {
  const assignments = [
    assignment("done", 1, ["paddle"], { status: "submitted" }),
    assignment("open", 2, ["table", null]),
  ];

  assert.deepEqual(firstReviewTarget(assignments), {
    assignment_id: "open",
    event_id: "open-2",
  });
});

test("next unresolved sound advances within the point before the next point", () => {
  const assignments = [
    assignment("one", 1, [null, null]),
    assignment("two", 2, [null]),
  ];

  assert.deepEqual(nextReviewTargetInPoint(assignments, "one", "one-1"), {
    assignment_id: "one",
    event_id: "one-2",
  });
});

test("labeling the final sound never crosses into the next point", () => {
  const assignments = [
    assignment("one", 1, ["paddle", "table"]),
    assignment("two", 2, [null]),
  ];

  assert.equal(nextReviewTargetInPoint(assignments, "one", "one-2"), null);
  assert.equal(
    nextReviewTargetInPoint(
      [assignment("done", 1, ["paddle"])],
      "done",
      "done-1",
    ),
    null,
  );
});

test("point review state counts answered sounds without trusting submission status", () => {
  assert.deepEqual(
    pointReviewState(
      assignment("one", 1, ["paddle", null, "shoe_squeak"]).human_label!,
    ),
    { answered: 2, total: 3, complete: false },
  );
  assert.deepEqual(
    pointReviewState(
      assignment("done", 1, ["paddle", "stomp"]).human_label!,
    ),
    { answered: 2, total: 2, complete: true },
  );
});

test("previous target follows chronological review order even when answered", () => {
  const assignments = [
    assignment("one", 1, ["paddle", "table"]),
    assignment("two", 2, [null]),
  ];

  assert.deepEqual(previousReviewTarget(assignments, "two", "two-1"), {
    assignment_id: "one",
    event_id: "one-2",
  });
  assert.equal(previousReviewTarget(assignments, "one", "one-1"), null);
});

test("venue, round, and completion filters compose", () => {
  const assignments = [
    assignment("ping-a", 1, [null]),
    assignment("west-b", 2, [null], { venue: "westchester", round: "B" }),
    assignment("west-c", 3, ["table"], {
      venue: "westchester",
      round: "C",
      status: "submitted",
    }),
  ];

  assert.deepEqual(
    filterAudioImpactAssignments(assignments, {
      venue: "westchester",
      round: "B",
      completion: "open",
    }).map((item) => item.id),
    ["west-b"],
  );
  assert.deepEqual(
    filterAudioImpactAssignments(assignments, {
      venue: "all",
      round: "C",
      completion: "complete",
    }).map((item) => item.id),
    ["west-c"],
  );
});

test("the active assignment remains navigable when a filter hides it", () => {
  const active = assignment("active", 1, [null]);
  const visible = [assignment("visible", 2, [null], { venue: "lyttc" })];

  assert.deepEqual(
    queueWithActive(visible, active).map((item) => item.id),
    ["active", "visible"],
  );
  assert.deepEqual(
    queueWithActive([active, ...visible], active).map((item) => item.id),
    ["active", "visible"],
  );
});

test("labels and navigation stay locked until media is playable and saves are durable", () => {
  assert.equal(canReviewAudioImpact("ready", "idle"), true);
  assert.equal(canReviewAudioImpact("loading", "idle"), false);
  assert.equal(canReviewAudioImpact("error", "idle"), false);
  assert.equal(canReviewAudioImpact("ready", "saving"), false);
  assert.equal(canReviewAudioImpact("ready", "error"), false);
});

test("moving between sounds in one point reuses the playable protected video", () => {
  assert.equal(shouldReloadAudioImpactMedia("point-one", "point-one"), false);
  assert.equal(shouldReloadAudioImpactMedia("point-one", "point-two"), true);
  assert.equal(shouldReloadAudioImpactMedia(null, "point-one"), true);
});

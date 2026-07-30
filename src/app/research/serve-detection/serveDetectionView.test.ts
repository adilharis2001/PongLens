import assert from "node:assert/strict";
import test from "node:test";
import {
  actionLabel,
  filterServeAssignments,
  nextUnsubmittedIndex,
  serveProgress,
} from "./serveDetectionView.ts";

const fixture = [
  {
    id: "a1",
    sequence: 1,
    status: "submitted",
    source: {
      match_label: "Vaibhav",
      proposal: {
        detector: { status: "high_confidence" },
      },
    },
  },
  {
    id: "a2",
    sequence: 61,
    status: "in_progress",
    source: {
      match_label: "Faye",
      proposal: {
        detector: { status: "needs_review" },
      },
    },
  },
  {
    id: "a3",
    sequence: 62,
    status: "not_started",
    source: {
      match_label: "Faye",
      proposal: {
        detector: { status: "needs_review" },
      },
    },
  },
] as never[];

test("filters by match and detector status without changing source order", () => {
  assert.deepEqual(
    filterServeAssignments(fixture, {
      match: "Faye",
      status: "needs_review",
    }).map((item) => item.sequence),
    [61, 62],
  );
});

test("all filters preserve every assignment", () => {
  assert.deepEqual(
    filterServeAssignments(fixture, { match: "all", status: "all" }).map(
      (item) => item.sequence,
    ),
    [1, 61, 62],
  );
});

test("progress counts only submitted assignments", () => {
  assert.deepEqual(serveProgress(fixture), { completed: 1, total: 3 });
});

test("next unsubmitted wraps around the queue", () => {
  assert.equal(nextUnsubmittedIndex(fixture, 2), 1);
});

test("likely-action labels are human readable", () => {
  assert.equal(actionLabel("serve_contact"), "Likely serve contact");
  assert.equal(actionLabel("serve_second_bounce"), "Likely second bounce");
  assert.equal(actionLabel("unexpected"), "Likely action");
});

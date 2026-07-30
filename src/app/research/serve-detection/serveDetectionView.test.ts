import assert from "node:assert/strict";
import test from "node:test";
import {
  actionLabel,
  filterServeAssignments,
  followupReasonLabel,
  followupServeAssignments,
  nextIncompleteFollowupIndex,
  nextUnsubmittedIndex,
  serveFollowupProgress,
  serveModeAssignments,
  serveModeProgress,
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

const followupFixture = [
  {
    id: "excluded",
    sequence: 1,
    human_label: null,
    source: {
      match_label: "Chris",
      prefill: {
        followup_v2: {
          included: false,
          order: null,
          reasons: [],
        },
      },
    },
  },
  {
    id: "later",
    sequence: 2,
    human_label: {
      followup: {
        submitted_at: "2026-07-30T12:00:00.000Z",
      },
    },
    source: {
      match_label: "Gui",
      prefill: {
        followup_v2: {
          included: true,
          order: 2,
          reasons: ["correct_control"],
        },
      },
    },
  },
  {
    id: "first",
    sequence: 3,
    human_label: {
      followup: {
        submitted_at: null,
      },
    },
    source: {
      match_label: "Patrick",
      prefill: {
        followup_v2: {
          included: true,
          order: 1,
          reasons: ["occluded", "high_confidence_wrong_server"],
        },
      },
    },
  },
] as never[];

test("follow-up queue includes selected sources in stable follow-up order", () => {
  assert.deepEqual(
    followupServeAssignments(followupFixture).map((item) => item.id),
    ["first", "later"],
  );
});

test("follow-up progress is independent from original assignment status", () => {
  assert.deepEqual(serveFollowupProgress(followupFixture), {
    completed: 1,
    total: 2,
  });
});

test("next incomplete follow-up wraps and ignores completed labels", () => {
  const queue = followupServeAssignments(followupFixture);
  assert.equal(nextIncompleteFollowupIndex(queue, 1), 0);
});

test("follow-up selection reasons are reviewer friendly", () => {
  assert.equal(followupReasonLabel("occluded"), "Serve contact is occluded");
  assert.equal(
    followupReasonLabel("high_confidence_wrong_server"),
    "High-confidence server disagreement",
  );
  assert.equal(
    followupReasonLabel("correct_control"),
    "Visible comparison example",
  );
});

test("mode queue switches between the selected follow-up and original batch", () => {
  assert.deepEqual(
    serveModeAssignments(followupFixture, "followup", {
      match: "all",
      status: "all",
    }).map((item) => item.id),
    ["first", "later"],
  );
  assert.deepEqual(
    serveModeAssignments(followupFixture, "original", {
      match: "all",
      status: "all",
    }).map((item) => item.id),
    ["excluded", "later", "first"],
  );
});

test("mode progress reports the active workflow only", () => {
  assert.deepEqual(serveModeProgress(followupFixture, "followup"), {
    completed: 1,
    total: 2,
  });
  assert.deepEqual(serveModeProgress(fixture, "original"), {
    completed: 1,
    total: 3,
  });
});

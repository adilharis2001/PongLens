import assert from "node:assert/strict";
import test from "node:test";
import {
  actionLabel,
  applyServeReviewPlaybackDefaults,
  filterServeAssignments,
  followupReasonLabel,
  followupServeAssignments,
  initialServePlaybackTime,
  initialServeWorkspace,
  nextIncompleteFollowupIndex,
  nextIncompleteOnsetIndex,
  onsetServeAssignments,
  serveOnsetProgress,
  nextUnsubmittedIndex,
  serveMediaSessionKey,
  serveFollowupProgress,
  serveModeAssignments,
  serveModeProgress,
  serveProgress,
  serviceMotionJumpTargets,
  showsLegacyServeEvidence,
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

test("autosave replacement keeps the same media session", () => {
  const beforeSave = {
    id: "assignment-1",
    human_label: null,
  };
  const afterSave = {
    id: "assignment-1",
    human_label: {
      actual_serve_contact_s: 1.25,
      followup: {
        first_bounce: { status: "exact", time_s: 1.6 },
      },
    },
  };

  assert.equal(
    serveMediaSessionKey(beforeSave as never),
    serveMediaSessionKey(afterSave as never),
  );
  assert.notEqual(
    serveMediaSessionKey(afterSave as never),
    serveMediaSessionKey({ id: "assignment-2" } as never),
  );
});

test("follow-up playback starts at exact serve contact and clamps to clip", () => {
  assert.equal(
    initialServePlaybackTime(
      "followup",
      { actual_serve_contact_s: 1.25 },
      5,
    ),
    1.25,
  );
  assert.equal(
    initialServePlaybackTime(
      "followup",
      { actual_serve_contact_s: 8 },
      5,
    ),
    5,
  );
});

test("original review and occluded follow-up playback start at zero", () => {
  assert.equal(
    initialServePlaybackTime(
      "original",
      { actual_serve_contact_s: 1.25 },
      5,
    ),
    0,
  );
  assert.equal(
    initialServePlaybackTime(
      "followup",
      {
        actual_serve_contact_s: null,
        no_observable_serve: "not_visible",
      },
      5,
    ),
    0,
  );
  assert.equal(
    initialServePlaybackTime(
      "followup",
      { actual_serve_contact_s: Number.NaN },
      5,
    ),
    0,
  );
});

test("new serve-review media starts at quarter speed", () => {
  const media = {
    defaultPlaybackRate: 1,
    playbackRate: 1,
  };

  applyServeReviewPlaybackDefaults(media);

  assert.deepEqual(media, {
    defaultPlaybackRate: 0.25,
    playbackRate: 0.25,
  });
});

const onsetFixture = [
  {
    id: "later-onset",
    sequence: 1,
    human_label: { onset: { submitted_at: "done" } },
    source: {
      match_label: "Faye",
      prefill: {
        onset_v3: { included: true, order: 2, stratum: "occluded" },
      },
      proposal: {
        service_motion: { onset_t: 1.25 },
        detector: { status: "needs_review" },
      },
    },
  },
  {
    id: "first-onset",
    sequence: 2,
    human_label: { onset: { submitted_at: null } },
    source: {
      match_label: "Gui",
      prefill: {
        onset_v3: { included: true, order: 1, stratum: "visible" },
      },
      proposal: {
        service_motion: { onset_t: 0.75 },
        detector: { status: "needs_review" },
      },
    },
  },
] as never[];

test("onset queue, progress, and next item use onset completion only", () => {
  const queue = onsetServeAssignments(onsetFixture);
  assert.deepEqual(queue.map((item) => item.id), [
    "first-onset",
    "later-onset",
  ]);
  assert.deepEqual(serveOnsetProgress(onsetFixture), {
    completed: 1,
    total: 2,
  });
  assert.equal(nextIncompleteOnsetIndex(queue, 1), 0);
});

test("onset playback begins at the proposed service-motion onset", () => {
  assert.equal(
    initialServePlaybackTime(
      "onset",
      null,
      5,
      { service_motion: { onset_t: 1.25 } } as never,
    ),
    1.25,
  );
});

test("onset review hides legacy truth and exposes only frozen timing jumps", () => {
  assert.equal(showsLegacyServeEvidence("onset"), false);
  assert.equal(showsLegacyServeEvidence("followup"), true);
  assert.deepEqual(
    serviceMotionJumpTargets({
      service_motion: {
        onset_t: 0.4,
        contact_t: 0.9,
        first_bounce_t: 1.0,
        second_bounce_t: null,
      },
    }),
    [
      { key: "onset", label: "Model onset", time_s: 0.4 },
      { key: "contact", label: "Model contact", time_s: 0.9 },
      {
        key: "first_bounce",
        label: "Confirmed first bounce",
        time_s: 1,
      },
    ],
  );
});

test("latest results open first only when a separate result queue exists", () => {
  assert.equal(initialServeWorkspace(24), "results");
  assert.equal(initialServeWorkspace(0), "labeling");
});

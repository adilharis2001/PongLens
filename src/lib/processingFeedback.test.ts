import assert from "node:assert/strict";
import test from "node:test";

import {
  cameraViewWarning,
  feedbackForJob,
  onDevice,
  processingStageLabel,
  type ProcessingFeedback,
} from "./processingFeedback.ts";


const CAMERA_WARNING =
  "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table.";
const SHORT_CAMERA_WARNING =
  "The camera view changes during this recording. Keep the camera in a fixed position with the same table in view.";

function feedback(
  over: Partial<ProcessingFeedback> = {},
): ProcessingFeedback {
  return {
    match_id: "11111111-1111-4111-8111-111111111111",
    job_id: "22222222-2222-4222-8222-222222222222",
    job_status: "processing",
    job_kind: "deadspace_cut",
    stage: "ball",
    worker_state: "fresh",
    checked_at: null,
    window_start_s: null,
    window_end_s: null,
    camera_check: null,
    ...over,
  };
}


test("a requested match waiting for its worker says it is waiting", () => {
  assert.equal(
    processingStageLabel(feedback({ job_status: "queued", stage: null })),
    "Waiting to process",
  );
});

test("an offline service delays queued work even before a worker is assigned", () => {
  assert.equal(processingStageLabel(feedback({ job_status: "queued", worker_state: "missing", service_state: "unavailable" })), "Processing is delayed");
  assert.equal(processingStageLabel(feedback({ job_status: "queued", worker_state: "missing", service_state: "maintenance" })), "Paused for maintenance");
  assert.equal(processingStageLabel(feedback({ job_status: "done", service_state: "unavailable" })), null);
});


test("the live worker stage uses calm player language", () => {
  const cases: [string, string][] = [
    ["content_check", "Processing your match"],
    ["download", "Preparing video"],
    ["ball", "Finding the ball"],
    ["points", "Finding the points"],
    ["cut", "Removing dead time"],
    ["publish", "Preparing your match"],
  ];
  for (const [stage, want] of cases) {
    assert.equal(processingStageLabel(feedback({ stage })), want, stage);
  }
});


test("a hand cut names its own stages, never the automatic ones", () => {
  const cases: [string, string][] = [
    ["marks", "Reading the marks"],
    ["download", "Preparing video"],
    ["cut", "Cutting the video"],
    ["upload", "Uploading the result"],
    ["points", "Building the points"],
    ["publish", "Saving the match"],
    ["future_stage", "Preparing clips"],
  ];
  for (const [stage, want] of cases) {
    assert.equal(processingStageLabel(feedback({ job_kind: "hand_cut", stage })), want, stage);
  }
  assert.equal(
    processingStageLabel(feedback({ job_kind: "hand_cut", job_status: "queued", stage: null })),
    "Waiting to prepare clips",
  );
  assert.equal(
    processingStageLabel(feedback({ job_kind: "hand_cut", worker_state: "silent" })),
    "Processing is delayed",
  );
  assert.equal(processingStageLabel(feedback({ job_kind: "hand_cut", worker_state: "missing" })), null);
});

test("a silent worker delays an active processing request without inventing a time", () => {
  assert.equal(
    processingStageLabel(feedback({ worker_state: "silent" })),
    "Processing is delayed",
  );
});

test("a standalone upload check does not pretend match processing was requested", () => {
  for (const job_status of ["queued", "processing"]) {
    assert.equal(processingStageLabel(feedback({ job_kind: "content_check", job_status })), null);
  }
});


test("missing worker evidence stays unknown", () => {
  assert.equal(
    processingStageLabel(feedback({ worker_state: "missing" })),
    null,
  );
});


test("terminal jobs have no processing stage", () => {
  assert.equal(processingStageLabel(feedback({ job_status: "done" })), null);
  assert.equal(processingStageLabel(feedback({ job_status: "failed" })), null);
});


test("missing feedback has no processing claim", () => {
  assert.equal(processingStageLabel(null), null);
  assert.equal(cameraViewWarning(null), null);
});


test("a camera change wholly inside the selected video gets the canonical warning", () => {
  const got = cameraViewWarning(
    feedback({
      camera_check: {
        status: "changed",
        changes: [{ before_s: 12, after_s: 14 }],
      },
    }),
    10,
    20,
  );

  assert.equal(got, CAMERA_WARNING);
  assert.doesNotMatch(got ?? "", /12|14|seconds?|minutes?/i);
});


test("a changed camera in a checked recording of ten seconds or less avoids trim guidance", () => {
  const got = cameraViewWarning(
    feedback({
      window_start_s: 0,
      window_end_s: 7,
      camera_check: {
        status: "changed",
        changes: [{ before_s: 2, after_s: 3 }],
      },
    }),
  );

  assert.equal(got, SHORT_CAMERA_WARNING);
  assert.doesNotMatch(got ?? "", /trim/i);
});


test("a change touching both trim boundaries is inside the selected video", () => {
  assert.equal(
    cameraViewWarning(
      feedback({
        camera_check: {
          status: "changed",
          changes: [{ before_s: 10, after_s: 20 }],
        },
      }),
      10,
      20,
    ),
    CAMERA_WARNING,
  );
});


test("a camera change partly outside the selected video is ignored", () => {
  const camera_check = {
    status: "changed" as const,
    changes: [{ before_s: 9, after_s: 12 }, { before_s: 18, after_s: 21 }],
  };

  assert.equal(cameraViewWarning(feedback({ camera_check }), 10, 20), null);
});


test("stable camera status does not warn even when a change-shaped detail exists", () => {
  assert.equal(
    cameraViewWarning(feedback({
      camera_check: {
        status: "stable",
        changes: [{ before_s: 12, after_s: 14 }],
      },
    })),
    null,
  );
});


test("malformed camera changes cannot create a warning", () => {
  const invalid = [
    { before_s: Number.NaN, after_s: 10 },
    { before_s: 10, after_s: Number.POSITIVE_INFINITY },
    { before_s: -1, after_s: 2 },
    { before_s: 8, after_s: 7 },
    { before_s: "8", after_s: 9 },
    null,
  ];

  assert.equal(
    cameraViewWarning(feedback({
      camera_check: { status: "changed", changes: invalid },
    })),
    null,
  );
});


test("one valid camera change is enough when other changes are malformed", () => {
  assert.equal(
    cameraViewWarning(
      feedback({
        camera_check: {
          status: "changed",
          changes: [
            { before_s: Number.NaN, after_s: 10 },
            { before_s: 30, after_s: 31 },
          ],
        },
      }),
      20,
      40,
    ),
    CAMERA_WARNING,
  );
});


test("an invalid selected window cannot create a warning", () => {
  const changed = feedback({
    camera_check: {
      status: "changed",
      changes: [{ before_s: 12, after_s: 14 }],
    },
  });

  assert.equal(cameraViewWarning(changed, -1, 20), null);
  assert.equal(cameraViewWarning(changed, 20, 10), null);
  assert.equal(cameraViewWarning(changed, Number.NaN, 20), null);
});


/** Every word a player can read about a hand cut, from queue to publish,
 *  wherever it runs. The owner's rule (2026-09-25): nothing says where. */
const WHERE = /iphone|phone|\bmac\b|device|paused|on your/i;

test("a hand cut on the owner's phone reads exactly as it would on the server", () => {
  const phone = (over: Partial<ProcessingFeedback>) => feedback({
    job_kind: "hand_cut", job_status: "processing", cutter: "device", phase: "device",
    stage: null, worker_state: "missing", ...over,
  });
  const cases: [string | null, string][] = [
    ["device_cut", "Cutting the video"],
    ["device_clips", "Cutting the video"],
    ["device_paused", "Cutting the video"],
    ["device_upload", "Uploading the result"],
    [null, "Cutting the video"],
    ["device_something_new", "Cutting the video"],
  ];
  for (const [device_stage, want] of cases) {
    const got = processingStageLabel(phone({ device_stage }));
    assert.equal(got, want, String(device_stage));
    assert.doesNotMatch(got ?? "", WHERE, String(device_stage));
  }
  // The server's own stages for the same two steps say the same.
  assert.equal(processingStageLabel(feedback({ job_kind: "hand_cut", stage: "cut" })), "Cutting the video");
  assert.equal(processingStageLabel(feedback({ job_kind: "hand_cut", stage: "upload" })), "Uploading the result");
  // The hand lane being down or silent is nothing to do with the phone.
  assert.equal(processingStageLabel(phone({ service_state: "unavailable" })), "Cutting the video");
  assert.equal(processingStageLabel(phone({ worker_state: "silent" })), "Cutting the video");
  assert.ok(onDevice(phone({})));
  assert.ok(!onDevice(feedback({ job_kind: "hand_cut", phase: "verify" })));
});

test("the server checking a phone's cut is the save, and its queue is the hand cut's queue", () => {
  const verify = (over: Partial<ProcessingFeedback>) => feedback({
    job_kind: "hand_cut", cutter: "device", phase: "verify", ...over,
  });
  assert.equal(processingStageLabel(verify({ job_status: "queued", stage: null })), "Waiting to prepare clips");
  assert.equal(processingStageLabel(verify({ stage: "device_verify" })), "Saving the match");
  assert.equal(processingStageLabel(verify({ stage: "points" })), "Building the points");
  assert.equal(processingStageLabel(verify({ stage: "publish" })), "Saving the match");
  // Handed to the server, by the phone or because it went quiet: an
  // ordinary hand cut again, and nothing about the move is said.
  for (const cutter of ["mac", "device"] as const) {
    assert.equal(
      processingStageLabel(feedback({ job_kind: "hand_cut", cutter, phase: "mac", job_status: "queued", stage: null })),
      "Waiting to prepare clips",
    );
  }
});

test("no hand-cut label a player can read says where the cut runs", () => {
  const stages = [null, "marks", "download", "cut", "upload", "points", "publish", "device_verify",
    "device_cut", "device_clips", "device_upload", "device_paused"];
  const labels = new Set<string>();
  for (const phase of [null, "device", "verify", "mac"] as const) {
    for (const job_status of ["queued", "processing"]) {
      for (const stage of stages) {
        const label = processingStageLabel(feedback({
          job_kind: "hand_cut", job_status, phase, stage, device_stage: stage,
        }));
        if (label) labels.add(label);
      }
    }
  }
  for (const label of labels) assert.doesNotMatch(label, WHERE, label);
  assert.deepEqual([...labels].sort(), [
    "Building the points",
    "Cutting the video",
    "Preparing clips",
    "Preparing video",
    "Reading the marks",
    "Saving the match",
    "Uploading the result",
    "Waiting to prepare clips",
  ]);
});


test("a cut asked for a moment ago reads as its own status, not the finished one", () => {
  // The poll still names the cut that made this match, done. More options
  // must word a queued Replace the way the unprocessed page words a queued
  // cut, from the same labels.
  const stale = feedback({ job_id: "old", job_status: "done", job_kind: "deadspace_cut", stage: null });
  const hand = { id: "new", status: "queued", kind: "hand_cut" };
  assert.equal(processingStageLabel(stale), null);
  assert.equal(processingStageLabel(feedbackForJob(stale, hand)), "Waiting to prepare clips");
  assert.equal(processingStageLabel(feedbackForJob(null, hand)), "Waiting to prepare clips");
  assert.equal(
    processingStageLabel(feedbackForJob(stale, { id: "new", status: "queued", kind: "match_reprocess" })),
    "Waiting to process",
  );
  // Started, with no word from the worker yet: no stage to name, the same
  // as the unprocessed page before its first pulse ("Processing").
  assert.equal(processingStageLabel(feedbackForJob(stale, { ...hand, status: "processing" })), null);
  // The poll has caught up: its own reading (stage, lane, delays) stands.
  const caught = feedback({ job_id: "new", job_status: "processing", job_kind: "hand_cut", stage: "cut" });
  assert.equal(feedbackForJob(caught, { ...hand, status: "queued" }), caught);
  assert.equal(processingStageLabel(feedbackForJob(caught, hand)), "Cutting the video");
  // Nothing running: the feedback as it is.
  assert.equal(feedbackForJob(stale, null), stale);
});

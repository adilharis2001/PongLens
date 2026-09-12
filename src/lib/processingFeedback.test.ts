import assert from "node:assert/strict";
import test from "node:test";

import {
  cameraViewWarning,
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


test("the live worker stage uses calm player language", () => {
  const cases: [string, string][] = [
    ["content_check", "Checking video"],
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


test("a silent worker delays an active processing request without inventing a time", () => {
  assert.equal(
    processingStageLabel(feedback({ worker_state: "silent" })),
    "Processing is delayed",
  );
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

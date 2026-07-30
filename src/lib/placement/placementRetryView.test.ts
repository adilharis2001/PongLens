import assert from "node:assert/strict";
import test from "node:test";
import { placementLifecycleView, placementRetryView } from "./placementRetry.ts";

const future = "2026-07-30T12:00:00Z";
const now = new Date("2026-07-29T12:00:00Z");

test("retry available exposes one friendly primary action", () => {
  assert.deepEqual(
    placementRetryView("retry_available", 0, future, now),
    {
      tone: "warning",
      title: "Placement maps need another try",
      body:
        "Your match is ready, but we couldn't map the table reliably enough "
        + "to generate placement maps. The stronger retry is available once.",
      action: "Try placement again",
      poll: false,
    },
  );
});

test("retrying polls and final failure never offers another action", () => {
  assert.equal(
    placementRetryView("retrying", 1, future, now)?.poll,
    true,
  );
  assert.equal(
    placementRetryView("final_failed", 1, future, now)?.action,
    null,
  );
  assert.equal(placementRetryView("ready", 1, future, now), null);
});

test("expired retry shows final source-retention copy", () => {
  const view = placementRetryView(
    "retry_available",
    0,
    "2026-07-28T12:00:00Z",
    now,
  );
  assert.equal(view?.tone, "muted");
  assert.match(view?.title ?? "", /no longer available/i);
  assert.equal(view?.action, null);
});

test("live not-requested placement offers normal generation", () => {
  assert.deepEqual(
    placementLifecycleView("not_requested", 0, future, now),
    {
      tone: "muted",
      toolStatus: "Generate",
      sheetTitle: "Generate placement maps?",
      sheetBody:
        "We'll analyze the original recording and generate placement maps "
        + "without changing your points, clips, score, or notes.",
      noticeTitle: "Placement maps haven't been generated",
      noticeBody:
        "You can request placement maps from Tools while the original "
        + "recording is available.",
      actionKind: "generate",
      actionLabel: "Generate placement maps",
      poll: false,
      showAggregate: false,
    },
  );
});

test("expired not-requested placement has no action", () => {
  const view = placementLifecycleView(
    "not_requested",
    0,
    "2026-07-28T12:00:00Z",
    now,
  );
  assert.equal(view.toolStatus, "Unavailable");
  assert.equal(view.actionKind, null);
  assert.match(view.noticeBody ?? "", /original recording is no longer available/i);
});

test("normal processing and stronger retry have distinct copy", () => {
  assert.equal(
    placementLifecycleView("processing", 0, future, now).toolStatus,
    "Generating…",
  );
  assert.match(
    placementLifecycleView("processing", 0, future, now).sheetBody,
    /normal placement analysis/i,
  );
  assert.equal(
    placementLifecycleView("retrying", 1, future, now).toolStatus,
    "Retrying…",
  );
  assert.match(
    placementLifecycleView("retrying", 1, future, now).sheetBody,
    /stronger table-calibration/i,
  );
});

test("ready placement renders the aggregate", () => {
  const view = placementLifecycleView("ready", 0, null, now);
  assert.equal(view.toolStatus, "Ready");
  assert.equal(view.showAggregate, true);
  assert.equal(view.noticeBody, null);
});

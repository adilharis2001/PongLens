import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlacementRequestCurrent,
  isPlacementTerminal,
  placementActionEndpoint,
  placementLifecycleView,
  placementNoticeForViewer,
  placementRequestErrorCopy,
  placementRetryView,
} from "./placementRetry.ts";

const future = "2026-07-30T12:00:00Z";
const now = new Date("2026-07-29T12:00:00Z");

const lifecycleCases = [
  ["not_requested", 0, future, "Generate", "generate", false],
  ["processing", 0, future, "Generating…", null, true],
  ["retry_available", 0, future, "Try again", "retry", false],
  ["retrying", 1, future, "Retrying…", null, true],
  ["ready", 0, null, "Ready", null, false],
  ["final_failed", 1, null, "Unavailable", null, false],
] as const;

for (const [status, count, expiry, tool, action, poll] of lifecycleCases) {
  test(`${status} produces the approved placement tools state`, () => {
    const view = placementLifecycleView(status, count, expiry, now);
    assert.equal(view.toolStatus, tool);
    assert.equal(view.actionKind, action);
    assert.equal(view.poll, poll);
  });
}

test("placement actions select their matching API", () => {
  assert.equal(
    placementActionEndpoint("generate"),
    "/api/placement-generate",
  );
  assert.equal(placementActionEndpoint("retry"), "/api/placement-retry");
});

test("placement request completions apply only to the current match epoch", () => {
  assert.equal(
    isPlacementRequestCurrent(
      { matchId: "match-a", epoch: 2 },
      { matchId: "match-a", epoch: 2 },
    ),
    true,
  );
  assert.equal(
    isPlacementRequestCurrent(
      { matchId: "match-a", epoch: 1 },
      { matchId: "match-a", epoch: 2 },
    ),
    false,
  );
  assert.equal(
    isPlacementRequestCurrent(
      { matchId: "match-a", epoch: 2 },
      { matchId: "match-b", epoch: 2 },
    ),
    false,
  );
});

test("only completed placement lifecycle states trigger a server refresh", () => {
  assert.equal(isPlacementTerminal("not_requested"), false);
  assert.equal(isPlacementTerminal("processing"), false);
  assert.equal(isPlacementTerminal("retrying"), false);
  assert.equal(isPlacementTerminal("ready"), true);
  assert.equal(isPlacementTerminal("retry_available"), true);
  assert.equal(isPlacementTerminal("final_failed"), true);
});

test("placement request errors use stable user-facing copy", () => {
  assert.equal(
    placementRequestErrorCopy("source_expired"),
    "The original recording is no longer available for placement analysis.",
  );
  assert.equal(
    placementRequestErrorCopy("generation_already_processing"),
    "Placement maps are already being generated.",
  );
  assert.equal(
    placementRequestErrorCopy("already_retrying"),
    "Placement maps are already being generated.",
  );
  assert.equal(
    placementRequestErrorCopy("retry_already_used"),
    "The one-time placement retry has already been used.",
  );
  assert.equal(
    placementRequestErrorCopy("not_owner"),
    "Only the match owner can request placement maps.",
  );
  assert.equal(
    placementRequestErrorCopy("not_authenticated"),
    "Please sign in again before requesting placement maps.",
  );
  assert.equal(
    placementRequestErrorCopy("unknown"),
    "We couldn't start placement analysis. Please try again.",
  );
});

test("placement notices direct non-owners to the match owner", () => {
  const generate = placementLifecycleView("not_requested", 0, future, now);
  assert.equal(
    placementNoticeForViewer(generate, true),
    "You can request placement maps from Tools while the original "
      + "recording is available.",
  );
  assert.equal(
    placementNoticeForViewer(generate, false),
    "The match owner can request placement maps while the original "
      + "recording is available.",
  );

  const retry = placementLifecycleView("retry_available", 0, future, now);
  assert.equal(
    placementNoticeForViewer(retry, false),
    "Placement maps need another try. The match owner can request the "
      + "stronger retry once.",
  );
});

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

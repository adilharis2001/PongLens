import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlacementRequestCurrent,
  isPlacementTerminal,
  placementActionEndpoint,
  placementExpiryTimerDelay,
  placementLifecycleView,
  placementNoticeForViewer,
  placementRequestFailureResolution,
  placementRequestErrorCopy,
  placementRequestUiTransition,
  placementRetryView,
  scrollToReadyPlacement,
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

test("accepted placement requests each receive a fresh acknowledgement sequence", () => {
  const started = placementRequestUiTransition(
    { sheetOpen: true, acknowledgement: null, acknowledgementSequence: 0 },
    { type: "started" },
  );
  assert.deepEqual(started, {
    sheetOpen: false,
    acknowledgement: {
      id: 1,
      message: "Placement maps are generating. We’ll email you when ready.",
    },
    acknowledgementSequence: 1,
  });
  const restarted = placementRequestUiTransition(started, {
    type: "started",
  });
  assert.deepEqual(restarted, {
    sheetOpen: false,
    acknowledgement: {
      id: 2,
      message: "Placement maps are generating. We’ll email you when ready.",
    },
    acknowledgementSequence: 2,
  });
  assert.deepEqual(
    placementRequestUiTransition(restarted, {
      type: "dismiss_acknowledgement",
    }),
    { sheetOpen: false, acknowledgement: null, acknowledgementSequence: 2 },
  );
});

test("failed placement request keeps the sheet open without a toast", () => {
  assert.deepEqual(
    placementRequestUiTransition(
      { sheetOpen: true, acknowledgement: null, acknowledgementSequence: 0 },
      { type: "failed" },
    ),
    { sheetOpen: true, acknowledgement: null, acknowledgementSequence: 0 },
  );
});

test("duplicate placement requests adopt processing and reconcile lifecycle", () => {
  assert.deepEqual(
    placementRequestFailureResolution(
      "generate",
      "generation_already_processing",
    ),
    {
      status: "processing",
      retryCount: null,
      expireSource: false,
      reconcileLifecycle: true,
      showError: false,
    },
  );
  assert.deepEqual(
    placementRequestFailureResolution("retry", "already_retrying"),
    {
      status: "retrying",
      retryCount: 1,
      expireSource: false,
      reconcileLifecycle: true,
      showError: false,
    },
  );
});

test("authoritative placement conflicts replace stale actionable state", () => {
  for (const code of [
    "source_expired",
    "generation_already_used",
    "generation_unavailable",
    "retry_already_used",
    "retry_unavailable",
  ]) {
    const resolution = placementRequestFailureResolution("generate", code);
    assert.equal(resolution.reconcileLifecycle, true, code);
    assert.equal(resolution.showError, true, code);
  }
  assert.equal(
    placementRequestFailureResolution("generate", "source_expired")
      .expireSource,
    true,
  );
  assert.equal(
    placementRequestFailureResolution("generate", "queue_failed")
      .reconcileLifecycle,
    false,
  );
});

test("live placement actions schedule a clock-driven expiry refresh", () => {
  assert.equal(
    placementExpiryTimerDelay(
      "2026-07-29T12:00:10Z",
      new Date("2026-07-29T12:00:00Z"),
    ),
    10_001,
  );
  assert.equal(
    placementExpiryTimerDelay(
      "2026-07-29T11:59:59Z",
      new Date("2026-07-29T12:00:00Z"),
    ),
    null,
  );
  assert.equal(placementExpiryTimerDelay(null, now), null);
  assert.equal(
    placementExpiryTimerDelay(
      "2026-08-28T12:00:00Z",
      new Date("2026-07-29T12:00:00Z"),
    ),
    2_147_483_647,
  );
  assert.equal(
    placementExpiryTimerDelay(
      "2026-08-28T12:00:00Z",
      new Date("2026-08-23T08:31:23.647Z"),
    ),
    444_516_354,
  );
});

test("ready placement scrolls directly to the ball map target", () => {
  let requestedId = "";
  let scrollOptions: ScrollIntoViewOptions | undefined;
  const didScroll = scrollToReadyPlacement({
    getElementById(id) {
      requestedId = id;
      return {
        scrollIntoView(options) {
          scrollOptions = options;
        },
      };
    },
  });

  assert.equal(didScroll, true);
  assert.equal(requestedId, "ball-map");
  assert.deepEqual(scrollOptions, { behavior: "smooth", block: "start" });
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

test("source failures use source-unavailable copy at either attempt", () => {
  for (const [retryCount, failureCode] of [
    [0, "source_missing"],
    [1, "source_expired"],
  ] as const) {
    const view = placementLifecycleView(
      "final_failed",
      retryCount,
      null,
      now,
      failureCode,
    );
    assert.doesNotMatch(view.sheetBody, /tried again/i);
    assert.match(view.sheetBody, /original recording/i);
  }
});

test("non-source final failure reflects whether stronger retry ran", () => {
  const normal = placementLifecycleView(
    "final_failed",
    0,
    null,
    now,
    "historical_unavailable",
  );
  assert.doesNotMatch(normal.sheetBody, /tried again/i);
  assert.doesNotMatch(normal.sheetBody, /original recording/i);

  const stronger = placementLifecycleView(
    "final_failed",
    1,
    null,
    now,
    "no_mappable_points",
  );
  assert.match(stronger.sheetBody, /tried again/i);
});

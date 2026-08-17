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
  showPlacementDeepDive,
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
      message: "Placement maps are generating. We'll email you when they're ready.",
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
      message: "Placement maps are generating. We'll email you when they're ready.",
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

test("placement request errors use plain user-facing copy", () => {
  assert.equal(
    placementRequestErrorCopy("source_expired"),
    "Placement maps couldn't be generated because the original video is no longer available.",
  );
  assert.equal(
    placementRequestErrorCopy("generation_already_processing"),
    "Placement maps are generating. We'll email you when they're ready.",
  );
  assert.equal(
    placementRequestErrorCopy("already_retrying"),
    "We're trying again. We'll email you when they're ready.",
  );
  assert.equal(
    placementRequestErrorCopy("retry_already_used"),
    "Placement maps have already been requested.",
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
    "Placement maps couldn't be generated. Please try again.",
  );
});

test("placement notices direct non-owners to the match owner", () => {
  const generate = placementLifecycleView("not_requested", 0, future, now);
  assert.equal(
    placementNoticeForViewer(generate, true),
    "Placement maps haven't been generated for this match. You can generate them from Tools.",
  );
  assert.equal(
    placementNoticeForViewer(generate, false),
    "The match owner can generate placement maps.",
  );

  const retry = placementLifecycleView("retry_available", 0, future, now);
  assert.equal(
    placementNoticeForViewer(retry, false),
    "The match owner can try again.",
  );
});

test("retry available exposes one friendly primary action", () => {
  assert.deepEqual(
    placementRetryView("retry_available", 0, future, now),
    {
      tone: "warning",
      title: "Placement maps need another try",
      body:
        "Placement maps couldn't be generated because the table was hard to detect in this video. You can try once more from Tools.",
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
  assert.equal(
    view?.body,
    "Placement maps couldn't be generated because the original video is no longer available.",
  );
});

test("live not-requested placement offers generation", () => {
  assert.deepEqual(
    placementLifecycleView("not_requested", 0, future, now),
    {
      tone: "muted",
      toolStatus: "Generate",
      sheetTitle: "Generate placement maps?",
      sheetBody:
        "Placement maps haven't been generated for this match. You can generate them from Tools.",
      noticeTitle: "Placement maps haven't been generated",
      noticeBody:
        "Placement maps haven't been generated for this match. You can generate them from Tools.",
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
  assert.equal(
    view.noticeBody,
    "Placement maps couldn't be generated because the original video is no longer available.",
  );
});

test("lifecycle states use approved plain-language copy", () => {
  const cases = [
    ["not_requested", 0, future,
      "Placement maps haven't been generated for this match. You can generate them from Tools."],
    ["processing", 0, future,
      "Placement maps are generating. We'll email you when they're ready."],
    ["retry_available", 0, future,
      "Placement maps couldn't be generated because the table was hard to detect in this video. You can try once more from Tools."],
    ["retrying", 1, future,
      "We're trying again. We'll email you when they're ready."],
    ["final_failed", 1, null,
      "Placement maps couldn't be generated because the table was hard to detect in this video."],
  ] as const;

  for (const [status, count, expiry, copy] of cases) {
    const view = placementLifecycleView(status, count, expiry, now);
    assert.equal(view.sheetBody, copy, status);
    assert.equal(view.noticeBody, copy, status);
  }

  const sourceUnavailable = placementLifecycleView(
    "final_failed", 0, null, now, "source_missing",
  );
  assert.equal(
    sourceUnavailable.sheetBody,
    "Placement maps couldn't be generated because the original video is no longer available.",
  );
  assert.equal(sourceUnavailable.noticeBody, sourceUnavailable.sheetBody);
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
    assert.equal(
      view.sheetBody,
      "Placement maps couldn't be generated because the original video is no longer available.",
    );
  }
});

test("final failure copy stays simple regardless of attempts", () => {
  const normal = placementLifecycleView(
    "final_failed",
    0,
    null,
    now,
    "historical_unavailable",
  );
  assert.equal(
    normal.sheetBody,
    "Placement maps couldn't be generated because the table was hard to detect in this video.",
  );

  const retry = placementLifecycleView(
    "final_failed",
    1,
    null,
    now,
    "no_mappable_points",
  );
  assert.equal(retry.sheetBody, normal.sheetBody);
});

test("customer-facing placement copy avoids technical implementation language", () => {
  const views = [
    placementLifecycleView("not_requested", 0, future, now),
    placementLifecycleView("not_requested", 0, "2026-07-28T12:00:00Z", now),
    placementLifecycleView("processing", 0, future, now),
    placementLifecycleView("retry_available", 0, future, now),
    placementLifecycleView("retrying", 1, future, now),
    placementLifecycleView("final_failed", 1, null, now),
    placementLifecycleView("final_failed", 0, null, now, "source_missing"),
  ];
  const copy = [
    ...views.flatMap((view) => [view.sheetBody, view.noticeBody ?? ""]),
    ...[
      "source_expired",
      "generation_already_processing",
      "already_retrying",
      "retry_already_used",
      "generation_already_used",
      "generation_unavailable",
      "retry_unavailable",
      "match_not_found",
      "not_owner",
      "not_authenticated",
      "unknown",
    ].map(placementRequestErrorCopy),
    placementNoticeForViewer(views[0], false) ?? "",
    placementNoticeForViewer(views[3], false) ?? "",
    placementRetryView("retry_available", 0, future, now)?.body ?? "",
  ].join(" ");
  assert.doesNotMatch(
    copy,
    /(reliable|calibration|stronger|normal placement analysis|processing-retention)/i,
  );
});

test("placement deep-dive visibility follows lifecycle and drawable data", () => {
  for (const [status, count, expiry, visible] of [
    ["not_requested", 0, future, true],
    ["processing", 0, future, false],
    ["retry_available", 0, future, true],
    ["retrying", 1, future, false],
    ["ready", 0, null, true],
    ["final_failed", 1, null, true],
  ] as const) {
    assert.equal(
      showPlacementDeepDive(
        placementLifecycleView(status, count, expiry, now),
        false,
      ),
      visible,
      status,
    );
  }
  assert.equal(
    showPlacementDeepDive(
      placementLifecycleView("processing", 0, future, now),
      true,
    ),
    true,
  );
});

// A video whose table nobody could find. Every detector in the ladder
// declined it — the keypoint network, then Luna, then Sol — so there is no
// second thing to try, and the player's single placement request must not
// be spent on a run that would fail identically.
test("no table found is terminal and offers no action", () => {
  const view = placementLifecycleView(
    "final_failed",
    0,
    null,
    now,
    "no_table_found",
  );
  assert.equal(view.toolStatus, "Unavailable");
  assert.equal(view.actionKind, null);
  assert.equal(view.actionLabel, null);
  assert.equal(view.poll, false);
});

test("no table found says the rest of the match is fine", () => {
  const view = placementLifecycleView(
    "final_failed",
    0,
    null,
    now,
    "no_table_found",
  );
  assert.match(view.noticeBody ?? "", /couldn't find the table/i);
  assert.match(view.noticeBody ?? "", /unaffected/i);
  // Never invite a retry that cannot succeed.
  assert.doesNotMatch(view.noticeBody ?? "", /try again|once more/i);
});

test("a used-up retry keeps its own wording, separate from no table found", () => {
  const usedUp = placementLifecycleView("final_failed", 1, null, now, null);
  const noTable = placementLifecycleView(
    "final_failed",
    0,
    null,
    now,
    "no_table_found",
  );
  assert.notEqual(usedUp.noticeTitle, noTable.noticeTitle);
});

test("the retry view passes the failure code through", () => {
  const view = placementRetryView(
    "final_failed",
    0,
    null,
    now,
    "no_table_found",
  );
  assert.match(view?.body ?? "", /couldn't find the table/i);
  assert.equal(view?.action, null);
});

test("a no-table match still shows the placement notice rather than nothing", () => {
  assert.equal(
    showPlacementDeepDive(
      placementLifecycleView("final_failed", 0, null, now, "no_table_found"),
      false,
    ),
    true,
  );
});

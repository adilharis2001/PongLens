import assert from "node:assert/strict";
import test from "node:test";
import { placementRetryView } from "./placementRetry.ts";

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

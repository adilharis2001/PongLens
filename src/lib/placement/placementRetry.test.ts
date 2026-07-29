import assert from "node:assert/strict";
import test from "node:test";
import {
  placementRetryAction,
  placementRetryError,
} from "./placementRetry.ts";

test("only a live unused retry_available match can enqueue", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  assert.equal(
    placementRetryAction(
      "retry_available",
      0,
      "2026-07-30T12:00:00Z",
      now,
    ),
    "enqueue",
  );
  assert.equal(
    placementRetryAction(
      "retry_available",
      0,
      "2026-07-28T12:00:00Z",
      now,
    ),
    "expired",
  );
  assert.equal(
    placementRetryAction("retry_available", 1, null, now),
    "used",
  );
  assert.equal(
    placementRetryAction("retrying", 1, null, now),
    "already_retrying",
  );
});

test("database errors become stable API codes", () => {
  assert.deepEqual(
    placementRetryError({ code: "P0002", message: "match not found" }),
    { status: 404, code: "match_not_found" },
  );
  assert.deepEqual(
    placementRetryError({ code: "23514", message: "already used" }),
    { status: 409, code: "retry_already_used" },
  );
  assert.deepEqual(
    placementRetryError({ code: "P0001", message: "unavailable" }),
    { status: 409, code: "retry_unavailable" },
  );
  assert.deepEqual(
    placementRetryError({
      code: "P0001",
      message: "placement retry already queued",
    }),
    { status: 409, code: "already_retrying" },
  );
});

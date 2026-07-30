import assert from "node:assert/strict";
import test from "node:test";
import {
  placementActionAvailability,
  placementGenerationError,
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

test("lifecycle availability distinguishes normal generation from retry", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  const future = "2026-07-30T12:00:00Z";
  const expired = "2026-07-28T12:00:00Z";

  assert.equal(
    placementActionAvailability("not_requested", 0, future, now),
    "generate",
  );
  assert.equal(
    placementActionAvailability("retry_available", 0, future, now), "retry");
  assert.equal(
    placementActionAvailability("not_requested", 0, expired, now), "expired");
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

test("generation database errors become stable API codes", () => {
  assert.deepEqual(
    placementGenerationError({
      code: "P0001",
      message: "placement generation already queued",
    }),
    { status: 409, code: "generation_already_processing" },
  );
  assert.deepEqual(
    placementGenerationError({
      code: "P0001",
      message: "placement generation unavailable",
    }),
    { status: 409, code: "generation_unavailable" },
  );
  assert.deepEqual(
    placementGenerationError({ code: "42501", message: "not owner" }),
    { status: 403, code: "not_owner" },
  );
});

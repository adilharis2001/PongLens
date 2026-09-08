import assert from "node:assert/strict";
import test from "node:test";

import { matchIssueCancelInput, matchIssueInput } from "./input.ts";

const UUID = "12345678-1234-4234-8234-123456789abc";

test("submission input trims valid choices without changing the server-owned amount", () => {
  assert.deepEqual(
    matchIssueInput({
      kind: "refund",
      message: "  The cut missed the final rally.  ",
      idempotencyKey: UUID,
      refundableMinutes: 500,
    }),
    {
      kind: "refund",
      message: "The cut missed the final rally.",
      idempotencyKey: UUID,
    },
  );
});

test("problem reports require a useful message", () => {
  for (const message of [undefined, null, "", "   "]) {
    assert.equal(
      matchIssueInput({ kind: "problem", message, idempotencyKey: UUID }),
      null,
    );
  }
});

test("positive and remedy messages may be empty and stop at 1000 characters", () => {
  for (const kind of ["positive", "reprocess", "refund"] as const) {
    assert.deepEqual(matchIssueInput({ kind, idempotencyKey: UUID }), {
      kind,
      message: "",
      idempotencyKey: UUID,
    });
    assert.equal(
      matchIssueInput({ kind, message: "x".repeat(1001), idempotencyKey: UUID }),
      null,
    );
  }
});

test("unknown choices and malformed idempotency keys are rejected", () => {
  assert.equal(matchIssueInput({ kind: "complaint", idempotencyKey: UUID }), null);
  assert.equal(matchIssueInput({ kind: "refund", idempotencyKey: "not-a-uuid" }), null);
  assert.equal(matchIssueInput(null), null);
  assert.equal(matchIssueInput([]), null);
});

test("cancellation accepts only an issue UUID", () => {
  assert.deepEqual(matchIssueCancelInput({ issueId: UUID }), { issueId: UUID });
  assert.equal(matchIssueCancelInput({ issueId: "" }), null);
  assert.equal(matchIssueCancelInput({ id: UUID }), null);
});

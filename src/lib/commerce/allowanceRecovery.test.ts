import { test } from "node:test";
import assert from "node:assert/strict";
import * as recovery from "./allowanceRecovery.ts";

test("storage refusals offer an allowance request, unrelated errors do not", () => {
  assert.equal(recovery.uploadAllowanceResource("Storage is full. Delete a video or manage your allowance in Account."), "storage");
  assert.equal(recovery.uploadAllowanceResource("Storage is full. Delete a video or request more space."), "storage");
  for (const message of [null, "Could not check your storage allowance. Please try again.", "Your queue is full. Wait for a match to finish.", "Daily upload limit reached. Try again tomorrow.", "Network error"]) {
    assert.equal(recovery.uploadAllowanceResource(message), null);
  }
});

test("recovery waits for configuration before offering requests or purchases", () => {
  assert.equal(recovery.allowanceRecoveryMode(null), "loading");
  assert.equal(recovery.allowanceRecoveryMode(false), "request");
  assert.equal(recovery.allowanceRecoveryMode(true), "purchase");
});

test("a finished download needing more minutes is recoverable without reimporting", () => {
  assert.equal(recovery.importNeedsMinutes({ status: "uploaded", duration_s: 61 }, 1, true), true);
  assert.equal(recovery.importNeedsMinutes({ status: "uploaded", duration_s: 60 }, 1, true), false);
  assert.equal(recovery.importNeedsMinutes({ status: "queued", duration_s: 61 }, 0, true), false);
  assert.equal(recovery.importNeedsMinutes({ status: "uploaded", duration_s: 61 }, null, true), false);
  assert.equal(recovery.importNeedsMinutes({ status: "uploaded", duration_s: 61 }, 0, false), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { highlightsEnabled } from "./access.ts";

test("highlights can be global or limited to selected users", () => {
  assert.equal(highlightsEnabled("on", "user-a"), true);
  assert.equal(highlightsEnabled("user:user-a", "user-a"), true);
  assert.equal(highlightsEnabled("users:user-a,user-b", "user-a"), true);
  assert.equal(highlightsEnabled("users:user-a, user-b", "user-b"), true);
  assert.equal(highlightsEnabled("off", "user-a"), false);
  assert.equal(highlightsEnabled("user:user-b", "user-a"), false);
  assert.equal(highlightsEnabled(null, "user-a"), false);
});

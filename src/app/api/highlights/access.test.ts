import assert from "node:assert/strict";
import test from "node:test";
import { automaticHighlightsEnabled } from "./access";

test("automatic highlights can be global or limited to one user", () => {
  assert.equal(automaticHighlightsEnabled("on", "user-a"), true);
  assert.equal(automaticHighlightsEnabled("user:user-a", "user-a"), true);
  assert.equal(automaticHighlightsEnabled("off", "user-a"), false);
  assert.equal(automaticHighlightsEnabled("user:user-b", "user-a"), false);
  assert.equal(automaticHighlightsEnabled(null, "user-a"), false);
});

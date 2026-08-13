import assert from "node:assert/strict";
import test from "node:test";
import { parseRecollectAction } from "./actions.ts";

const topicId = "11111111-1111-4111-8111-111111111111";
const pointId = "33333333-3333-4333-8333-333333333333";
const reviewKey = "22222222-2222-4222-8222-222222222222";

test("Recollect actions reject malformed identifiers", () => {
  assert.equal(
    parseRecollectAction({ action: "open", topicId: "bad", reviewKey }),
    null,
  );
  assert.equal(
    parseRecollectAction({ action: "dismiss", pointId: "../other" }),
    null,
  );
  // The question-card actions are gone and must not be routable.
  assert.equal(
    parseRecollectAction({ action: "reveal", itemId: topicId, reviewKey }),
    null,
  );
});

test("Recollect actions accept only the four supported shapes", () => {
  assert.deepEqual(parseRecollectAction({ action: "open", topicId, reviewKey }), {
    action: "open",
    topicId,
    reviewKey,
  });
  assert.deepEqual(parseRecollectAction({ action: "dismiss", pointId }), {
    action: "dismiss",
    pointId,
  });
  assert.deepEqual(
    parseRecollectAction({ action: "add_to_working_on", pointId }),
    { action: "add_to_working_on", pointId },
  );
  assert.deepEqual(parseRecollectAction({ action: "acknowledge_notice" }), {
    action: "acknowledge_notice",
  });
  assert.equal(parseRecollectAction({ action: "unknown", pointId }), null);
});

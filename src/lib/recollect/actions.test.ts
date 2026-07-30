import assert from "node:assert/strict";
import test from "node:test";
import { parseRecollectAction } from "./actions.ts";

const itemId = "11111111-1111-4111-8111-111111111111";
const reviewKey = "22222222-2222-4222-8222-222222222222";

test("Recollect actions reject malformed identifiers", () => {
  assert.equal(
    parseRecollectAction({ action: "reveal", itemId: "bad", reviewKey }),
    null,
  );
  assert.equal(
    parseRecollectAction({ action: "dismiss", itemId: "../other" }),
    null,
  );
});

test("Recollect actions accept only the four supported shapes", () => {
  assert.deepEqual(
    parseRecollectAction({ action: "reveal", itemId, reviewKey }),
    { action: "reveal", itemId, reviewKey },
  );
  assert.deepEqual(
    parseRecollectAction({ action: "add_to_working_on", itemId }),
    { action: "add_to_working_on", itemId },
  );
  assert.deepEqual(parseRecollectAction({ action: "acknowledge_notice" }), {
    action: "acknowledge_notice",
  });
  assert.equal(parseRecollectAction({ action: "unknown", itemId }), null);
});

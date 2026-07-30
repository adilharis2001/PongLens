import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_SECTION_ORDER } from "./adminPageView.ts";

test("platform costs are the final admin section", () => {
  assert.deepEqual(ADMIN_SECTION_ORDER, [
    "accessRequests",
    "inviteCodes",
    "storage",
    "platformCosts",
  ]);
  assert.equal(ADMIN_SECTION_ORDER.at(-1), "platformCosts");
});

import assert from "node:assert/strict";
import test from "node:test";

import { makeFlow } from "./coach.mjs";

test("the first screenshot is retried if authentication finishes navigating", async () => {
  let calls = 0;
  const shown = [];
  const page = {
    evaluate: async (_fn, [src]) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Execution context was destroyed, most likely because of a navigation");
      }
      shown.push(src);
    },
  };
  const clock = { until: async () => {} };
  const beat = () => ({ start: 4, end: 5, dur: 1 });

  await makeFlow()(page, clock, { beat });

  assert.match(shown[0], /coach-page-m\.jpg$/);
});

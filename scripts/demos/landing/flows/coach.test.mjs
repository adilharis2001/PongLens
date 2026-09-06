import assert from "node:assert/strict";
import test from "node:test";

import { flow as desktopFlow } from "./coach-desktop.mjs";
import { flow as mobileFlow } from "./coach-mobile.mjs";
import { makeFlow } from "./coach.mjs";

const runFlow = async (flow) => {
  const shown = [];
  const page = {
    evaluate: async (_fn, [src]) => shown.push(src.split("/").pop()),
  };
  const clock = { until: async () => {} };
  const beat = () => ({ start: 4, end: 5, dur: 1 });

  await flow(page, clock, { beat });
  return shown;
};

test("the desktop cut uses desktop web views for every visual beat", async () => {
  assert.deepEqual(await runFlow(desktopFlow), [
    "coach-page-d.jpg",
    "coach-students-d.jpg",
    "coach-entry-compose-d.jpg",
    "coach-entry-shared-d.jpg",
    "coach-order-d.jpg",
    "coach-queue-d.jpg",
    "coach-points-d.jpg",
    "coach-payout-d.jpg",
  ]);
});

test("the mobile cut keeps the mobile and native lesson views", async () => {
  assert.deepEqual(await runFlow(mobileFlow), [
    "coach-page-m.jpg",
    "coach-students-m.jpg",
    "coach-record-m.jpg",
    "coach-entry-shared-m.jpg",
    "coach-order-m.jpg",
    "coach-queue-m.jpg",
    "coach-review-m.jpg",
    "coach-payout-m.jpg",
  ]);
});

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

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chargeMinutes,
  formatClock,
  formatGb,
  formatMinutes,
} from "./minutes.ts";

test("chargeMinutes mirrors the SQL: ceil to the minute, minimum one", () => {
  // greatest(1, ceil((end - start) / 60.0)) in claim_processing.
  assert.equal(chargeMinutes(5), 1);
  assert.equal(chargeMinutes(59.9), 1);
  assert.equal(chargeMinutes(60), 1);
  assert.equal(chargeMinutes(60.01), 2);
  assert.equal(chargeMinutes(61), 2);
  assert.equal(chargeMinutes(600), 10);
  assert.equal(chargeMinutes(2700), 45); // the review cap default, exactly
  assert.equal(chargeMinutes(2701), 46); // one second over is one minute over
});

test("chargeMinutes refuses nonsense", () => {
  assert.equal(chargeMinutes(0), 0);
  assert.equal(chargeMinutes(-5), 0);
  assert.equal(chargeMinutes(NaN), 0);
  assert.equal(chargeMinutes(Infinity), 0);
});

test("formatMinutes and formatGb read as words", () => {
  assert.equal(formatMinutes(1), "1 minute");
  assert.equal(formatMinutes(250), "250 minutes");
  assert.equal(formatMinutes(0), "0 minutes");
  assert.equal(formatGb(10737418240), "10 GB");
  assert.equal(formatGb(1610612736), "1.5 GB");
  assert.equal(formatGb(0), "0 GB");
});

test("formatClock covers both shapes", () => {
  assert.equal(formatClock(444), "7:24");
  assert.equal(formatClock(4044), "1:07:24");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(59.6), "1:00"); // rounds, never shows :60
});

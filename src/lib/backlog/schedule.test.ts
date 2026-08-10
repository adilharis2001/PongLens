import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDays,
  daysBetween,
  endOfWeek,
  monthDay,
  startOfWeek,
  todayISO,
} from "./schedule.ts";

// 2026-02-11 is a Wednesday. Its week runs Mon 2026-02-09 → Sun 2026-02-15.
const WED = "2026-02-11";
const SUN = "2026-02-15";

test("weeks start on Monday", () => {
  assert.equal(startOfWeek(WED), "2026-02-09");
  assert.equal(endOfWeek(WED), SUN);
  assert.equal(startOfWeek(SUN), "2026-02-09");
  assert.equal(endOfWeek(SUN), SUN);
});

test("day arithmetic crosses months and years", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-02-28", "2026-03-02"), 2);
});

// The bug this guards: a naive local-time parse shifts the day for anyone
// west of UTC across a daylight-saving boundary. US DST starts 2026-03-08.
test("day arithmetic survives a daylight-saving jump", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
});

test("todayISO reads the local calendar day, not UTC", () => {
  // 23:30 local on the 11th is the 12th in UTC. It must say the 11th.
  assert.equal(todayISO(new Date(2026, 1, 11, 23, 30)), "2026-02-11");
});

test("monthDay names the day it was given, not the day before", () => {
  assert.equal(monthDay("2026-02-23"), "Feb 23");
  assert.equal(monthDay("2026-01-01"), "Jan 1");
});

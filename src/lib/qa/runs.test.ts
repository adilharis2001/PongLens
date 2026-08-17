import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentResults,
  isoWeek,
  periodFor,
  progressFor,
  type CaseResult,
} from "./runs.ts";
import type { TestDepth } from "./testLibrary.ts";

function result(case_id: string, period: string, status: CaseResult["status"]) {
  return {
    case_id,
    period,
    status,
    note: "",
    marked_by: "someone",
    updated_at: "2026-08-13T00:00:00Z",
  };
}

test("ISO weeks start on Monday", () => {
  // 2026-08-10 is a Monday; the Sunday before it belongs to the week prior.
  assert.equal(isoWeek(new Date("2026-08-10T00:00:00Z")), "2026-W33");
  assert.equal(isoWeek(new Date("2026-08-16T23:59:00Z")), "2026-W33");
  assert.equal(isoWeek(new Date("2026-08-09T12:00:00Z")), "2026-W32");
  assert.equal(isoWeek(new Date("2026-08-17T00:00:00Z")), "2026-W34");
});

test("a week spanning new year belongs to the year holding its Thursday", () => {
  // The trap that makes this more than day-of-year over seven: 1 Jan 2027
  // is a Friday, so it belongs to 2026's last week, not 2027's first.
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026-W53");
  assert.equal(isoWeek(new Date("2027-01-04T00:00:00Z")), "2027-W01");
});

test("the period is fixed for a once-only case and weekly otherwise", () => {
  const monday = new Date("2026-08-10T09:00:00Z");
  assert.equal(periodFor("smoke", monday), "week:2026-W33");
  assert.equal(periodFor("core", monday), "week:2026-W33");
  assert.equal(periodFor("edge", monday), "once");
});

test("a mark made last week no longer counts as run", () => {
  // This is the reset, and it needs nothing to run at midnight on Monday.
  const depths = new Map<string, TestDepth>([["match-seek", "core"]]);
  const results = [result("match-seek", "week:2026-W33", "pass")];

  const sameWeek = currentResults(results, depths, new Date("2026-08-12T00:00:00Z"));
  assert.equal(sameWeek.get("match-seek")?.status, "pass");

  const nextWeek = currentResults(results, depths, new Date("2026-08-18T00:00:00Z"));
  assert.equal(nextWeek.size, 0);
});

test("a once-only case stays marked forever", () => {
  const depths = new Map<string, TestDepth>([["match-export", "edge"]]);
  const results = [result("match-export", "once", "pass")];
  const later = currentResults(results, depths, new Date("2027-03-01T00:00:00Z"));
  assert.equal(later.get("match-export")?.status, "pass");
});

test("a result for a case that no longer exists is ignored", () => {
  const results = [result("retired-case", "once", "pass")];
  assert.equal(currentResults(results, new Map(), new Date()).size, 0);
});

test("progress counts what has been run, and how it went", () => {
  const results = new Map([
    ["a", result("a", "week:2026-W33", "pass")],
    ["b", result("b", "week:2026-W33", "fail")],
    ["c", result("c", "week:2026-W33", "blocked")],
  ]);
  assert.deepEqual(progressFor(["a", "b", "c", "d"], results), {
    total: 4,
    run: 3,
    passed: 1,
    failed: 1,
  });
  // Blocked counts as run: it was attempted, and it is not still waiting.
  assert.deepEqual(progressFor([], results), {
    total: 0,
    run: 0,
    passed: 0,
    failed: 0,
  });
});

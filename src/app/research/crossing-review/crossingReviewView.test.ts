import assert from "node:assert/strict";
import test from "node:test";
import { CROSSING_REVIEW_ROWS } from "./data.ts";
import {
  filterRows,
  formatClock,
  matchOptions,
  tabCounts,
} from "./crossingReviewView.ts";

test("the snapshot holds both review classes and nothing else", () => {
  const counts = tabCounts(CROSSING_REVIEW_ROWS);
  assert.equal(
    counts.missed_junk + counts.flagged_kept,
    CROSSING_REVIEW_ROWS.length,
  );
  assert.ok(counts.missed_junk > 0);
  assert.ok(counts.flagged_kept > 0);
  for (const row of CROSSING_REVIEW_ROWS) {
    assert.ok(row.pointId.length === 36, row.pointId);
    assert.ok(row.matchId.length === 36, row.matchId);
    assert.ok(row.dur > 0);
    // The classes mean what they say: missed junk crossed at least once,
    // a flagged kept point never did.
    if (row.cls === "missed_junk") assert.ok(row.crossings >= 1);
    else assert.equal(row.crossings, 0);
  }
});

test("filtering is by tab and optionally by match", () => {
  const all = filterRows(CROSSING_REVIEW_ROWS, {
    tab: "missed_junk",
    match: "all",
  });
  assert.ok(all.every((row) => row.cls === "missed_junk"));

  const first = all[0];
  const one = filterRows(CROSSING_REVIEW_ROWS, {
    tab: "missed_junk",
    match: first.matchId,
  });
  assert.ok(one.length >= 1);
  assert.ok(one.every((row) => row.matchId === first.matchId));
});

test("match options are per-tab with counts", () => {
  const options = matchOptions(CROSSING_REVIEW_ROWS, "flagged_kept");
  assert.ok(options.length > 1);
  const total = options.reduce((sum, option) => sum + option.count, 0);
  assert.equal(total, tabCounts(CROSSING_REVIEW_ROWS).flagged_kept);
  const labels = options.map((option) => option.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
});

test("the clock reads like a video timestamp", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(61.4), "1:01");
  assert.equal(formatClock(725.99), "12:05");
});

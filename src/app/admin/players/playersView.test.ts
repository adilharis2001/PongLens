import assert from "node:assert/strict";
import test from "node:test";
import {
  countLabel,
  durationsLabel,
  formatClock,
  gbLabel,
  retentionLabel,
  scoringLabel,
} from "./playersView.ts";

test("formatClock covers minutes, hours, and bad input", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(754), "12:34");
  assert.equal(formatClock(59.6), "1:00");
  assert.equal(formatClock(5025), "1:23:45");
  assert.equal(formatClock(3600), "1:00:00");
  assert.equal(formatClock(null), null);
  assert.equal(formatClock(-3), null);
  assert.equal(formatClock(Number.NaN), null);
});

test("retention rounds, clamps at 100, and needs both timelines", () => {
  assert.equal(retentionLabel(843, 648), "77% kept");
  assert.equal(retentionLabel(100, 104), "100% kept");
  assert.equal(retentionLabel(null, 648), null);
  assert.equal(retentionLabel(843, null), null);
  assert.equal(retentionLabel(0, 0), null);
});

test("durations show both timelines, or whichever exists", () => {
  assert.equal(durationsLabel(843, 648), "14:03 → 10:48");
  assert.equal(durationsLabel(843, null), "14:03");
  assert.equal(durationsLabel(null, null), null);
});

test("scoring label follows the library's chip rule", () => {
  const base = { points: 51, scored_points: 0, unscored_points: 49 };
  assert.equal(scoringLabel({ ...base, points: 0 }), "No points");
  assert.equal(scoringLabel(base), "51 points");
  // two lets: everything callable is called, so the match reads scored
  assert.equal(
    scoringLabel({ points: 51, scored_points: 49, unscored_points: 0 }),
    "51 points, scored"
  );
  assert.equal(
    scoringLabel({ points: 92, scored_points: 31, unscored_points: 61 }),
    "31/92 scored"
  );
});

test("storage labels trim the trailing .0", () => {
  assert.equal(gbLabel(5 * 1024 ** 3), "5 GB");
  assert.equal(gbLabel(1.9 * 1024 ** 3), "1.9 GB");
});

test("counts pluralize, including the irregular match", () => {
  assert.equal(countLabel(1, "point"), "1 point");
  assert.equal(countLabel(2, "point"), "2 points");
  assert.equal(countLabel(1, "match", "matches"), "1 match");
  assert.equal(countLabel(0, "match", "matches"), "0 matches");
  assert.equal(
    scoringLabel({ points: 1, scored_points: 1, unscored_points: 0 }),
    "1 point, scored"
  );
});

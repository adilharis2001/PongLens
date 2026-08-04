import assert from "node:assert/strict";
import test from "node:test";
import {
  cutLabelSummary,
  breakdownSummary,
  buildPointBreakdown,
  countLabel,
  durationsLabel,
  formatClock,
  gapLabel,
  gbLabel,
  pointFlags,
  retentionLabel,
  scoringLabel,
  timelineSegments,
  type AdminPoint,
} from "./playersView.ts";

function point(overrides: Partial<AdminPoint>): AdminPoint {
  return {
    id: "p",
    idx: 0,
    t0: 0,
    t1: 1,
    cut_t0: null,
    server: null,
    confirmed_winner: null,
    is_let: false,
    warmup: false,
    deleted: false,
    edited: false,
    starred: false,
    tight_start: false,
    tight_end: false,
    misread_kind: null,
    has_clip: true,
    ...overrides,
  };
}

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

test("point breakdown orders by time and measures the dead gaps", () => {
  const rows = buildPointBreakdown([
    point({ id: "b", idx: 1, t0: 30, t1: 38 }),
    point({ id: "a", idx: 0, t0: 12, t1: 20 }),
    point({ id: "c", idx: 2, t0: 38.4, t1: 45 }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["a", "b", "c"]
  );
  // 12s of dead intro, 10s removed between points, back-to-back at the end
  assert.deepEqual(
    rows.map((r) => Math.round(r.gapBeforeS * 10) / 10),
    [12, 10, 0.4]
  );
  assert.equal(rows[0].lengthS, 8);
  assert.equal(gapLabel(rows[1].gapBeforeS), "+10s dead");
  assert.equal(gapLabel(rows[2].gapBeforeS), null);
});

test("numeric strings from the RPC don't break the math", () => {
  const rows = buildPointBreakdown([
    point({ t0: "5.5" as unknown as number, t1: "9.5" as unknown as number }),
  ]);
  assert.equal(rows[0].lengthS, 4);
  assert.equal(rows[0].gapBeforeS, 5.5);
});

test("timeline segments cover the kept spans as percentages", () => {
  const rows = buildPointBreakdown([
    point({ idx: 0, t0: 10, t1: 30 }),
    point({ idx: 1, t0: 80, t1: 100 }),
  ]);
  const segments = timelineSegments(rows);
  assert.deepEqual(segments[0], {
    idx: 0,
    leftPct: 10,
    widthPct: 20,
    deleted: false,
  });
  assert.equal(segments[1].leftPct, 80);
  assert.deepEqual(timelineSegments([]), []);
});

test("the summary splits the source into played and removed", () => {
  const rows = buildPointBreakdown([
    point({ t0: 10, t1: 30 }),
    point({ t0: 80, t1: 100 }),
  ]);
  assert.equal(breakdownSummary(rows), "0:40 played · 1:00 removed");
  assert.equal(breakdownSummary([]), null);
});

test("point flags surface what needed fixing", () => {
  assert.deepEqual(pointFlags(point({})), []);
  assert.deepEqual(
    pointFlags(point({ edited: true, tight_start: true, tight_end: true })),
    ["edited", "tight"]
  );
  assert.deepEqual(pointFlags(point({ tight_end: true })), ["tight end"]);
  assert.deepEqual(
    pointFlags(
      point({ is_let: true, warmup: true, deleted: true, misread_kind: "x" })
    ),
    ["let", "warmup", "deleted", "misread"]
  );
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

test("cut-label summary counts sets in fixed order, skipping absent labels", () => {
  const labels = new Map([
    // a merged clip that ALSO opens mid-serve: both verdicts count
    ["a", new Set(["multi_2", "start_cut"])],
    ["b", new Set(["perfect"])],
    ["c", new Set(["perfect"])],
    ["d", new Set(["dead_space"])],
    ["e", new Set()],
  ] as const);
  assert.equal(
    cutLabelSummary(labels as never, 92),
    "4/92 labeled · 1 start · 1 dead · 1 2× · 2 perfect"
  );
  assert.equal(cutLabelSummary(new Map(), 92), null);
});

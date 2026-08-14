import assert from "node:assert/strict";
import test from "node:test";
import type { ServeMatch, ServePoint } from "./data.ts";
import {
  ALL_CAUSES,
  CAUSE_GROUPS,
  causeLabel,
  filterPoints,
  foundPct,
  isScored,
  stageOf,
  summarise,
} from "./serveDetectorView.ts";

function match(over: Partial<ServeMatch> = {}): ServeMatch {
  return {
    skey: "m",
    matchId: "id",
    venue: "LYTTC",
    opponent: "Someone",
    isRecut: false,
    quadProv: "human truth (high)",
    points: 100,
    found: 80,
    detRate: 0.8,
    onTable: 0.35,
    saved: 100,
    medErr: 0.2,
    labels: 10,
    quad: [],
    net: [],
    tracked: 60,
    deletedCards: 10,
    scoredCards: 40,
    ...over,
  };
}

function point(over: Partial<ServePoint> = {}): ServePoint {
  return {
    pointId: "p",
    matchId: "id",
    skey: "m",
    idx: 1,
    cutT0: 10,
    todayStart: 8.8,
    proposed: 11,
    serve: 13,
    saved: 2.2,
    why: null,
    detRate: 0.8,
    onTable: 0.3,
    bounces: 4,
    follow: 3,
    mode: "tracked",
    label: 13.2,
    win: [8.2, 15.6],
    hasTrack: true,
    ...over,
  };
}

test("a working match is not diagnosed", () => {
  assert.equal(stageOf(match()), "ok");
});

test("the first broken stage wins, because the later ones cannot be judged", () => {
  // Ball rate this low means the table rate is measured on almost nothing.
  assert.equal(stageOf(match({ found: 5, detRate: 0.5, onTable: 0.1 })), "ball");
  assert.equal(stageOf(match({ found: 5, detRate: 0.8, onTable: 0.1 })), "table");
  assert.equal(stageOf(match({ found: 5, detRate: 0.8, onTable: 0.4 })), "motif");
});

test("a match that works is left alone even with unremarkable rates", () => {
  // vinay_5721_rc really does look like this: a middling ball rate and a
  // fine result. Diagnosing it would send someone chasing nothing.
  assert.equal(stageOf(match({ points: 162, found: 103, detRate: 0.58 })), "ok");
});

test("found percentage survives an empty match", () => {
  assert.equal(foundPct(match({ points: 0, found: 0 })), 0);
});

test("filters compose", () => {
  const pts = [
    point({ pointId: "a", serve: 13 }),
    point({ pointId: "b", serve: null, saved: 0 }),
    point({ pointId: "c", skey: "other" }),
    point({ pointId: "d", hasTrack: false }),
  ];
  assert.deepEqual(
    filterPoints(pts, { match: "m", outcome: "all", onlyTracked: false })
      .map((p) => p.pointId),
    ["a", "b", "d"],
  );
  assert.deepEqual(
    filterPoints(pts, { match: "m", outcome: "missed", onlyTracked: false })
      .map((p) => p.pointId),
    ["b"],
  );
  assert.deepEqual(
    filterPoints(pts, { match: "all", outcome: "found", onlyTracked: true })
      .map((p) => p.pointId),
    ["a", "c"],
  );
});

test("the summary counts only points that carry a tap", () => {
  const s = summarise([
    point({ serve: 13, label: 13.2 }),
    point({ serve: 13, label: null }),
    point({ serve: null, label: 12, saved: 0 }),
  ]);
  assert.equal(s.points, 3);
  assert.equal(s.found, 2);
  assert.equal(s.labels, 1);
  assert.ok(s.medErr !== null && Math.abs(s.medErr - 0.2) < 1e-9);
});

test("every cause has a label and the values are unique", () => {
  assert.equal(new Set(ALL_CAUSES).size, ALL_CAUSES.length);
  for (const value of ALL_CAUSES) {
    assert.notEqual(causeLabel(value), value);
  }
  assert.equal(causeLabel("unknown"), "unknown");
  assert.ok(CAUSE_GROUPS.length >= 4);
});

test("a match with no deletions and no scoring is flagged unscored", () => {
  // Its found rate counts junk cards in the denominator, so it reads far
  // worse than a scored match on the same footage.
  assert.equal(isScored(match({ deletedCards: 0, scoredCards: 0 })), false);
  assert.equal(isScored(match({ deletedCards: 13, scoredCards: 0 })), true);
  assert.equal(isScored(match({ deletedCards: 0, scoredCards: 21 })), true);
});

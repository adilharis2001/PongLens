import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_CAUSES,
  KINDS,
  VERDICTS,
  decodeLane,
  filterRegions,
  formatClock,
  kindMeta,
  lowerBound95,
  missRate,
  recallFromMiss,
  totals,
} from "./recallView.ts";
import type { RecallMatch, RecallRegion } from "./data.ts";

function region(over: Partial<RecallRegion> = {}): RecallRegion {
  return {
    id: "m:card:001",
    kind: "card",
    t0: 10,
    t1: 15,
    why: "",
    cutT0: 5,
    cutT1: 10,
    laneStart: 7,
    lanes: {},
    inCut: 1,
    ...over,
  } as RecallRegion;
}

test("decodeLane expands run-length pairs in order", () => {
  assert.deepEqual(decodeLane("1:2,0:3"), [true, true, false, false, false]);
  assert.deepEqual(decodeLane(""), []);
  assert.deepEqual(decodeLane("0:0"), []);
});

test("decodeLane ignores malformed chunks rather than throwing", () => {
  assert.deepEqual(decodeLane("1:2,bad,0:1"), [true, true, false]);
});

test("filterRegions keeps everything when no kind is selected", () => {
  const rows = [region({ id: "a" }), region({ id: "b", kind: "gap" })];
  assert.equal(
    filterRegions(rows, { kinds: [], onlyUnreviewed: false, done: new Set() })
      .length,
    2,
  );
});

test("filterRegions narrows to the chosen kinds", () => {
  const rows = [region({ id: "a" }), region({ id: "b", kind: "gap" })];
  const out = filterRegions(rows, {
    kinds: ["gap"],
    onlyUnreviewed: false,
    done: new Set(),
  });
  assert.deepEqual(
    out.map((r) => r.id),
    ["b"],
  );
});

test("filterRegions can hide what has already been answered", () => {
  const rows = [region({ id: "a" }), region({ id: "b" })];
  const out = filterRegions(rows, {
    kinds: [],
    onlyUnreviewed: true,
    done: new Set(["a"]),
  });
  assert.deepEqual(
    out.map((r) => r.id),
    ["b"],
  );
});

test("the miss rate counts missing points in the real total, not the kept one", () => {
  // 12 missing out of 1231 counted points means 1243 were really played.
  assert.equal(missRate(12, 1231).toFixed(2), "0.97");
  assert.equal(recallFromMiss(12, 1231).toFixed(2), "99.03");
  assert.equal(missRate(0, 100), 0);
  assert.equal(missRate(1, 0), 100);
});

test("a clean run reports its honest lower bound, not 100%", () => {
  // 172 rallies with none lost cannot demonstrate 99.5%.
  assert.ok(lowerBound95(172, 0) > 98.2);
  assert.ok(lowerBound95(172, 0) < 98.4);
  assert.equal(lowerBound95(0, 0), 0);
});

test("with a failure the bound falls back to the observed rate", () => {
  assert.equal(lowerBound95(99, 1), 99);
});

test("totals add up across matches and round-trip the recall", () => {
  const matches = [
    { rallies: 55, labRecall: 1, labCards: 80, productionCards: 102, labBarren: 25, productionBarren: 48, regions: [region()] },
    { rallies: 38, labRecall: 1, labCards: 42, productionCards: 47, labBarren: 3, productionBarren: 9, regions: [] },
  ] as unknown as RecallMatch[];
  const t = totals(matches);
  assert.equal(t.rallies, 93);
  assert.equal(t.kept, 93);
  assert.equal(t.recall, 100);
  assert.equal(t.labCards, 122);
  assert.equal(t.productionCards, 149);
  assert.equal(t.regions, 1);
});

test("every kind has a question, and unknown kinds fall back", () => {
  for (const k of KINDS) {
    assert.ok(k.question.length > 0, `${k.value} needs a question`);
    assert.equal(kindMeta(k.value).value, k.value);
  }
  assert.ok(kindMeta("nonsense").question.length > 0);
});

test("verdict and cause values are unique", () => {
  assert.equal(new Set(VERDICTS.map((v) => v.value)).size, VERDICTS.length);
  assert.equal(new Set(ALL_CAUSES).size, ALL_CAUSES.length);
});

test("formatClock reads as minutes and seconds", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65.4), "1:05");
  assert.equal(formatClock(-3), "0:00");
});

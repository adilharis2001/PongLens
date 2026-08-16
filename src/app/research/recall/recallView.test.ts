import assert from "node:assert/strict";
import test from "node:test";
import {
  KINDS,
  VERDICTS,
  decodeLane,
  efficiencyGain,
  filterRegions,
  formatClock,
  junkRate,
  kindMeta,
  totals,
} from "./recallView.ts";
import type { RecallMatch, RecallRegion } from "./data.ts";

function region(over: Partial<RecallRegion> = {}): RecallRegion {
  return {
    id: "m:served:001",
    kind: "served",
    t0: 10,
    t1: 15,
    serve: 10.5,
    junk: false,
    cutT0: 5,
    cutT1: 10,
    inCut: 1,
    laneStart: 7,
    lanes: {},
    prod: [],
    taps: [],
    ...over,
  } as RecallRegion;
}

function match(over: Partial<RecallMatch> = {}): RecallMatch {
  return {
    key: "m",
    curated: true,
    rallies: 50,
    recall: 1,
    cards: 100,
    junk: 30,
    prodCards: 100,
    prodJunk: 40,
    servedCards: 60,
    servedJunk: 2,
    fallbackCards: 40,
    fallbackJunk: 28,
    regions: [],
    ...over,
  } as RecallMatch;
}

test("decodeLane expands run-length pairs in order", () => {
  assert.deepEqual(decodeLane("1:2,0:3"), [true, true, false, false, false]);
  assert.deepEqual(decodeLane(""), []);
  assert.deepEqual(decodeLane("1:2,bad,0:1"), [true, true, false]);
});

test("filterRegions narrows to one kind, and 'all' keeps everything", () => {
  const rows = [region({ id: "a" }), region({ id: "b", kind: "no_serve" })];
  assert.equal(
    filterRegions(rows, { kind: "all", onlyUnreviewed: false, done: new Set() })
      .length,
    2,
  );
  assert.deepEqual(
    filterRegions(rows, {
      kind: "no_serve",
      onlyUnreviewed: false,
      done: new Set(),
    }).map((r) => r.id),
    ["b"],
  );
});

test("filterRegions can hide what has been answered", () => {
  const rows = [region({ id: "a" }), region({ id: "b" })];
  assert.deepEqual(
    filterRegions(rows, {
      kind: "all",
      onlyUnreviewed: true,
      done: new Set(["a"]),
    }).map((r) => r.id),
    ["b"],
  );
});

test("junk rate and efficiency gain read the right direction", () => {
  assert.equal(junkRate(100, 30), 30);
  assert.equal(junkRate(0, 0), 0);
  // production 40% junk, new 30% -> ten points better
  assert.equal(efficiencyGain(match()), 10);
  // and negative when the new pipeline shows more rubbish
  assert.equal(efficiencyGain(match({ cards: 100, junk: 50 })), -10);
});

test("uncurated matches contribute nothing to the totals", () => {
  // Before curation every card counts as a rally, so its recall flatters.
  const t = totals([
    match(),
    match({ key: "u", curated: false, rallies: 200, recall: 0.9, cards: 300 }),
  ]);
  assert.equal(t.rallies, 50);
  assert.equal(t.recall, 100);
  assert.equal(t.lost, 0);
  assert.equal(t.curatedMatches, 1);
  assert.equal(t.matches, 2);
  assert.equal(t.cards, 100);
});

test("totals count lost rallies, which is the number that matters", () => {
  const t = totals([match({ rallies: 86, recall: 0.977 })]);
  assert.equal(t.rallies, 86);
  assert.equal(t.kept, 84);
  assert.equal(t.lost, 2);
});

test("totals separate served cards from fallback cards", () => {
  // The whole diagnosis rests on this split, so it must survive summing.
  const t = totals([match(), match({ key: "b" })]);
  assert.equal(t.servedCards, 120);
  assert.equal(t.servedJunk, 4);
  assert.equal(t.fallbackCards, 80);
  assert.equal(t.fallbackJunk, 56);
});

test("every kind has a question and a hint, and unknown kinds fall back", () => {
  for (const k of KINDS) {
    assert.ok(k.question.length > 0, `${k.value} needs a question`);
    assert.ok(k.hint.length > 0, `${k.value} needs a hint`);
    assert.equal(kindMeta(k.value).value, k.value);
  }
  assert.equal(kindMeta("nonsense").value, "no_serve");
});

test("the primary kind is the one the diagnosis points at", () => {
  assert.equal(KINDS[0].value, "no_serve");
});

test("there are four verdicts and they are unique", () => {
  assert.equal(VERDICTS.length, 4);
  assert.equal(new Set(VERDICTS.map((v) => v.value)).size, 4);
});

test("formatClock reads as minutes and seconds", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65.4), "1:05");
  assert.equal(formatClock(-3), "0:00");
});

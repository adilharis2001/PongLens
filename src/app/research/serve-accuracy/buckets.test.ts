import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  endingLabel,
  outcomeTotals,
  reasonSummary,
  type Bucketed,
} from "./buckets.ts";
import type { PointReading } from "./pointReading.ts";
import type { ServeAccuracyRow } from "./serveAccuracyModel.ts";

/**
 * What the page files each point as, and what the tables then say.
 *
 * These assert the RULES of the filing — a point is in exactly one pile, a
 * call on an unscored point is neither right nor wrong, the measurement in
 * a net-death reason does not fragment the table — rather than the numbers
 * a particular corpus happens to produce. A test that pins today's counts
 * fails on every new match and teaches nothing when it does.
 */

const read = (over: Partial<PointReading>): PointReading => ({
  events: [], recovered: [], trust: null, verdicts: [],
  winner: null, rule: null, why: null, refusal: null, ...over,
});
const row = (winner: "user" | "opponent" | null): ServeAccuracyRow =>
  ({ winner } as ServeAccuracyRow);

test("a call that matches the tap is right, the other way is wrong", () => {
  const r = read({ winner: "user", rule: "ball died", why: "put it into the net" });
  assert.equal(classify(row("user"), r).outcome, "right");
  assert.equal(classify(row("opponent"), r).outcome, "wrong");
});

test("a call on a point nobody scored is neither right nor wrong", () => {
  // Counting it either way would flatter or damn the rules for free.
  const r = read({ winner: "user", rule: "off table", why: "missed the table" });
  assert.equal(classify(row(null), r).outcome, "unchecked");
});

test("no call files under its refusal, not under an ending", () => {
  const b = classify(row("user"), read({ refusal: "a landing was missed" }));
  assert.equal(b.outcome, "nocall");
  assert.equal(b.reason, "a landing was missed");
});

test("a refusal with no reason still gets a bucket to sit in", () => {
  // Otherwise the point vanishes from the table but stays in the list, and
  // the two stop adding up.
  assert.equal(classify(row("user"), read({})).reason, "no reason given");
});

test("the net-death distance is dropped, or every point is its own row", () => {
  const a = endingLabel(read({ rule: "ball died", why: "turned 0.42 m from the net and died there" }));
  const b = endingLabel(read({ rule: "ball died", why: "turned 0.07 m from the net and died there" }));
  assert.equal(a, b);
  assert.match(a, /^ball died — turned at the net/);
});

test("two endings that differ only in the rule are different rows", () => {
  assert.notEqual(
    endingLabel(read({ rule: "ball died", why: "never got it back" })),
    endingLabel(read({ rule: "off table", why: "never got it back" })),
  );
});

test("the tables split by whether a call was made, never both", () => {
  const items: Bucketed[] = [
    { outcome: "right", reason: "off table — missed the table" },
    { outcome: "wrong", reason: "off table — missed the table" },
    { outcome: "unchecked", reason: "off table — missed the table" },
    { outcome: "nocall", reason: "a landing was missed" },
    { outcome: "nocall", reason: "a landing was missed" },
  ];
  const { called, refused } = reasonSummary(items);
  assert.equal(called.length, 1);
  assert.equal(refused.length, 1);
  const names = new Set([...called, ...refused].map((c) => c.reason));
  assert.equal(names.size, 2, "a reason must not appear in both tables");
});

test("a reason's row adds up to its own points", () => {
  const items: Bucketed[] = [
    { outcome: "right", reason: "x" }, { outcome: "right", reason: "x" },
    { outcome: "wrong", reason: "x" }, { outcome: "unchecked", reason: "x" },
  ];
  const c = reasonSummary(items).called[0];
  assert.equal(c.points, 4);
  assert.equal(c.right + c.wrong + c.unchecked, c.points);
});

test("the tables are ordered biggest pile first", () => {
  const items: Bucketed[] = [
    { outcome: "right", reason: "small" },
    ...Array.from({ length: 5 }, () => ({ outcome: "right" as const, reason: "big" })),
    ...Array.from({ length: 3 }, () => ({ outcome: "right" as const, reason: "mid" })),
  ];
  assert.deepEqual(
    reasonSummary(items).called.map((c) => c.reason),
    ["big", "mid", "small"],
  );
});

test("the headline strip accounts for every point exactly once", () => {
  const items: Bucketed[] = [
    { outcome: "right", reason: "a" }, { outcome: "wrong", reason: "a" },
    { outcome: "unchecked", reason: "a" }, { outcome: "nocall", reason: "b" },
    { outcome: "nocall", reason: "b" },
  ];
  const t = outcomeTotals(items);
  assert.equal(t.all, 5);
  assert.equal(t.right + t.wrong + t.unchecked + t.nocall, t.all);
});

test("the two tables together hold every point the strip counts", () => {
  // The list under the tables is filtered by clicking a table row, so a
  // point in neither table is unreachable — visible in the count, absent
  // from every filter.
  const items: Bucketed[] = [
    { outcome: "right", reason: "a" }, { outcome: "nocall", reason: "b" },
    { outcome: "unchecked", reason: "c" }, { outcome: "wrong", reason: "a" },
  ];
  const { called, refused } = reasonSummary(items);
  const inTables = [...called, ...refused].reduce((n, c) => n + c.points, 0);
  assert.equal(inTables, outcomeTotals(items).all);
});

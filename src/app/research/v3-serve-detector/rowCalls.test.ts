import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustedStats, callKey, excusedCounts, isProblem, pct, rowKey } from "./rowCalls.ts";

const rows = [
  { kind: "point", verdict: "ok", holds_press: true, prod_t0: 10.04, tap: 15, mine: [{ t0: 9.6 }] },
  { kind: "point", verdict: "missed", holds_press: null, prod_t0: 30.0, tap: 34, mine: [] },
  { kind: "point", verdict: "fused", holds_press: true, prod_t0: 50.0, tap: 55, mine: [{ t0: 40 }] },
  { kind: "point", verdict: "ok", holds_press: false, prod_t0: 70.0, tap: 76, mine: [{ t0: 69.5 }] },
  { kind: "junk", verdict: "junk_deleted", prod_t0: 90.0, mine: [{ t0: 90.2 }] },
  { kind: "junk", verdict: "junk_unknown", prod_t0: null, mine: [{ t0: 120.26 }] },
];
const calls = new Map<string, string>([
  [callKey("m", 30.0), "fine"],
  [callKey("m", 70.0), "fine"],
  [callKey("m", 120.3), "fine"],
  [callKey("m", 50.0), "wrong"],
]);
const callOf = (r: (typeof rows)[number]) => {
  const k = rowKey(r);
  return k == null ? null : calls.get(callKey("m", k));
};

test("a row is keyed by production's card start, else by my card's start, to a tenth", () => {
  assert.equal(rowKey(rows[0]), 10.0);
  assert.equal(rowKey(rows[5]), 120.3);
  assert.equal(rowKey({ kind: "point", prod_t0: null, mine: [] }), null);
  assert.equal(callKey("abc", 120.26), "abc|120.3");
});

test("a problem is any flag, including a clean card that ends before the press", () => {
  assert.equal(isProblem(rows[0]), false);
  assert.equal(isProblem(rows[3]), true);
  assert.equal(isProblem(rows[1]), true);
});

test("excused counts follow the calls, bucket by bucket", () => {
  const ex = excusedCounts(rows, callOf);
  assert.deepEqual(ex, { missed: 1, fused: 0, extra: 0, short: 1, junk: 1, problemPoints: 1 });
});

test("the percentages are shown as flagged and with the excused rows set aside", () => {
  const s = adjustedStats(rows, { cards: 6 }, callOf);
  assert.deepEqual(s.found.raw, [3, 4]);
  assert.deepEqual(s.found.adjusted, [3, 3]);
  assert.deepEqual(s.clean.raw, [2, 4]);
  assert.deepEqual(s.clean.adjusted, [2, 3]);
  assert.deepEqual(s.holds.raw, [3, 4]);
  assert.deepEqual(s.holds.adjusted, [3, 3]);
  assert.deepEqual(s.junk.raw, [2, 6]);
  assert.deepEqual(s.junk.adjusted, [1, 5]);
  assert.equal(pct(s.found.raw), 75);
  assert.equal(pct(s.found.adjusted), 100);
  assert.equal(pct([0, 0]), null);
});

test("no calls at all leaves every number as flagged", () => {
  const s = adjustedStats(rows, { cards: 6 }, () => null);
  assert.deepEqual(s.found.adjusted, s.found.raw);
  assert.deepEqual(s.junk.adjusted, s.junk.raw);
  assert.deepEqual(s.excused, { missed: 0, fused: 0, extra: 0, short: 0, junk: 0, problemPoints: 0 });
});

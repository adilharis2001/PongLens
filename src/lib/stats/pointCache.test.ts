import assert from "node:assert/strict";
import test from "node:test";
import type { Point } from "../types.ts";
import { splitByFreshness } from "./pointCache.ts";

const pts = (n: number) => Array.from({ length: n }, () => ({}) as Point);
const cache = (rows: [string, string, number][]) =>
  new Map(
    rows.map(([id, fingerprint, n]) => [id, { fingerprint, points: pts(n) }])
  );

test("a match nothing has touched is answered from the cache", () => {
  const { fresh, stale } = splitByFreshness(
    ["m1"],
    new Map([["m1", "abc"]]),
    cache([["m1", "abc", 60]])
  );
  assert.deepEqual(stale, []);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0][1].length, 60);
});

test("scoring a point changes the fingerprint, so the match is fetched again", () => {
  const { fresh, stale } = splitByFreshness(
    ["m1"],
    new Map([["m1", "NEW"]]),
    cache([["m1", "abc", 60]])
  );
  assert.deepEqual(stale, ["m1"]);
  assert.deepEqual(fresh, []);
});

test("a match never seen before is fetched", () => {
  const { stale } = splitByFreshness(["m9"], new Map([["m9", "abc"]]), cache([]));
  assert.deepEqual(stale, ["m9"]);
});

test("a match with no live points is a real answer, not a missing one", () => {
  // It is absent from the fingerprint query because the group-by has no
  // rows for it. Cached as the empty string, it must stay cached, or an
  // unscored match would be re-fetched on every single visit for ever.
  const { fresh, stale } = splitByFreshness(
    ["m1"],
    new Map(),
    cache([["m1", "", 0]])
  );
  assert.deepEqual(stale, []);
  assert.equal(fresh.length, 1);
});

test("a match that just lost its last point stops being fresh", () => {
  const { stale } = splitByFreshness(["m1"], new Map(), cache([["m1", "abc", 60]]));
  assert.deepEqual(stale, ["m1"]);
});

test("the split covers every match exactly once", () => {
  const ids = ["a", "b", "c", "d"];
  const { fresh, stale } = splitByFreshness(
    ids,
    new Map([["a", "1"], ["b", "2"], ["c", "3"]]),
    cache([["a", "1", 5], ["b", "STALE", 5], ["d", "", 0]])
  );
  assert.deepEqual(
    [...fresh.map(([id]) => id), ...stale].sort(),
    [...ids].sort()
  );
  assert.deepEqual(fresh.map(([id]) => id), ["a", "d"]);
  assert.deepEqual(stale, ["b", "c"]);
});

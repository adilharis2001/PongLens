import assert from "node:assert/strict";
import test from "node:test";
import { chipTargetIds, type ChipTargetCard } from "./chipTargets.ts";

const ready = (id: string): ChipTargetCard => ({ id, status: "ready" });
const processing = (id: string): ChipTargetCard => ({
  id,
  status: "processing",
});

const base = {
  baseFilteredOwn: [] as ChipTargetCard[],
  baseFilteredShared: [] as ChipTargetCard[],
  cap: 24,
  scoreFilter: "all" as const,
  tokens: [] as string[],
};

test("loads points only for the cards on screen", () => {
  const own = Array.from({ length: 40 }, (_, i) => ready(`m${i}`));
  const ids = chipTargetIds({ ...base, baseFilteredOwn: own, cap: 24 });
  assert.equal(ids?.length, 24);
  assert.equal(ids?.[0], "m0");
  assert.equal(ids?.at(-1), "m23");
});

test("Show more pulls in the newly revealed cards", () => {
  const own = Array.from({ length: 40 }, (_, i) => ready(`m${i}`));
  const first = chipTargetIds({ ...base, baseFilteredOwn: own, cap: 24 });
  const second = chipTargetIds({ ...base, baseFilteredOwn: own, cap: 48 });
  assert.equal(second?.length, 40);
  // Every card that already had a chip keeps being asked for, so pressing
  // Show more can never blank out a score that was on screen a moment ago.
  for (const id of first ?? []) assert.ok(second?.includes(id));
  // ...and the revealed ones are now included.
  assert.ok(second?.includes("m24"));
  assert.ok(second?.includes("m39"));
});

test("a cap beyond the library asks for everything once, no padding", () => {
  const own = [ready("a"), ready("b")];
  assert.deepEqual(chipTargetIds({ ...base, baseFilteredOwn: own, cap: 24 }), [
    "a",
    "b",
  ]);
});

test("unready cards occupy a cap slot but own no points", () => {
  const own = [processing("p0"), ready("m0"), ready("m1")];
  // cap 2 draws [p0, m0]; only m0 has points.
  assert.deepEqual(
    chipTargetIds({ ...base, baseFilteredOwn: own, cap: 2 }),
    ["m0"]
  );
});

test("shared matches get chips too, and are never capped", () => {
  const own = Array.from({ length: 30 }, (_, i) => ready(`m${i}`));
  const shared = [ready("s0"), ready("s1")];
  const ids = chipTargetIds({
    ...base,
    baseFilteredOwn: own,
    baseFilteredShared: shared,
    cap: 24,
  });
  assert.equal(ids?.length, 26);
  assert.ok(ids?.includes("s0"));
  assert.ok(ids?.includes("s1"));
});

test("filtering by score falls back to the whole account", () => {
  const own = [ready("a")];
  assert.equal(
    chipTargetIds({ ...base, baseFilteredOwn: own, scoreFilter: "scored" }),
    null
  );
  assert.equal(
    chipTargetIds({ ...base, baseFilteredOwn: own, scoreFilter: "unscored" }),
    null
  );
});

test("searching for score words falls back to the whole account", () => {
  const own = [ready("a")];
  for (const q of ["scored", "unscored", "unsc", "core", "ored"]) {
    assert.equal(
      chipTargetIds({ ...base, baseFilteredOwn: own, tokens: [q] }),
      null,
      `"${q}" should be treated as score-aware`
    );
  }
});

test("ordinary searches stay scoped", () => {
  const own = Array.from({ length: 40 }, (_, i) => ready(`m${i}`));
  // Short tokens and normal words must not give up the optimisation — the
  // first keystroke of any search would otherwise pull the whole account.
  for (const q of ["s", "un", "vaibhav", "july", "league"]) {
    const ids = chipTargetIds({
      ...base,
      baseFilteredOwn: own,
      tokens: [q],
      cap: 24,
    });
    assert.equal(ids?.length, 24, `"${q}" should stay scoped`);
  }
});

test("one score-aware token in a multi-token query is enough", () => {
  const own = [ready("a")];
  assert.equal(
    chipTargetIds({ ...base, baseFilteredOwn: own, tokens: ["july", "unscored"] }),
    null
  );
});

test("no cards means no fetch, not a fetch for everything", () => {
  assert.deepEqual(chipTargetIds({ ...base }), []);
});

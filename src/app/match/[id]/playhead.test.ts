import assert from "node:assert/strict";
import test from "node:test";
import { nextCutStart, pauseEnd, rallyEnd } from "./playhead.ts";
import type { Point } from "@/lib/types";

const PAD = { pre: 1.2, post: 1.3 };

function pt(over: Partial<Point>): Point {
  return {
    id: "p1",
    t0: 100,
    t1: 104,
    cut_t0: 50,
    tight_start: false,
    tight_end: false,
    ...over,
  } as Point;
}

test("the answer freeze sits a full beat after the rally end", () => {
  const p = pt({});
  const end = rallyEnd(p, PAD);
  assert.ok(end !== null);
  // effective post is 1.3, beat caps at 1.2 -> freeze at end + 1.2
  assert.equal(pauseEnd(p, PAD), end! + 1.2);
});

test("the freeze clamps just before an adjacent rally's padded start", () => {
  const p = pt({});
  const end = rallyEnd(p, PAD)!;
  // next card starts 0.4s after the rally end: freeze stops 0.05 short
  assert.equal(pauseEnd(p, PAD, end + 0.4), end + 0.35);
  // and never lands before the rally end itself, however close the next is
  assert.equal(pauseEnd(p, PAD, end - 1.0), end);
  // a far next card leaves the full beat intact
  assert.equal(pauseEnd(p, PAD, end + 10), end + 1.2);
});

test("a tight_end point keeps its 0.3s sliver", () => {
  const p = pt({ tight_end: true });
  const end = rallyEnd(p, PAD)!;
  assert.equal(pauseEnd(p, PAD), end + 0.3);
});

test("nextCutStart walks to the next visible cut point", () => {
  const a = pt({ id: "a", cut_t0: 10 });
  const b = pt({ id: "b", cut_t0: null });
  const c = pt({ id: "c", cut_t0: 30 });
  assert.equal(nextCutStart([a, b, c], a), 30);
  assert.equal(nextCutStart([a, b, c], c), null);
  assert.equal(nextCutStart([b, c], a), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Point } from "../../../lib/types.ts";
import { pickHighlights, HIGHLIGHT_BUDGETS_S } from "./highlights.ts";
import { clipPad } from "./clipEdit.ts";
import { sortPoints } from "./gameScore.ts";

const PAD = clipPad("normal", null);

let seq = 0;
function pt(over: Partial<Point> = {}): Point {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    idx: seq,
    t0: seq * 100,
    t1: seq * 100 + 5,
    is_let: false,
    starred: false,
    tight_start: false,
    tight_end: false,
    confirmed_winner: null,
    game_end_override: null,
    clip_path: "c",
    ...over,
  } as unknown as Point;
}

test("fills the budget with the longest rallies", () => {
  const points = [
    pt({ t0: 100, t1: 103 }), // 3s rally
    pt({ t0: 200, t1: 212 }), // 12s
    pt({ t0: 300, t1: 308 }), // 8s
  ];
  // Budget sized to hold exactly the 12s and 3s clips: the 12s ranks
  // first, the 8s no longer fits, the 3s fills the tail.
  const padS = PAD.pre + PAD.post;
  const budget = 12 + 3 + 2 * padS + 0.01;
  const { picks, totalS } = pickHighlights(points, PAD, budget);
  assert.deepEqual(
    picks.map((p) => p.t1! - p.t0!),
    [3, 12]
  );
  assert.ok(totalS <= budget);
});

test("picks come back in match order, not rank order", () => {
  const points = [
    pt({ t0: 100, t1: 104 }),
    pt({ t0: 200, t1: 210 }),
    pt({ t0: 300, t1: 305 }),
  ];
  const { picks } = pickHighlights(points, PAD, 120);
  assert.deepEqual(
    picks.map((p) => p.t0),
    [100, 200, 300]
  );
});

test("a starred rally outranks a longer one", () => {
  const points = [
    pt({ t0: 100, t1: 104, starred: true }), // 4s, starred
    pt({ t0: 200, t1: 215 }), // 15s
  ];
  // Budget takes only one of them (each clip ≈ rally + pads).
  const { picks } = pickHighlights(points, PAD, 8);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].starred, true);
});

test("the rally that closed the last game outranks plain length", () => {
  const points = [
    pt({ t0: 100, t1: 111, confirmed_winner: "user" }), // 11s
    // 3s, but pinned as the game's end
    pt({
      t0: 200,
      t1: 203,
      confirmed_winner: "user",
      game_end_override: "end",
    }),
  ];
  const { picks } = pickHighlights(points, PAD, 7);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].t0, 200);
});

test("lets and clipless rallies never make the cut", () => {
  const points = [
    pt({ t0: 100, t1: 120, is_let: true }),
    pt({ t0: 200, t1: 220, clip_path: null }),
    pt({ t0: 300, t1: 303 }),
  ];
  const { picks } = pickHighlights(points, PAD, 120);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].t0, 300);
});

test("nothing eligible means nothing picked", () => {
  const { picks, totalS } = pickHighlights([], PAD, 20);
  assert.equal(picks.length, 0);
  assert.equal(totalS, 0);
});

// The parity fixture is this module's recorded output over a real match
// (the Swift port replays it in ios/Tests). If the rule changes without
// `node --experimental-strip-types scripts/highlights-fixture.ts` being
// re-run, THIS is the test that says so — otherwise the drift would only
// surface as a Swift failure that looks like the port's fault.
test("the committed parity fixture matches this module's output", () => {
  const fx = JSON.parse(
    readFileSync(
      new URL("../../../../ios/Tests/fixtures/highlights-parity.json", import.meta.url),
      "utf8"
    )
  );
  const pad = clipPad(fx.strictness, fx.clip_pads);
  const points = sortPoints(
    fx.points.map((r: Record<string, unknown>) => ({
      id: r.id,
      idx: r.idx,
      t0: r.t0,
      t1: r.t1,
      is_let: r.is_let,
      starred: r.starred,
      tight_start: r.tight_start,
      tight_end: r.tight_end,
      confirmed_winner: r.confirmed_winner,
      game_end_override: r.game_end_override,
      clip_path: r.has_clip ? "c" : null,
    })) as unknown as Point[]
  );
  for (const kind of Object.keys(HIGHLIGHT_BUDGETS_S) as
    (keyof typeof HIGHLIGHT_BUDGETS_S)[]) {
    const { picks, totalS } = pickHighlights(
      points,
      pad,
      HIGHLIGHT_BUDGETS_S[kind]
    );
    assert.deepEqual(
      picks.map((p) => p.id),
      fx.expected[kind].ids,
      `${kind}: fixture is stale — rerun scripts/highlights-fixture.ts`
    );
    assert.equal(totalS, fx.expected[kind].totalS);
  }
});

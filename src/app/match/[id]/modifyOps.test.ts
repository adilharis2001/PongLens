import assert from "node:assert/strict";
import test from "node:test";
import type { Point } from "@/lib/types";
import { runJoinPlan, runSplitPlan } from "./modifyOps.ts";

function point(id: string, t0: number, t1: number, cutT0: number): Point {
  return {
    id,
    match_id: "match-1",
    idx: t0,
    t0,
    t1,
    cut_t0: cutT0,
    tight_start: false,
    tight_end: false,
    edited: false,
    deleted: false,
    confirmed_winner: null,
    confirmed_how: null,
    is_let: false,
    server_override: null,
    game_end_override: null,
    game_winner_override: null,
  } as unknown as Point;
}

test("canonical split sends every marker and outcome in one command", async () => {
  const root = point("root", 100, 110, 10);
  const child = point("child", 103, 110, 14.7);
  const calls: unknown[] = [];
  const mirrors: unknown[] = [];
  const result = await runSplitPlan({
    point: root,
    pad: { pre: 2, post: 2 },
    cutTimes: [15],
    outcomes: ["user", "skip"],
    canonical: async (input) => {
      calls.push(input);
      return {
        kind: "canonical",
        requestId: "split-request",
        points: [{ ...root, t1: 103, confirmed_winner: "user" }, {
          ...child,
          is_let: true,
          confirmed_how: "other",
        }],
      };
    },
    onChild: (parent, patch, created) =>
      mirrors.push({ parent: parent.id, patch, child: created.id }),
  });

  assert.deepEqual(calls, [{
    parent: root,
    splitTimes: [103],
    childCutT0s: [14.7],
    outcomes: ["user", "skip"],
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.outcomesApplied, true);
  assert.equal(result.splitRequestId, "split-request");
  assert.deepEqual(result.created.map((row) => row.id), ["child"]);
  assert.equal(mirrors.length, 1);
});

test("canonical join applies the chosen outcome in the structural command", async () => {
  const first = point("first", 10, 14, 2);
  const second = point("second", 15, 20, 8);
  let received: unknown = null;
  const result = await runJoinPlan({
    point: first,
    points: [first, second],
    count: 1,
    direction: "next",
    outcome: "opponent",
    canonical: async (input) => {
      received = input;
      return {
        kind: "canonical",
        points: [
          { ...first, t1: 20, edited: true, confirmed_winner: "opponent" },
          { ...second, deleted: true },
        ],
      };
    },
  });

  assert.deepEqual(received, {
    pointIds: ["first", "second"],
    outcome: "opponent",
  });
  assert.ok(result);
  assert.equal(result.outcomeApplied, true);
  assert.equal(result.survivor.id, "first");
  assert.deepEqual(result.mergedIds, ["second"]);
});

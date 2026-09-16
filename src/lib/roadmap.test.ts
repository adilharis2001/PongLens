import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustedScore,
  canVote,
  groupRoadmap,
  moveWithinStage,
  nextPosition,
  nextVote,
  scoreLabel,
  shippedLabel,
  type RoadmapItem,
} from "./roadmap.ts";

function item(
  id: string,
  stage: RoadmapItem["stage"],
  position: number,
  shipped_at: string | null = null,
  created_at = "2026-09-01T00:00:00Z"
): RoadmapItem {
  return {
    id,
    title: id,
    description: "",
    stage,
    position,
    shipped_at,
    link: null,
    feedback_item_id: null,
    score: 0,
    created_at,
    updated_at: created_at,
  };
}

test("only unshipped entries take votes", () => {
  assert.equal(canVote("building"), true);
  assert.equal(canVote("planned"), true);
  assert.equal(canVote("shipped"), false);
});

test("the same arrow takes a vote back; the other arrow flips it", () => {
  assert.equal(nextVote(0, 1), 1);
  assert.equal(nextVote(1, 1), 0);
  assert.equal(nextVote(1, -1), -1);
  assert.equal(nextVote(-1, -1), 0);
});

test("the optimistic score moves by the difference between old and new vote", () => {
  assert.equal(adjustedScore(3, 0, 1), 4);
  assert.equal(adjustedScore(3, 1, 0), 2);
  assert.equal(adjustedScore(3, 1, -1), 1);
  assert.equal(adjustedScore(-1, -1, 1), 1);
});

test("scores read as signed counts", () => {
  assert.equal(scoreLabel(3), "+3");
  assert.equal(scoreLabel(0), "0");
  assert.equal(scoreLabel(-2), "-2");
});

test("stages read in the order building, planned, shipped, and empty ones vanish", () => {
  const groups = groupRoadmap([item("p", "planned", 1), item("b", "building", 1)]);
  assert.deepEqual(
    groups.map((g) => g.stage),
    ["building", "planned"]
  );
});

test("within a stage, position wins and age breaks ties", () => {
  const groups = groupRoadmap([
    item("second", "planned", 2),
    item("first", "planned", 1),
    item("older", "planned", 3, null, "2026-08-01T00:00:00Z"),
    item("newer", "planned", 3, null, "2026-08-02T00:00:00Z"),
  ]);
  assert.deepEqual(
    groups[0].items.map((i) => i.id),
    ["first", "second", "older", "newer"]
  );
});

test("shipped reads newest first", () => {
  const groups = groupRoadmap([
    item("aug", "shipped", 1, "2026-08-20"),
    item("sep", "shipped", 2, "2026-09-16"),
  ]);
  assert.deepEqual(
    groups[0].items.map((i) => i.id),
    ["sep", "aug"]
  );
});

test("the shipped label is month and year, never the day", () => {
  assert.equal(shippedLabel("2026-09-16"), "Sep 2026");
  assert.equal(shippedLabel(null), null);
  assert.equal(shippedLabel("nonsense"), null);
});

test("a new entry lands after the last one in its stage", () => {
  const items = [item("a", "planned", 4), item("b", "shipped", 9)];
  assert.equal(nextPosition(items, "planned"), 5);
  assert.equal(nextPosition(items, "building"), 1);
});

test("moving swaps with the neighbour and renumbers the stage", () => {
  const items = [item("a", "planned", 0), item("b", "planned", 0), item("c", "planned", 0)];
  const changed = moveWithinStage(items, "c", "up");
  const byId = Object.fromEntries(changed.map((r) => [r.id, r.position]));
  assert.deepEqual(byId, { a: 1, c: 2, b: 3 });
  assert.deepEqual(moveWithinStage(items, "a", "up"), []);
});

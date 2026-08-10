import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockedIds,
  blockerMap,
  eligibleBlockers,
  newlyStartable,
  pendingBlockers,
  scheduleConflict,
  splitByReadiness,
  waitingLabel,
  wouldCycle,
  type BacklogBlocker,
} from "./blockers.ts";
import type { BacklogItem, BacklogLane } from "./types.ts";

function item(
  id: string,
  lane: BacklogLane = "next",
  target_date: string | null = null,
): BacklogItem {
  return {
    id,
    author_id: "u",
    title: id.toUpperCase(),
    notes: "",
    tag: "",
    lane,
    target_date,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    done_at: lane === "done" ? "2026-02-02T00:00:00Z" : null,
  };
}

const edge = (item_id: string, blocker_id: string): BacklogBlocker => ({
  item_id,
  blocker_id,
});

test("an item waits while any blocker is unfinished", () => {
  const items = [item("a"), item("b")];
  const blocked = blockedIds(items, [edge("a", "b")]);
  assert.ok(blocked.has("a"));
  assert.ok(!blocked.has("b"));
});

// The whole point of using lane='done' as the signal: no second state to
// keep in sync, and ticking the blocker releases the dependent for free.
test("finishing the blocker releases the dependent", () => {
  const edges = [edge("a", "b")];
  assert.ok(blockedIds([item("a"), item("b")], edges).has("a"));
  assert.ok(!blockedIds([item("a"), item("b", "done")], edges).has("a"));
});

test("several blockers all have to finish", () => {
  const edges = [edge("a", "b"), edge("a", "c")];
  assert.ok(blockedIds([item("a"), item("b", "done"), item("c")], edges).has("a"));
  assert.ok(
    !blockedIds([item("a"), item("b", "done"), item("c", "done")], edges).has("a"),
  );
});

test("an edge to a deleted item does not block forever", () => {
  // The row is gone by cascade, but a stale client copy must not strand
  // the dependent as permanently un-startable.
  const blocked = blockedIds([item("a")], [edge("a", "ghost")]);
  assert.ok(!blocked.has("a"));
});

test("pendingBlockers lists only what is still outstanding", () => {
  const byId = new Map([
    ["b", item("b", "done")],
    ["c", item("c")],
  ]);
  const pending = pendingBlockers("a", [edge("a", "b"), edge("a", "c")], byId);
  assert.deepEqual(pending.map((p) => p.id), ["c"]);
});

test("blockerMap groups every edge by the waiting item", () => {
  const map = blockerMap([edge("a", "b"), edge("a", "c"), edge("d", "b")]);
  assert.deepEqual(map.get("a"), ["b", "c"]);
  assert.deepEqual(map.get("d"), ["b"]);
});

test("splitting a lane keeps the incoming order inside each half", () => {
  const lane = [item("a"), item("b"), item("c"), item("d")];
  const { startable, waiting } = splitByReadiness(lane, new Set(["b", "c"]));
  assert.deepEqual(startable.map((i) => i.id), ["a", "d"]);
  assert.deepEqual(waiting.map((i) => i.id), ["b", "c"]);
});

test("an item can never wait on itself", () => {
  assert.equal(wouldCycle([], "a", "a"), true);
});

test("a direct loop is caught", () => {
  assert.equal(wouldCycle([edge("b", "a")], "a", "b"), true);
});

test("a long loop is caught", () => {
  const edges = [edge("b", "c"), edge("c", "d"), edge("d", "a")];
  assert.equal(wouldCycle(edges, "a", "b"), true);
});

test("a shared prerequisite is not a loop", () => {
  // b and c both wait on d. Making a wait on b is perfectly legal.
  const edges = [edge("b", "d"), edge("c", "d")];
  assert.equal(wouldCycle(edges, "a", "b"), false);
});

// A diamond revisits a node by two paths; a walk without a seen-set would
// spin here rather than answer.
test("a diamond terminates instead of looping", () => {
  const edges = [edge("b", "c"), edge("b", "d"), edge("c", "e"), edge("d", "e")];
  assert.equal(wouldCycle(edges, "a", "b"), false);
});

test("the picker hides itself, existing blockers, and loops", () => {
  const items = [item("a"), item("b"), item("c"), item("d")];
  const edges = [edge("a", "b"), edge("c", "a")];
  const options = eligibleBlockers("a", items, edges).map((i) => i.id);
  assert.ok(!options.includes("a"), "itself");
  assert.ok(!options.includes("b"), "already a blocker");
  assert.ok(!options.includes("c"), "would loop");
  assert.deepEqual(options, ["d"]);
});

test("finished work stays offerable as a prerequisite", () => {
  const options = eligibleBlockers("a", [item("a"), item("b", "done")], []);
  assert.deepEqual(options.map((i) => i.id), ["b"]);
});

test("newlyStartable names only what actually just opened up", () => {
  assert.deepEqual(
    newlyStartable(new Set(["a", "b"]), new Set(["b"])),
    ["a"],
  );
  assert.deepEqual(newlyStartable(new Set(["a"]), new Set(["a"])), []);
});

test("the waiting chip names one blocker and counts several", () => {
  assert.equal(waitingLabel([]), null);
  assert.equal(waitingLabel([item("b")]), "after B");
  assert.equal(waitingLabel([item("b"), item("c")]), "after 2 others");
});

test("a plan that cannot happen in the order drawn is a conflict", () => {
  const a = item("a", "next", "2026-02-10");
  // Blocker lands after the item that waits on it.
  assert.equal(scheduleConflict(a, [item("b", "next", "2026-02-12")]), true);
  // Same day is still impossible to sequence.
  assert.equal(scheduleConflict(a, [item("b", "next", "2026-02-10")]), true);
  // Blocker lands first: fine.
  assert.equal(scheduleConflict(a, [item("b", "next", "2026-02-08")]), false);
});

test("undated work is never a scheduling conflict", () => {
  assert.equal(scheduleConflict(item("a"), [item("b", "next", "2026-02-12")]), false);
  assert.equal(
    scheduleConflict(item("a", "next", "2026-02-10"), [item("b")]),
    false,
  );
});

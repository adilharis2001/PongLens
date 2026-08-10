import assert from "node:assert/strict";
import { test } from "node:test";

import type { BacklogBlocker } from "./blockers.ts";
import { dropVerdict, lineGeometry, packLines } from "./dragModel.ts";
import type { BacklogItem, BacklogLane } from "./types.ts";

function item(id: string, lane: BacklogLane = "next"): BacklogItem {
  return {
    id,
    author_id: "u",
    title: id.toUpperCase(),
    notes: "",
    tag: "",
    lane,
    target_date: null,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    done_at: null,
  };
}
const edge = (item_id: string, blocker_id: string): BacklogBlocker => ({
  item_id,
  blocker_id,
});

// "Dragged ON TOP OF means that one comes first" — the direction is the
// thing most likely to get inverted in a refactor, so it is pinned here.
test("dropping A on B makes A wait on B", () => {
  const v = dropVerdict("a", { kind: "item", id: "b" }, [item("a"), item("b")], []);
  assert.deepEqual(v.outcome, { kind: "depend", itemId: "a", blockerId: "b" });
  assert.equal(v.allowed, true);
  assert.equal(v.hint, "Needs this first");
});

test("dropping on a lane moves the item there", () => {
  const v = dropVerdict("a", { kind: "lane", lane: "now" }, [item("a")], []);
  assert.deepEqual(v.outcome, { kind: "lane", lane: "now" });
  assert.equal(v.allowed, true);
});

test("dropping on the lane it is already in does nothing", () => {
  const v = dropVerdict("a", { kind: "lane", lane: "next" }, [item("a")], []);
  assert.equal(v.outcome, null);
  assert.equal(v.allowed, false);
  assert.equal(v.hint, "Already here");
});

test("an item dropped on itself is refused silently", () => {
  const v = dropVerdict("a", { kind: "item", id: "a" }, [item("a")], []);
  assert.equal(v.allowed, false);
  assert.equal(v.hint, "");
});

// Refusals are computed before the finger lifts, so the card can say no
// rather than accept a drop that quietly does nothing.
test("a duplicate dependency is refused, and says why", () => {
  const v = dropVerdict(
    "a",
    { kind: "item", id: "b" },
    [item("a"), item("b")],
    [edge("a", "b")],
  );
  assert.equal(v.allowed, false);
  assert.equal(v.hint, "Already waits on this");
});

test("a drop that would close a loop is refused, and says why", () => {
  const v = dropVerdict(
    "a",
    { kind: "item", id: "b" },
    [item("a"), item("b")],
    [edge("b", "a")],
  );
  assert.equal(v.allowed, false);
  assert.equal(v.hint, "That would make a loop");
});

test("a transitive loop is refused too", () => {
  const items = [item("a"), item("b"), item("c")];
  const edges = [edge("b", "c"), edge("c", "a")];
  const v = dropVerdict("a", { kind: "item", id: "b" }, items, edges);
  assert.equal(v.allowed, false);
});

test("no target means no outcome", () => {
  assert.equal(dropVerdict("a", null, [item("a")], []).outcome, null);
});

test("an unknown dragged item cannot produce an outcome", () => {
  const v = dropVerdict("ghost", { kind: "lane", lane: "now" }, [item("a")], []);
  assert.equal(v.outcome, null);
});

// --- gutter packing -------------------------------------------------------

test("lines that overlap vertically never share a track", () => {
  const columns = packLines([
    { key: "a", top: 0, bottom: 100 },
    { key: "b", top: 50, bottom: 150 },
    { key: "c", top: 60, bottom: 90 },
  ]);
  assert.equal(new Set([columns.get("a"), columns.get("b"), columns.get("c")]).size, 3);
});

test("lines that clear each other reuse the same track", () => {
  const columns = packLines([
    { key: "a", top: 0, bottom: 50 },
    { key: "b", top: 60, bottom: 100 },
  ]);
  assert.equal(columns.get("a"), 0);
  assert.equal(columns.get("b"), 0);
});

test("packing uses the leftmost free track, not an ever-growing one", () => {
  const columns = packLines([
    { key: "a", top: 0, bottom: 100 },
    { key: "b", top: 10, bottom: 40 },
    { key: "c", top: 50, bottom: 90 },
  ]);
  // b and c both fit in track 1 because they do not overlap each other.
  assert.equal(columns.get("a"), 0);
  assert.equal(columns.get("b"), 1);
  assert.equal(columns.get("c"), 1);
});

test("packing an empty set is not an error", () => {
  assert.equal(packLines([]).size, 0);
});

// --- geometry -------------------------------------------------------------

const centers = new Map([
  ["a", { top: 0, bottom: 40, center: 20 }],
  ["b", { top: 60, bottom: 100, center: 80 }],
]);

test("a line runs from the prerequisite to the item that waits", () => {
  const [line] = lineGeometry([edge("a", "b")], centers);
  assert.equal(line.fromY, 80, "starts at the blocker");
  assert.equal(line.toY, 20, "ends at the dependent");
  assert.equal(line.upward, true);
});

// Half a line pointing at nothing reads as a rendering bug, so an edge
// with one end filtered out or collapsed simply is not drawn.
test("an edge with an offscreen end is not drawn", () => {
  assert.equal(lineGeometry([edge("a", "ghost")], centers).length, 0);
  assert.equal(lineGeometry([edge("ghost", "b")], centers).length, 0);
});

test("direction is reported correctly when the blocker sits above", () => {
  const [line] = lineGeometry([edge("b", "a")], centers);
  assert.equal(line.fromY, 20);
  assert.equal(line.toY, 80);
  assert.equal(line.upward, false);
});

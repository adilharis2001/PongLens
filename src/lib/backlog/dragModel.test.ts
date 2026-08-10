import assert from "node:assert/strict";
import { test } from "node:test";

import type { BacklogBlocker } from "./blockers.ts";
import { dropVerdict, lineGeometry, packLines } from "./dragModel.ts";
import type { BacklogItem } from "./types.ts";

// 2026-02-11 is a Wednesday.
const WED = "2026-02-11";

function item(id: string, target_date: string | null = null): BacklogItem {
  return {
    id,
    author_id: "u",
    title: id.toUpperCase(),
    notes: "",
    tag: "",
    lane: "next",
    target_date,
    sort: 0,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    done_at: null,
  };
}
const edge = (item_id: string, blocker_id: string): BacklogBlocker => ({
  item_id,
  blocker_id,
});

test("dropping A on B puts A in B's slot", () => {
  const v = dropVerdict("a", { kind: "item", id: "b" }, [item("a"), item("b")], WED);
  assert.deepEqual(v.outcome, {
    kind: "before",
    section: "someday",
    beforeId: "b",
  });
  assert.equal(v.allowed, true);
});

// Dropping across sections has to do both jobs at once, or a card would
// land in the right place at the wrong priority.
test("dropping on a card in another section moves and positions it", () => {
  const items = [item("a"), item("b", WED)];
  const v = dropVerdict("a", { kind: "item", id: "b" }, items, WED);
  assert.deepEqual(v.outcome, { kind: "before", section: "today", beforeId: "b" });
  assert.equal(v.hint, "Put it here");
});

test("dropping within the same section reads as reordering", () => {
  const v = dropVerdict("a", { kind: "item", id: "b" }, [item("a"), item("b")], WED);
  assert.equal(v.hint, "Move above this");
});

test("dropping on a section appends to it", () => {
  const v = dropVerdict("a", { kind: "section", section: "today" }, [item("a")], WED);
  assert.deepEqual(v.outcome, { kind: "append", section: "today" });
  assert.equal(v.allowed, true);
});

// Appending a card to the end of the section it already sits in would
// silently demote it, which is never what the gesture meant.
test("dropping on its own section is refused rather than demoting it", () => {
  const v = dropVerdict("a", { kind: "section", section: "someday" }, [item("a")], WED);
  assert.equal(v.outcome, null);
  assert.equal(v.hint, "Already here");
});

test("an item dropped on itself is refused silently", () => {
  const v = dropVerdict("a", { kind: "item", id: "a" }, [item("a")], WED);
  assert.equal(v.allowed, false);
  assert.equal(v.hint, "");
});

test("no target, and unknown items, produce no outcome", () => {
  assert.equal(dropVerdict("a", null, [item("a")], WED).outcome, null);
  assert.equal(
    dropVerdict("ghost", { kind: "section", section: "today" }, [item("a")], WED)
      .outcome,
    null,
  );
  assert.equal(
    dropVerdict("a", { kind: "item", id: "ghost" }, [item("a")], WED).outcome,
    null,
  );
});

// --- gutter packing -------------------------------------------------------

test("lines that overlap vertically never share a track", () => {
  const columns = packLines([
    { key: "a", top: 0, bottom: 100 },
    { key: "b", top: 50, bottom: 150 },
    { key: "c", top: 60, bottom: 90 },
  ]);
  assert.equal(
    new Set([columns.get("a"), columns.get("b"), columns.get("c")]).size,
    3,
  );
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

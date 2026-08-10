import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dateForSection,
  droppableSections,
  itemsInSection,
  renumber,
  sectionForDate,
  sortBefore,
  sortForBottom,
  sortForTop,
  visibleSections,
  type SectionKey,
} from "./sections.ts";
import { addDays, endOfWeek } from "./schedule.ts";
import type { BacklogItem } from "./types.ts";

// 2026-02-11 is a Wednesday; its week runs Mon 02-09 → Sun 02-15.
const WED = "2026-02-11";
const SAT = "2026-02-14";
const SUN = "2026-02-15";

function item(over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: Math.random().toString(36).slice(2),
    author_id: "u",
    title: "t",
    notes: "",
    tag: "",
    lane: "next",
    target_date: null,
    sort: 0,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    done_at: null,
    ...over,
  };
}

test("undated work is Someday", () => {
  assert.equal(sectionForDate(null, WED), "someday");
});

test("each near date lands in its own section", () => {
  assert.equal(sectionForDate(WED, WED), "today");
  assert.equal(sectionForDate("2026-02-12", WED), "tomorrow");
  assert.equal(sectionForDate("2026-02-13", WED), "this_week");
  assert.equal(sectionForDate(SUN, WED), "this_week");
  assert.equal(sectionForDate("2026-02-16", WED), "next_week");
  assert.equal(sectionForDate("2026-02-22", WED), "next_week");
});

test("a date that has gone past is Overdue", () => {
  assert.equal(sectionForDate("2026-02-10", WED), "overdue");
});

test("a date beyond next week still has somewhere to be", () => {
  // The UI cannot create these any more, but older rows carry them and a
  // row that belongs to no section would simply vanish from the page.
  assert.equal(sectionForDate("2026-03-30", WED), "later");
});

// Dropping into a section then re-reading it must give the same section
// back, or a card would jump somewhere else the moment it was dropped.
test("every droppable section round-trips through its date", () => {
  for (const today of [WED, SAT, SUN]) {
    for (const section of droppableSections(today)) {
      const date = dateForSection(section.key, today);
      assert.equal(
        sectionForDate(date, today),
        section.key,
        `${section.key} on ${today}`,
      );
    }
  }
});

test("Next week means the start of next week, not the end of it", () => {
  assert.equal(dateForSection("next_week", WED), addDays(endOfWeek(WED), 1));
});

test("This week is not offered once the week has run out", () => {
  // On Saturday, "the rest of this week" is Sunday, which is Tomorrow.
  const keys = droppableSections(SAT).map((s) => s.key);
  assert.ok(!keys.includes("this_week"));
  assert.ok(droppableSections(WED).map((s) => s.key).includes("this_week"));
});

test("Overdue and Later appear only when they hold something", () => {
  const empty = visibleSections([item()], WED).map((s) => s.key);
  assert.ok(!empty.includes("overdue"));
  assert.ok(!empty.includes("later"));

  const withLate = visibleSections(
    [item({ target_date: "2026-02-01" })],
    WED,
  ).map((s) => s.key);
  assert.ok(withLate.includes("overdue"));
});

test("the everyday sections are always there to drop into", () => {
  const keys = visibleSections([], WED).map((s) => s.key);
  for (const key of ["today", "tomorrow", "this_week", "next_week", "someday"]) {
    assert.ok(keys.includes(key as SectionKey), key);
  }
});

// Every row must appear exactly once, or work disappears silently.
test("every item lands in exactly one visible section", () => {
  const items = [
    item({ target_date: null }),
    item({ target_date: "2026-02-01" }),
    item({ target_date: WED }),
    item({ target_date: "2026-02-12" }),
    item({ target_date: SUN }),
    item({ target_date: "2026-02-18" }),
    item({ target_date: "2026-06-01" }),
  ];
  const sections = visibleSections(items, WED);
  const seen = sections.flatMap((s) => itemsInSection(items, s.key, WED));
  assert.equal(seen.length, items.length);
  assert.equal(new Set(seen.map((i) => i.id)).size, items.length);
});

test("a section reads in sort order, lowest first", () => {
  const items = [
    item({ id: "c", sort: 3 }),
    item({ id: "a", sort: 1 }),
    item({ id: "b", sort: 2 }),
  ];
  assert.deepEqual(
    itemsInSection(items, "someday", WED).map((i) => i.id),
    ["a", "b", "c"],
  );
});

// --- sort keys ------------------------------------------------------------

test("a new capture goes above everything already there", () => {
  const existing = [item({ sort: 0 }), item({ sort: 1 })];
  assert.ok(sortForTop(existing) < 0);
  assert.equal(sortForTop([]), 0);
});

test("dropping into a section appends to the end", () => {
  const existing = [item({ sort: 0 }), item({ sort: 5 })];
  assert.ok(sortForBottom(existing) > 5);
  assert.equal(sortForBottom([]), 0);
});

test("dropping on a card takes its slot and pushes it down", () => {
  const items = [
    item({ id: "a", sort: 0 }),
    item({ id: "b", sort: 1 }),
    item({ id: "c", sort: 2 }),
  ];
  const sort = sortBefore(items, "c");
  assert.ok(sort !== null && sort > 1 && sort < 2, "between b and c");
});

test("dropping on the top card goes above it", () => {
  const items = [item({ id: "a", sort: 0 }), item({ id: "b", sort: 1 })];
  const sort = sortBefore(items, "a");
  assert.ok(sort !== null && sort < 0);
});

test("an unknown target yields no sort rather than a wrong one", () => {
  assert.equal(sortBefore([item({ id: "a", sort: 0 })], "ghost"), null);
});

// Halving the same gap forever runs out of float; the caller renumbers.
test("a collapsed gap reports itself instead of silently colliding", () => {
  const items = [
    item({ id: "a", sort: 1 }),
    item({ id: "b", sort: 1 + 1e-12 }),
  ];
  assert.equal(sortBefore(items, "b"), null);
});

test("renumbering restores whole numbers in the same order", () => {
  const items = [
    item({ id: "a", sort: 0.4 }),
    item({ id: "b", sort: 0.400001 }),
    item({ id: "c", sort: 9 }),
  ];
  assert.deepEqual(renumber(items), [
    { id: "a", sort: 0 },
    { id: "b", sort: 1 },
    { id: "c", sort: 2 },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  nextRecollectDue,
  selectDueRecollectItems,
} from "./schedule.ts";
import type { DueRecollectItem } from "./types.ts";

const now = new Date("2026-07-30T12:00:00.000Z");

function daysUntil(value: string): number {
  return (new Date(value).getTime() - now.getTime()) / 86_400_000;
}

test("Recollect reveal intervals widen to sixty days", () => {
  assert.equal(daysUntil(nextRecollectDue(0, now).nextDueAt), 3);
  assert.equal(daysUntil(nextRecollectDue(1, now).nextDueAt), 7);
  assert.equal(daysUntil(nextRecollectDue(2, now).nextDueAt), 14);
  assert.equal(daysUntil(nextRecollectDue(3, now).nextDueAt), 30);
  assert.equal(daysUntil(nextRecollectDue(4, now).nextDueAt), 60);
  assert.equal(daysUntil(nextRecollectDue(9, now).nextDueAt), 60);
});

function due(
  id: string,
  kind: "lesson" | "practice",
  topicKey: string,
  overrides: Partial<DueRecollectItem> = {},
): DueRecollectItem {
  return {
    id,
    kind,
    topicKey,
    sourceFrequency: 1,
    priority: 0.8,
    nextDueAt: "2026-07-29T12:00:00.000Z",
    paused: false,
    ...overrides,
  };
}

test("daily selection prefers two lessons and one practice without filling", () => {
  const selected = selectDueRecollectItems(
    [
      due("lesson-1", "lesson", "serve"),
      due("lesson-2", "lesson", "footwork"),
      due("lesson-3", "lesson", "backhand"),
      due("practice-1", "practice", "recovery"),
    ],
    now,
  );
  assert.equal(selected.length, 3);
  assert.equal(selected.filter((item) => item.kind === "lesson").length, 2);
  assert.equal(selected.filter((item) => item.kind === "practice").length, 1);
  assert.deepEqual(
    selectDueRecollectItems([due("one", "lesson", "serve")], now).map(
      (item) => item.id,
    ),
    ["one"],
  );
});

test("selection excludes future and paused reminders and diversifies topics", () => {
  const selected = selectDueRecollectItems(
    [
      due("repeat-high", "lesson", "serve", { sourceFrequency: 3 }),
      due("repeat-low", "lesson", "serve"),
      due("different", "lesson", "footwork"),
      due("paused", "practice", "mental", { paused: true }),
      due("future", "practice", "recovery", {
        nextDueAt: "2026-08-01T12:00:00.000Z",
      }),
    ],
    now,
  );
  assert.deepEqual(
    selected.map((item) => item.id),
    ["repeat-high", "different", "repeat-low"],
  );
});

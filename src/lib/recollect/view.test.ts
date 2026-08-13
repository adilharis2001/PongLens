import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicQueue } from "./view.ts";

const TOPICS = [
  { id: "t-backhand", topic_key: "backhand", last_reviewed_at: "2026-08-10T00:00:00.000Z" },
  { id: "t-serve", topic_key: "serve", last_reviewed_at: null },
  { id: "t-footwork", topic_key: "footwork", last_reviewed_at: "2026-08-01T00:00:00.000Z" },
];

const POINTS = [
  { topic_id: "t-backhand", lesson_id: "l-1" },
  { topic_id: "t-backhand", lesson_id: "l-2" },
  { topic_id: "t-backhand", lesson_id: "l-2" },
  { topic_id: "t-serve", lesson_id: "l-1" },
  { topic_id: "t-footwork", lesson_id: "l-3" },
];

test("the queue puts the longest-unopened topic first", () => {
  const queue = buildTopicQueue(TOPICS, POINTS);
  // Never opened comes before opened, oldest opened before newest.
  assert.deepEqual(
    queue.map((topic) => topic.key),
    ["serve", "footwork", "backhand"],
  );
});

test("a topic row carries its size and where it came from", () => {
  const [, , backhand] = buildTopicQueue(TOPICS, POINTS);
  assert.equal(backhand.label, "Backhand");
  assert.equal(backhand.pointCount, 3);
  // Two entries, not three points.
  assert.equal(backhand.lessonCount, 2);
});

test("a topic with no active points drops off the list", () => {
  const queue = buildTopicQueue(
    TOPICS,
    POINTS.filter((point) => point.topic_id !== "t-serve"),
  );
  assert.equal(
    queue.some((topic) => topic.key === "serve"),
    false,
  );
});

test("topic keys resolve to the labels a player reads", () => {
  const [first] = buildTopicQueue(
    [{ id: "t", topic_key: "footwork", last_reviewed_at: null }],
    [{ topic_id: "t", lesson_id: "l" }],
  );
  assert.equal(first.label, "Footwork & positioning");
});

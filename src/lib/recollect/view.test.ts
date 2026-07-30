import assert from "node:assert/strict";
import test from "node:test";
import { buildRecollectCards } from "./view.ts";

test("Recollect fronts contain a source but never the private cue", () => {
  const cards = buildRecollectCards(
    [
      {
        id: "item-1",
        question: "Where should your racket recover?",
        cue: "Keep it high in front.",
        topic_key: "racket recovery",
      },
    ],
    [
      {
        item_id: "item-1",
        lesson_id: "lesson-1",
        lesson: {
          id: "lesson-1",
          kind: "lesson",
          created_at: "2026-07-20T10:00:00.000Z",
          takeaways: { title: "Backhand recovery" },
        },
      },
    ],
  );

  assert.deepEqual(cards, [
    {
      id: "item-1",
      question: "Where should your racket recover?",
      topic: "Racket recovery",
      source: {
        lessonId: "lesson-1",
        kind: "lesson",
        createdAt: "2026-07-20T10:00:00.000Z",
        title: "Backhand recovery",
      },
    },
  ]);
  assert.equal(JSON.stringify(cards).includes("Keep it high"), false);
});

test("Recollect uses the newest source for a repeated reminder", () => {
  const [card] = buildRecollectCards(
    [
      {
        id: "item-1",
        question: "What is your receive cue?",
        cue: "Stay low.",
        topic_key: "serve_receive",
      },
    ],
    [
      {
        item_id: "item-1",
        lesson_id: "old",
        lesson: {
          id: "old",
          kind: "practice",
          created_at: "2026-07-01T10:00:00.000Z",
          takeaways: null,
        },
      },
      {
        item_id: "item-1",
        lesson_id: "new",
        lesson: {
          id: "new",
          kind: "lesson",
          created_at: "2026-07-15T10:00:00.000Z",
          takeaways: { title: "Serve receive" },
        },
      },
    ],
  );

  assert.equal(card.source.lessonId, "new");
  assert.equal(card.source.title, "Serve receive");
});

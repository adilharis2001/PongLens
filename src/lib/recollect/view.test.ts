import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRecollectCards, loadRecollectHistory } from "./view.ts";

/** Any builder call chains; awaiting the chain yields the table's result. */
function query(result: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: unknown) => void) => resolve(result);
        }
        if (property === "maybeSingle") return async () => result;
        return () => proxy;
      },
    },
  );
  return proxy;
}

function fakeAdmin(tables: Record<string, unknown>) {
  return {
    from: (table: string) => query(tables[table] ?? { data: [], error: null }),
  } as unknown as SupabaseClient;
}

const HISTORY_TABLES = {
  recollect_preferences: { data: { enabled: true }, error: null },
  recollect_items: {
    data: [
      {
        id: "item-1",
        question: "What should your racket do after the loop?",
        cue: "Recover high in front.",
        topic_key: "racket-recovery",
        next_due_at: "2026-08-05T10:00:00.000Z",
        last_revealed_at: "2026-08-02T10:00:00.000Z",
        schedule_step: 2,
        focus_point_id: null,
      },
    ],
    error: null,
  },
  recollect_item_sources: {
    data: [{ item_id: "item-1", lesson_id: "lesson-1" }],
    error: null,
  },
  lessons: {
    data: [
      {
        id: "lesson-1",
        kind: "lesson",
        created_at: "2026-07-20T10:00:00.000Z",
        takeaways: { title: "Backhand recovery" },
      },
    ],
    error: null,
  },
};

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

test("history carries the answer, its source, and when it returns", async () => {
  const page = await loadRecollectHistory(
    "user-1",
    { limit: 20 },
    fakeAdmin(HISTORY_TABLES),
    new Date("2026-08-03T10:00:00.000Z"),
  );

  assert.deepEqual(page, {
    entries: [
      {
        id: "item-1",
        question: "What should your racket do after the loop?",
        cue: "Recover high in front.",
        topic: "Racket recovery",
        source: {
          lessonId: "lesson-1",
          kind: "lesson",
          createdAt: "2026-07-20T10:00:00.000Z",
          title: "Backhand recovery",
        },
        lastRevealedAt: "2026-08-02T10:00:00.000Z",
        nextDueAt: "2026-08-05T10:00:00.000Z",
        reviewCount: 2,
        inWorkingOn: false,
      },
    ],
    hasMore: false,
  });
});

test("history reports more pages without returning the extra row", async () => {
  const rows = HISTORY_TABLES.recollect_items.data;
  const page = await loadRecollectHistory(
    "user-1",
    { limit: 1 },
    fakeAdmin({
      ...HISTORY_TABLES,
      // The loader asks for one row beyond the page to detect a next page.
      recollect_items: {
        data: [rows[0], { ...rows[0], id: "item-2" }],
        error: null,
      },
    }),
    new Date("2026-08-03T10:00:00.000Z"),
  );

  assert.equal(page.entries.length, 1);
  assert.equal(page.hasMore, true);
});

test("an opted-out account has no readable history", async () => {
  const page = await loadRecollectHistory(
    "user-1",
    {},
    fakeAdmin({
      ...HISTORY_TABLES,
      recollect_preferences: { data: { enabled: false }, error: null },
    }),
  );
  assert.deepEqual(page, { entries: [], hasMore: false });
});

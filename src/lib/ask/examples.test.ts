import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteFeedRow } from "../types.ts";
import { askExamples, topOpponentFromNotes } from "./examples.ts";

const ME = "me-uuid";
const THEM = "student-uuid";

function note(over: Partial<NoteFeedRow> = {}): NoteFeedRow {
  return {
    id: "n",
    match_id: "m",
    point_id: null,
    author_id: ME,
    body: "note",
    audio_path: null,
    image_path: null,
    created_at: "2026-08-01T00:00:00.000Z",
    author_name: "You",
    match_owner_id: ME,
    opponent_name: "Vinay",
    venue: null,
    played_at: "2026-08-01T00:00:00.000Z",
    user_side: "near",
    player_near_name: null,
    player_far_name: null,
    ...over,
  };
}

test("a coach's students' opponents never reach their own suggestions", () => {
  // The shipped bug: note_feed is has_match_access scoped, so six notes on
  // a student's match against Alex outvoted the two on my own matches, and
  // the suggestion named someone Ask could not see.
  const rows = [
    ...Array.from({ length: 6 }, () =>
      note({ match_owner_id: THEM, opponent_name: "Alex" }),
    ),
    note({ match_owner_id: ME, opponent_name: "Vinay" }),
    note({ match_owner_id: ME, opponent_name: "Vinay" }),
  ];
  assert.equal(topOpponentFromNotes(rows, ME), "Vinay");
});

test("with only other people's matches, no name is offered at all", () => {
  const rows = Array.from({ length: 5 }, () =>
    note({ match_owner_id: THEM, opponent_name: "Alex" }),
  );
  assert.equal(topOpponentFromNotes(rows, ME), null);
  const examples = askExamples({
    coachName: null,
    opponentName: topOpponentFromNotes(rows, ME),
  });
  assert.ok(!examples.some((q) => q.includes("Alex")));
  assert.equal(examples.length, 2);
});

test("the most-written-about of my own opponents wins", () => {
  const rows = [
    note({ opponent_name: "Chris" }),
    note({ opponent_name: "Chris" }),
    note({ opponent_name: "Chris" }),
    note({ opponent_name: "Vinay" }),
  ];
  assert.equal(topOpponentFromNotes(rows, ME), "Chris");
});

test("an opponent question asks about writing, not about a record", () => {
  // A name found in a note guarantees notes exist; it does not guarantee
  // the match was ever scored, so the question must not imply a record.
  const [, opponentQ] = askExamples({
    coachName: "Jonathan",
    opponentName: "Chris",
  });
  assert.match(opponentQ, /written about playing Chris/);
  assert.doesNotMatch(opponentQ, /How do I do against/);
});

test("no names available still yields usable questions", () => {
  const examples = askExamples({ coachName: null, opponentName: null });
  assert.equal(examples.length, 2);
  for (const q of examples) assert.ok(q.endsWith("?"));
});

test("never more than three, and never empty", () => {
  const examples = askExamples({ coachName: "Jonathan", opponentName: "Chris" });
  assert.equal(examples.length, 3);
  assert.ok(examples.every((q) => q.trim().length > 0));
});

test("notes with no opponent name are skipped rather than counted", () => {
  const rows = [
    note({ opponent_name: null }),
    note({ opponent_name: "   " }),
    note({ opponent_name: "Sam" }),
  ];
  assert.equal(topOpponentFromNotes(rows, ME), "Sam");
});

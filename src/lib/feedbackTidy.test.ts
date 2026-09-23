import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PARTS, parseTidy } from "./feedbackTidy.ts";

const part = (title: string, type = "idea") => ({ title, summary: `${title} summary.`, type });

test("a split message keeps every part in order", () => {
  const t = parseTidy(
    {
      posts: [part("Progress bar while scoring"), part("Undo a deleted point", "improvement"), part("Find where the score went wrong")],
      visibility: "board",
      questions: ["ignored when split?"],
      similar_item_id: "a",
    },
    ["a"],
  );
  assert.ok(t);
  assert.deepEqual(t.parts.map((p) => p.title), [
    "Progress bar while scoring",
    "Undo a deleted point",
    "Find where the score went wrong",
  ]);
  assert.equal(t.parts[1].type, "improvement");
  // A question or a duplicate pointer only makes sense for one post.
  assert.deepEqual(t.questions, []);
  assert.equal(t.similarItemId, null);
});

test("a single post keeps its question and a known duplicate", () => {
  const t = parseTidy(
    { posts: [part("Nothing was removed", "bug")], visibility: "board", questions: [" Which screen? ", ""], similar_item_id: "a" },
    ["a", "b"],
  );
  assert.deepEqual(t?.questions, ["Which screen?"]);
  assert.equal(t?.similarItemId, "a");
});

test("a duplicate id we never offered is ignored", () => {
  const t = parseTidy({ posts: [part("x")], visibility: "board", questions: [], similar_item_id: "zzz" }, ["a"]);
  assert.equal(t?.similarItemId, null);
});

test("titles lose a trailing stop and whitespace collapses", () => {
  const t = parseTidy({ posts: [{ title: "  Undo   a point. ", summary: "One\nsentence.", type: "odd" }], visibility: "x" }, []);
  assert.equal(t?.parts[0].title, "Undo a point");
  assert.equal(t?.parts[0].summary, "One sentence.");
  assert.equal(t?.parts[0].type, "idea");
  assert.equal(t?.visibility, "board");
});

test("parts without a title are dropped; none left means leave the post alone", () => {
  assert.equal(parseTidy({ posts: [{ title: " ", summary: "s", type: "bug" }] }, []), null);
  assert.equal(parseTidy(null, []), null);
  assert.equal(parseTidy({ posts: "no" }, []), null);
});

test("never more parts than the database will write", () => {
  const posts = Array.from({ length: 9 }, (_, i) => part(`Post ${i}`));
  assert.equal(parseTidy({ posts, visibility: "board" }, [])?.parts.length, MAX_PARTS);
});

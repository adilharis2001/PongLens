import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("Journal exposes a mobile-safe Recollect tab and source anchors", () => {
  const feed = read("../../app/journal/NotesFeed.tsx");
  const card = read("../../app/journal/LessonCard.tsx");
  assert.match(feed, /"recollect"/);
  assert.match(feed, /overflow-x-auto/);
  assert.match(feed, /<Recollect/);
  assert.match(card, /journal-entry-/);
});

test("Working On survives the section switch, Recollect included", () => {
  const feed = read("../../app/journal/NotesFeed.tsx");
  // Adding a point is the one path that changes the list without the player
  // typing, so the panel has to be on screen when it happens.
  assert.match(feed, /\{!activeTag && \(\s*<WorkingOn/);
  assert.match(feed, /onFocusPointAdded=\{acceptRecollectFocus\}/);
});

test("Recollect shows topics and reveals points, with no question anywhere", () => {
  const view = read("../../app/journal/Recollect.tsx");
  assert.match(view, /Reveal/);
  assert.match(view, /topicMeta/);
  assert.match(view, /Add to Working On/);
  assert.match(view, /Not useful/);
  assert.doesNotMatch(view, /<input|<textarea/);
  assert.doesNotMatch(view, /\bAI\b|artificial intelligence/i);
  // The old card asked a generated question and hid one answer behind it.
  assert.doesNotMatch(view, /question|Tap to reveal|Seen before/i);
});

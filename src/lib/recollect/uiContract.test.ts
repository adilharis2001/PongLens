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
  // Adding a revealed cue is the one path that changes the list without the
  // player typing, so the panel has to be on screen when it happens.
  assert.match(feed, /\{!activeTag && \(\s*<WorkingOn/);
  assert.match(feed, /onFocusPointAdded=\{acceptRecollectFocus\}/);
});

test("Recollect reveals without typed answers and adapts its add label", () => {
  const view = read("../../app/journal/Recollect.tsx");
  assert.match(view, /Tap to reveal/);
  assert.match(view, /Add to Working On/);
  assert.match(view, /sm:hidden/);
  assert.match(view, /Not useful/);
  assert.doesNotMatch(view, /<input|<textarea/);
  assert.doesNotMatch(view, /\bAI\b|artificial intelligence/i);
});

test("past reminders are readable without re-reviewing them", () => {
  const view = read("../../app/journal/Recollect.tsx");
  assert.match(view, /Seen before/);
  assert.match(view, /\/api\/recollect\/history/);
  assert.match(view, /aria-expanded=\{historyOpen\}/);
  // Opening the history must never post a reveal, which is what moves the
  // schedule on.
  assert.doesNotMatch(view, /loadHistory[\s\S]{0,200}action: "reveal"/);
});

test("Account contains one global Recollect switch", () => {
  const page = read("../../app/account/page.tsx");
  const setting = read("../../app/account/RecollectSetting.tsx");
  assert.match(page, /<RecollectSetting/);
  assert.match(setting, /role="switch"/);
  assert.match(setting, /\/api\/recollect\/settings/);
});

test("a failed drain surfaces, and Try again restarts it", () => {
  const view = read("../../app/journal/Recollect.tsx");
  // Nothing but this loop processes Recollect jobs, so every way out of it
  // has to end somewhere the user can act. It used to `break` on a non-ok
  // response and let a rejected fetch escape an un-caught async IIFE —
  // both landed on "Preparing reminders…" forever.
  assert.match(view, /if \(!response\.ok\) throw new Error/);
  assert.match(view, /catch \{\s*if \(!cancelled\) setError\(true\);/);
  // Try again has to change something the drain effect depends on: the
  // view's `processing` is still true after a failure, so re-reading it
  // alone never re-runs the effect.
  assert.match(view, /setAttempt\(\(n\) => n \+ 1\)/);
  assert.match(view, /\}, \[load, view\?\.processing, attempt\]\)/);
  assert.match(view, /onClick=\{retry\}/);
});

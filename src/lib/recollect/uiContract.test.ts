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

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entryTitle,
  matchLabel,
  studentSummary,
  workspaceKey,
} from "./entryView.ts";

test("entryTitle prefers the distilled title", () => {
  assert.equal(
    entryTitle("long words here", { title: "Backhand opening", themes: [] }),
    "Backhand opening",
  );
});

test("entryTitle falls back to the opening words, collapsed and capped", () => {
  const words = "Work on   the backhand\nopening. " + "x".repeat(100);
  const t = entryTitle(words, null);
  assert.ok(t.startsWith("Work on the backhand opening. "));
  assert.equal(t.length, 73); // 72 chars + ellipsis
  assert.ok(t.endsWith("…"));
});

test("entryTitle names an empty entry", () => {
  assert.equal(entryTitle("   ", { title: "  " }), "Entry");
});

test("studentSummary reads the roster row's state", () => {
  assert.equal(studentSummary(false, 3, 3), "Not on PongLens yet");
  assert.equal(studentSummary(true, 0, 0), "On PongLens");
  assert.equal(studentSummary(true, 1, 1), "1 match · 1 entry");
  assert.equal(studentSummary(true, 2, 3), "2 matches · 3 entries");
  assert.equal(studentSummary(true, 0, 2), "2 entries");
});

test("matchLabel prefers opponent, then file name, then the kind", () => {
  assert.equal(
    matchLabel({ opponent_name: "Chen", original_name: "a.mp4", match_type: null }),
    "vs Chen",
  );
  assert.equal(
    matchLabel({ opponent_name: null, original_name: "club.mp4", match_type: null }),
    "club.mp4",
  );
  assert.equal(
    matchLabel({ opponent_name: null, original_name: null, match_type: "practice" }),
    "Practice",
  );
  assert.equal(
    matchLabel({ opponent_name: null, original_name: null, match_type: null }),
    "Match",
  );
});

test("workspaceKey is scoped by user", () => {
  assert.notEqual(workspaceKey("a"), workspaceKey("b"));
  assert.equal(workspaceKey("u1"), "pl-workspace:u1");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeTag,
  OPEN_LANES,
  STARTER_TAGS,
  suggestedTags,
  type BacklogItem,
} from "./types.ts";

function item(tag: string): BacklogItem {
  return {
    id: Math.random().toString(36).slice(2),
    author_id: "u",
    title: "t",
    notes: "",
    tag,
    lane: "next",
    target_date: null,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    done_at: null,
  };
}

test("done is not an open lane", () => {
  assert.deepEqual(OPEN_LANES, ["now", "next", "later"]);
});

test("a fresh list still offers somewhere to start", () => {
  assert.deepEqual(suggestedTags([]), [...STARTER_TAGS]);
});

test("tags you actually use lead, most-used first", () => {
  const suggestions = suggestedTags([
    item("marketing"),
    item("marketing"),
    item("outreach"),
    item(""),
  ]);
  assert.equal(suggestions[0], "marketing");
  assert.equal(suggestions[1], "outreach");
});

test("a starter already in use is not offered twice", () => {
  const suggestions = suggestedTags([item("dev"), item("dev")]);
  assert.equal(suggestions.filter((t) => t === "dev").length, 1);
});

test("suggestions stay within the limit", () => {
  const many = Array.from({ length: 30 }, (_, i) => item(`tag-${i}`));
  assert.equal(suggestedTags(many).length, 10);
});

test("typed tags are trimmed, collapsed and capped to the column", () => {
  assert.equal(normalizeTag("  club   outreach  "), "club outreach");
  assert.equal(normalizeTag("x".repeat(60)).length, 40);
  assert.equal(normalizeTag("   "), "");
});

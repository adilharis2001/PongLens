import assert from "node:assert/strict";
import { test } from "node:test";

import { tagTone } from "./tagTone.ts";
import { STARTER_TAGS } from "./types.ts";

test("the starter tags are all visually distinct", () => {
  const chips = STARTER_TAGS.map((t) => tagTone(t).chip);
  assert.equal(new Set(chips).size, STARTER_TAGS.length);
});

test("untagged reads as untagged, not as a colour", () => {
  assert.equal(tagTone("").chip, tagTone("   ").chip);
  assert.notEqual(tagTone("").chip, tagTone("dev").chip);
});

test("a tag's colour is stable and case-insensitive", () => {
  assert.equal(tagTone("Outreach").chip, tagTone("outreach").chip);
  assert.equal(tagTone(" outreach ").chip, tagTone("outreach").chip);
});

test("a tag invented later still gets a real colour", () => {
  const tone = tagTone("club-partnerships");
  assert.ok(tone.chip.length > 0);
  assert.notEqual(tone.chip, tagTone("").chip);
});

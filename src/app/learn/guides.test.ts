import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  GROUPS,
  guideSearchText,
  guides,
  type Guide,
} from "./guides.ts";

test("guide slugs and relationships are valid", () => {
  const slugs = guides.map((guide) => guide.slug);
  assert.equal(new Set(slugs).size, slugs.length);

  const known = new Set(slugs);
  for (const guide of guides) {
    assert.ok(
      GROUPS.includes(guide.group as (typeof GROUPS)[number]),
      `${guide.slug} has an unknown group`
    );
    for (const related of guide.related ?? []) {
      assert.ok(known.has(related), `${guide.slug} links to missing ${related}`);
    }
  }
});

test("every guide starts with quick steps", () => {
  for (const guide of guides) {
    assert.ok(
      guide.sections[0]?.steps?.length,
      `${guide.slug} has no quick steps`
    );
  }
});

test("every guide image exists under public", () => {
  for (const guide of guides) {
    for (const section of guide.sections) {
      for (const image of section.images ?? []) {
        assert.ok(
          existsSync(join(process.cwd(), "public", image.src)),
          `${guide.slug} references missing ${image.src}`
        );
      }
    }
  }
});

test("quick steps are searchable", () => {
  const guide: Guide = {
    slug: "search-test",
    title: "Search test",
    summary: "A test guide.",
    group: "Get started",
    sections: [{ steps: ["Choose the unmistakable control."] }],
  };

  assert.match(guideSearchText(guide), /unmistakable/);
});

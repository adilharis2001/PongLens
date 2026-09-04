import assert from "node:assert/strict";
import { test } from "node:test";
import {
  guideBySlug,
  guideBySlugForPlatform,
  guideSearchText,
  guideSnippet,
  tutorialTotalSeconds,
  validateLearnCatalog,
  visibleChapters,
  visibleGuides,
  visibleGroups,
  visibleRelatedGuides,
} from "./catalog.ts";
import type { Guide, TutorialChapter } from "./catalogTypes.ts";

function guide(overrides: Partial<Guide> = {}): Guide {
  return {
    slug: "guide-a",
    title: "Guide A",
    summary: "A guide for tests.",
    group: "Get started",
    visibility: { audiences: ["player"], platforms: ["web"] },
    sections: [{ heading: "Quick steps", steps: ["Do the thing."] }],
    ...overrides,
  };
}

function chapter(overrides: Partial<TutorialChapter> = {}): TutorialChapter {
  return {
    slug: "chapter-a",
    title: "Chapter A",
    blurb: "A chapter for tests.",
    seconds: 30,
    guide: "guide-a",
    visibility: { audiences: ["player"], platforms: ["web"] },
    mediaKey: "tutorial/player/chapter-a.mp4",
    ...overrides,
  };
}

test("catalog selectors filter guides, sections, groups, and related links", () => {
  const coachIosGuides = visibleGuides("coach", "ios");
  assert.equal(
    coachIosGuides.some((item) => guideSearchText(item).includes("paid review")),
    false,
  );
  assert.ok(coachIosGuides.every((item) => item.visibility.audiences.includes("coach")));
  assert.ok(visibleGroups("coach", "ios").length > 0);

  const playerGuide = visibleGuides("player", "web")[0];
  assert.ok(playerGuide);
  assert.deepEqual(
    visibleRelatedGuides(playerGuide, "player", "web").map((item) => item.slug),
    [],
  );
  assert.equal(
    playerGuide.sections.some((section) => section.heading === "On iPhone"),
    false,
  );
  assert.equal(
    visibleGuides("player", "ios")[0]?.sections.some(
      (section) => section.heading === "On iPhone",
    ),
    true,
  );
});

test("catalog selectors find only visible slugs and derive tutorial totals", () => {
  const playerGuide = visibleGuides("player", "web")[0];
  assert.ok(playerGuide);
  assert.equal(guideBySlug(playerGuide.slug, "player", "web")?.slug, playerGuide.slug);
  assert.equal(guideBySlug(playerGuide.slug, "coach", "web"), undefined);
  assert.equal(guideBySlugForPlatform(playerGuide.slug, "web")?.slug, playerGuide.slug);
  assert.equal(
    tutorialTotalSeconds("player", "web"),
    visibleChapters("player", "web").reduce((total, item) => total + item.seconds, 0),
  );
});

test("guide search helpers retain their legacy behavior", () => {
  const searchable = guide({
    title: "Search test",
    summary: "A test guide.",
    sections: [{ steps: ["Choose the unmistakable control."] }],
  });
  assert.match(guideSearchText(searchable), /unmistakable/);
  assert.equal(guideSnippet(searchable, "unmistakable"), "Choose the unmistakable control.");
});

test("chapter visibility preserves the player course and filters iOS coach paid review", () => {
  assert.deepEqual(
    visibleChapters("coach", "ios").map((item) => item.slug),
    [
      "coach-start",
      "coach-add-student",
      "coach-connect-account",
      "coach-lesson-entry",
      "coach-audio-lesson",
      "coach-share-entry",
      "coach-review-match",
      "coach-feedback",
    ],
  );
  assert.equal(visibleChapters("player", "web").length, 9);
  assert.equal(visibleChapters("coach", "web").length, 9);
});

test("catalog validation accepts the seeded catalog", () => {
  assert.deepEqual(validateLearnCatalog(), []);
});

test("catalog validation names every invalid relationship", () => {
  const input = {
    guides: [
      guide({ slug: "duplicate" }),
      guide({ slug: "duplicate" }),
      guide({ slug: "unknown-group", group: "Unknown" }),
      guide({ slug: "broken-related", related: ["missing-guide"] }),
      guide({ slug: "empty-visibility", visibility: { audiences: [], platforms: [] } }),
    ],
    chapters: [
      chapter({ slug: "duplicate-chapter", guide: undefined }),
      chapter({ slug: "duplicate-chapter", guide: undefined }),
      chapter({ slug: "missing-chapter-guide", guide: "missing-guide" }),
      chapter({
        slug: "empty-chapter-visibility",
        guide: undefined,
        visibility: { audiences: [], platforms: [] },
      }),
    ],
    groups: { player: ["Get started"], coach: ["Coaching"] },
  };

  assert.deepEqual(
    validateLearnCatalog(input),
    [
      "guide duplicate: duplicate guide slug",
      "guide unknown-group: unknown group Unknown for player",
      "guide broken-related: related guide missing-guide does not exist",
      "guide empty-visibility: visibility audiences must not be empty",
      "guide empty-visibility: visibility platforms must not be empty",
      "chapter duplicate-chapter: duplicate chapter slug for player",
      "chapter missing-chapter-guide: guide missing-guide does not exist",
      "chapter empty-chapter-visibility: visibility audiences must not be empty",
      "chapter empty-chapter-visibility: visibility platforms must not be empty",
    ],
  );
});

test("catalog validation rejects related guides without shared visibility", () => {
  const errors = validateLearnCatalog({
    guides: [
      guide({ slug: "player-guide", related: ["coach-guide"] }),
      guide({ slug: "coach-guide", visibility: { audiences: ["coach"], platforms: ["ios"] } }),
    ],
    chapters: [],
    groups: { player: ["Get started"], coach: ["Get started"] },
  });

  assert.deepEqual(errors, ["guide player-guide: related guide coach-guide has no shared visibility"]);
});

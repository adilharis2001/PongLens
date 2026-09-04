import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { guideBySlug as legacyGuideBySlug } from "./guides.ts";

const iosCatalogPath = fileURLToPath(
  new URL("../../../ios/PongLens/PongLens/Resources/learn-catalog.json", import.meta.url),
);

async function loadIOSLearnSerializer(): Promise<() => string> {
  let module: { serializeIOSLearnCatalog?: unknown };
  try {
    module = await import("../../../scripts/generate-ios-learn.ts");
  } catch {
    assert.fail("iOS Learn serializer module is missing");
  }

  assert.equal(
    typeof module!.serializeIOSLearnCatalog,
    "function",
    "iOS Learn serializer must export serializeIOSLearnCatalog",
  );
  return module!.serializeIOSLearnCatalog as () => string;
}

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

test("generated iOS catalog stays fresh and excludes web-only coach commerce", async () => {
  const serializeIOSLearnCatalog = await loadIOSLearnSerializer();
  assert.equal(existsSync(iosCatalogPath), true, "generated iOS Learn catalog is missing");

  const output = serializeIOSLearnCatalog();
  assert.equal(readFileSync(iosCatalogPath, "utf8"), output);

  const catalog = JSON.parse(output) as {
    groups: Array<{ audience: string; groups: string[] }>;
    guides: Array<{ audience: string }>;
    chapters: Array<{ audience: string }>;
  };
  assert.deepEqual(
    catalog.groups.map((group) => group.audience),
    ["player", "coach"],
  );
  assert.ok(catalog.groups.every((group) => group.groups.length > 0));

  const coachRecords = JSON.stringify({
    groups: catalog.groups.filter((group) => group.audience === "coach"),
    guides: catalog.guides.filter((guide) => guide.audience === "coach"),
    chapters: catalog.chapters.filter((chapter) => chapter.audience === "coach"),
  });
  for (const forbidden of [
    "setup-paid-reviews",
    "complete-paid-review",
    "coach-paid-reviews",
    "coach-paid-review",
    "paid review",
    "payout",
    "offering",
  ]) {
    assert.doesNotMatch(coachRecords, new RegExp(forbidden, "i"));
  }
});

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
    ["upload-from-youtube", "match-viewer"],
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

test("legacy guideBySlug defaults to the web catalog", () => {
  assert.equal(legacyGuideBySlug("upload-a-video")?.slug, "upload-a-video");
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

test("coach guide curriculum is complete and paid reviews stay web-only", () => {
  const webSlugs = visibleGuides("coach", "web").map((item) => item.slug);
  const iosSlugs = visibleGuides("coach", "ios").map((item) => item.slug);

  assert.deepEqual(webSlugs, [
    "coaching-workspace",
    "add-connect-student",
    "keep-lesson-entries",
    "audio-record-lesson",
    "share-coach-entry",
    "review-student-match",
    "leave-match-feedback",
    "setup-paid-reviews",
    "complete-paid-review",
  ]);
  assert.deepEqual(iosSlugs, webSlugs.slice(0, -2));
  assert.equal(
    visibleGuides("coach", "ios").some((item) =>
      guideSearchText(item).includes("paid review"),
    ),
    false,
  );
});

test("coach lesson recording guide is audio-only and covers the live action", () => {
  const audioGuide = guideBySlug("audio-record-lesson", "coach", "ios");
  assert.ok(audioGuide);

  const copy = guideSearchText(audioGuide);
  assert.match(copy, /audio record a lesson/);
  assert.doesNotMatch(copy, /video recording|coming soon/);
});

test("every visible guide opens with at least three quick steps", () => {
  for (const audience of ["player", "coach"] as const) {
    for (const platform of ["web", "ios"] as const) {
      for (const item of visibleGuides(audience, platform)) {
        assert.equal(item.sections[0]?.heading, "Quick steps", `${item.slug} starts with Quick steps`);
        assert.ok(
          (item.sections[0]?.steps?.length ?? 0) >= 3,
          `${item.slug} has at least three quick steps`,
        );
      }
    }
  }
});

test("player curriculum retains established guides and gates recording to iOS", () => {
  const establishedSlugs = [
    "upload-a-video",
    "upload-from-youtube",
    "match-viewer",
    "score-points",
    "score-keeper",
    "match-analysis",
    "journal",
    "export",
    "invite-a-coach",
    "tags",
    "stats",
    "share-a-link",
  ];
  const webSlugs = visibleGuides("player", "web").map((item) => item.slug);
  const iosSlugs = visibleGuides("player", "ios").map((item) => item.slug);

  for (const slug of establishedSlugs) {
    assert.ok(webSlugs.includes(slug), `${slug} remains available on web`);
    assert.ok(iosSlugs.includes(slug), `${slug} remains available on iOS`);
  }
  assert.ok(webSlugs.includes("create-share-highlights"));
  assert.ok(iosSlugs.includes("create-share-highlights"));
  assert.equal(webSlugs.includes("record-a-match"), false);
  assert.ok(iosSlugs.includes("record-a-match"));
  assert.deepEqual(visibleGroups("player", "web"), [
    "Get started",
    "Review and score",
    "Your game",
    "Share and export",
  ]);
});

test("Instagram highlight instructions render only for iOS players", () => {
  const webGuide = guideBySlug("create-share-highlights", "player", "web");
  const iosGuide = guideBySlug("create-share-highlights", "player", "ios");
  assert.ok(webGuide);
  assert.ok(iosGuide);

  assert.equal(guideSearchText(webGuide).includes("instagram story and reel"), false);
  assert.match(guideSearchText(iosGuide), /instagram story and reel/);
});

test("tutorial metadata matches the approved player and coach courses", () => {
  assert.deepEqual(
    visibleChapters("player", "web").map(({ slug, title, guide }) => ({ slug, title, guide })),
    [
      { slug: "home", title: "Start here", guide: undefined },
      { slug: "upload", title: "Upload a match", guide: "upload-a-video" },
      { slug: "viewer", title: "Watch it back", guide: "match-viewer" },
      { slug: "point", title: "Score a point", guide: "score-points" },
      { slug: "keepscore", title: "Score Keeper", guide: "score-keeper" },
      { slug: "analysis", title: "Read your match", guide: "match-analysis" },
      {
        slug: "export",
        title: "Highlights, export and share",
        guide: "create-share-highlights",
      },
      { slug: "coach", title: "You and your coach", guide: "invite-a-coach" },
      { slug: "journal", title: "The Journal", guide: "journal" },
    ],
  );

  assert.deepEqual(
    visibleChapters("coach", "web").map(({ slug, title, guide }) => ({ slug, title, guide })),
    [
      { slug: "coach-start", title: "Start here", guide: "coaching-workspace" },
      { slug: "coach-add-student", title: "Add a student", guide: "add-connect-student" },
      {
        slug: "coach-connect-account",
        title: "Connect their account",
        guide: "add-connect-student",
      },
      {
        slug: "coach-lesson-entry",
        title: "Write a lesson entry",
        guide: "keep-lesson-entries",
      },
      {
        slug: "coach-audio-lesson",
        title: "Audio record a lesson",
        guide: "audio-record-lesson",
      },
      {
        slug: "coach-share-entry",
        title: "Share it with the student",
        guide: "share-coach-entry",
      },
      {
        slug: "coach-review-match",
        title: "Review their matches",
        guide: "review-student-match",
      },
      {
        slug: "coach-feedback",
        title: "Leave feedback",
        guide: "leave-match-feedback",
      },
      {
        slug: "coach-paid-review",
        title: "Paid match reviews",
        guide: "setup-paid-reviews",
      },
    ],
  );
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

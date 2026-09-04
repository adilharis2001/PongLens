import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  guideBySlug,
  guideBySlugForPlatform,
  guideSearchText,
  guideSnippet,
  legacyGuideRedirect,
  tutorialTotalSeconds,
  validateLearnCatalog,
  visibleChapters,
  visibleGuides,
  visibleGroups,
  visibleRelatedGuides,
} from "./catalog.ts";
import type { Guide, TutorialChapter } from "./catalogTypes.ts";
import { guideBySlug as legacyGuideBySlug } from "./guides.ts";
import { resolveLearnAudience } from "./audience.ts";
import { resolveTutorialRequest } from "./tutorialRequest.ts";
import { tutorialProgressKey, tutorialWasStarted } from "./tutorialProgress.ts";
import { dualRoleEligible } from "../../lib/dualRoleEligibility.ts";
import {
  REQUIRED_LEARN_SHOT_STATES,
  learnShotManifest,
} from "../../../scripts/demos/learn_shot_manifest.mjs";

const iosCatalogPath = fileURLToPath(
  new URL("../../../ios/PongLens/PongLens/Resources/learn-catalog.json", import.meta.url),
);

async function loadIOSLearnSerializer(): Promise<() => string> {
  let serializerModule: { serializeIOSLearnCatalog?: unknown };
  try {
    serializerModule = await import("../../../scripts/generate-ios-learn.ts");
  } catch {
    assert.fail("iOS Learn serializer module is missing");
  }

  assert.equal(
    typeof serializerModule!.serializeIOSLearnCatalog,
    "function",
    "iOS Learn serializer must export serializeIOSLearnCatalog",
  );
  return serializerModule!.serializeIOSLearnCatalog as () => string;
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

test("Learn audience uses only eligible player and coach URL overrides", () => {
  assert.equal(
    resolveLearnAudience({ active: "coach", requested: undefined, canSwitch: false }),
    "coach",
  );
  assert.equal(
    resolveLearnAudience({ active: "player", requested: "coach", canSwitch: true }),
    "coach",
  );
  assert.equal(
    resolveLearnAudience({ active: "player", requested: "coach", canSwitch: false }),
    "player",
  );
  assert.equal(
    resolveLearnAudience({ active: "coach", requested: "invalid", canSwitch: true }),
    "coach",
  );
});

test("tutorial progress stays separate between player and coach workspaces", () => {
  assert.equal(tutorialProgressKey("player"), "player_tutorial_started");
  assert.equal(tutorialProgressKey("coach"), "coach_tutorial_started");
  assert.equal(tutorialWasStarted({ tutorial_started: true }, "player"), true);
  assert.equal(tutorialWasStarted({ tutorial_started: true }, "coach"), false);
  assert.equal(
    tutorialWasStarted({ coach_tutorial_started: true }, "coach"),
    true,
  );
});

test("dual-role eligibility requires completed player setup and coach evidence", () => {
  const player = {
    coachFlag: false,
    coachProfile: false,
    acceptedCoachLink: false,
    coachRoster: false,
    playerSetupDoneAt: "2026-09-04T10:00:00Z",
  };

  assert.equal(dualRoleEligible(player), false, "player evidence alone is not dual-role");
  for (const coachEvidence of [
    "coachFlag",
    "coachProfile",
    "acceptedCoachLink",
    "coachRoster",
  ] as const) {
    assert.equal(
      dualRoleEligible({ ...player, [coachEvidence]: true }),
      true,
      `${coachEvidence} plus completed player setup is dual-role`,
    );
    assert.equal(
      dualRoleEligible({
        ...player,
        playerSetupDoneAt: null,
        [coachEvidence]: true,
      }),
      false,
      `${coachEvidence} alone is not dual-role`,
    );
  }
});

test("generated iOS catalog stays fresh and excludes web-only coach commerce", async () => {
  const serializeIOSLearnCatalog = await loadIOSLearnSerializer();
  assert.equal(existsSync(iosCatalogPath), true, "generated iOS Learn catalog is missing");

  const output = serializeIOSLearnCatalog();
  assert.equal(readFileSync(iosCatalogPath, "utf8"), output);

  const catalog = JSON.parse(output) as {
    groups: Array<{ audience: string; groups: string[] }>;
    guides: Array<{ audience: string }>;
    chapters: Array<Record<string, unknown> & { audience: string }>;
  };
  assert.deepEqual(
    catalog.groups.map((group) => group.audience),
    ["player", "coach"],
  );
  assert.ok(catalog.groups.every((group) => group.groups.length > 0));
  assert.ok(
    catalog.chapters.every((chapter) => !Object.hasOwn(chapter, "n")),
    "iOS tutorial chapter numbers must be derived after platform filtering",
  );

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

test("legacy guide redirects preserve both renamed routes", () => {
  assert.equal(legacyGuideRedirect("keep-score"), "score-keeper");
  assert.equal(legacyGuideRedirect("for-coaches"), "review-student-match");
});

test("coach guide relationships stay visible on their platform", () => {
  for (const coachGuide of visibleGuides("coach", "ios")) {
    for (const related of visibleRelatedGuides(coachGuide, "coach", "ios")) {
      assert.ok(
        related.visibility.platforms.includes("ios"),
        `${coachGuide.slug} only links to iOS-visible guides`,
      );
    }
  }

  const paidReviewGuides = visibleGuides("coach", "web").filter((item) =>
    guideSearchText(item).includes("paid review"),
  );
  assert.ok(paidReviewGuides.length > 0, "coach paid-review guides remain on web");
  assert.ok(
    paidReviewGuides.every((item) => item.visibility.platforms.includes("web")),
    "every coach paid-review guide is web-visible",
  );
});

test("legacy guideBySlug defaults to the web catalog", () => {
  assert.equal(legacyGuideBySlug("upload-a-video")?.slug, "upload-a-video");
});

test("web guide screenshots cover the refreshed player and coach workflows", () => {
  const imagePaths = new Set(
    (["player", "coach"] as const).flatMap((audience) =>
      visibleGuides(audience, "web").flatMap((item) =>
        item.sections.flatMap((section) =>
          (section.images ?? []).map((image) => image.src),
        ),
      ),
    ),
  );

  for (const imagePath of imagePaths) {
    const filePath = fileURLToPath(
      new URL(`../../../public${imagePath}`, import.meta.url),
    );
    assert.equal(existsSync(filePath), true, `${imagePath} does not exist under public/`);
  }

  const screenshotHarness = readFileSync(
    fileURLToPath(
      new URL("../../../scripts/demos/learn_shots.mjs", import.meta.url),
    ),
    "utf8",
  );
  assert.deepEqual(
    learnShotManifest.map((item) => item.state),
    REQUIRED_LEARN_SHOT_STATES,
    "the manifest must enumerate every required and corrective Learn state",
  );
  for (const item of learnShotManifest) {
    assert.ok(item.reason, `${item.state} must explain why and how it is captured`);
    for (const [platform, variant] of Object.entries(item.variants)) {
      assert.match(screenshotHarness, new RegExp(`"${variant.shot}"\\s*:`));
      const expectedPath = `/learn/${variant.shot}.jpg`;
      const filePath = fileURLToPath(
        new URL(`../../../public${expectedPath}`, import.meta.url),
      );
      if (item.status === "captured") {
        assert.equal(variant.guideImage, expectedPath);
        assert.ok(imagePaths.has(expectedPath), `${expectedPath} is not referenced`);
        assert.equal(existsSync(filePath), true, `${expectedPath} is missing`);
        const expectedKind = platform === "desktop" ? "d" : "m";
        const image = (["player", "coach"] as const)
          .flatMap((audience) => visibleGuides(audience, "web"))
          .flatMap((guide) => guide.sections)
          .flatMap((section) => section.images ?? [])
          .find((candidate) => candidate.src === expectedPath);
        assert.equal(image?.kind, expectedKind, `${expectedPath} has the wrong kind`);
      } else {
        assert.equal(variant.guideImage, undefined);
        assert.equal(existsSync(filePath), false, `${expectedPath} must not be fabricated`);
      }
    }
  }
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

test("tutorial requests return only the course catalog visible on the requested platform", () => {
  assert.deepEqual(
    resolveTutorialRequest({ course: "coach", platform: "web" })?.map(
      (item) => item.mediaKey,
    ),
    [
      "tutorial/coach/coach-start.mp4",
      "tutorial/coach/coach-add-student.mp4",
      "tutorial/coach/coach-connect-account.mp4",
      "tutorial/coach/coach-lesson-entry.mp4",
      "tutorial/coach/coach-audio-lesson.mp4",
      "tutorial/coach/coach-share-entry.mp4",
      "tutorial/coach/coach-review-match.mp4",
      "tutorial/coach/coach-feedback.mp4",
      "tutorial/coach/coach-paid-review.mp4",
    ],
  );
  assert.deepEqual(
    resolveTutorialRequest({ course: "coach", platform: "ios" })?.map(
      (item) => item.mediaKey,
    ),
    [
      "tutorial/coach/coach-start.mp4",
      "tutorial/coach/coach-add-student.mp4",
      "tutorial/coach/coach-connect-account.mp4",
      "tutorial/coach/coach-lesson-entry.mp4",
      "tutorial/coach/coach-audio-lesson.mp4",
      "tutorial/coach/coach-share-entry.mp4",
      "tutorial/coach/coach-review-match.mp4",
      "tutorial/coach/coach-feedback.mp4",
    ],
  );
});

test("tutorial requests match slugs only inside the selected catalog", () => {
  assert.deepEqual(
    resolveTutorialRequest({
      course: "coach",
      platform: "ios",
      slug: "coach-paid-review",
    }),
    [],
  );
  assert.deepEqual(
    resolveTutorialRequest({ course: "player", platform: "web", slug: "coach-start" }),
    [],
  );
});

test("tutorial requests reject invalid catalogs and never turn request strings into media keys", () => {
  assert.equal(
    resolveTutorialRequest({ course: "administrator", platform: "web" }),
    null,
  );
  assert.equal(
    resolveTutorialRequest({ course: "player", platform: "android" }),
    null,
  );
  assert.deepEqual(
    resolveTutorialRequest({
      course: "player",
      platform: "web",
      slug: "../../private/customer-video",
    }),
    [],
  );
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

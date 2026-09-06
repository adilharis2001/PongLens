# Role-aware Learn Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship one role-aware Learn catalog that gives players and coaches current written guides and tutorial chapters on web and iOS while excluding paid-review material from iOS.

**Architecture:** Pure TypeScript catalog data and selectors are the source of truth. Web pages filter that catalog by resolved workspace and platform; a checked generator emits an iOS-only JSON resource decoded by pure Swift models. Tutorial signing, progress metadata, search, related links, and numbering all consume the filtered catalog.

**Tech Stack:** Next.js 15, React 19, TypeScript, Node test runner, Supabase Auth metadata, SwiftUI, XCTest, AVKit.

**Spec:** docs/superpowers/specs/2026-09-04-role-aware-learn-and-tutorials-design.md

## Global Constraints

- Learn defaults to the active Playing or Coaching workspace on web and iOS.
- Looking at the other Learn audience never changes the active workspace.
- Coach lesson recording copy describes audio recording only.
- iOS coach Learn contains no paid-review guide, search hit, related link, or tutorial chapter.
- Web coach Learn contains the two paid-review guides and the ninth paid-review tutorial chapter.
- The player tutorial remains nine chapters and the coach tutorial is nine chapters on web and eight on iOS.
- The old tutorial_started metadata flag counts only as player progress.
- Existing player media remains readable until replacement media is published and verified.
- No database migration or product-capability change is part of this plan.

## File map

- Create src/app/learn/catalogTypes.ts for Learn domain types.
- Create src/app/learn/playerGuides.ts for refreshed player guide data.
- Create src/app/learn/coachGuides.ts for coach guide data.
- Create src/app/learn/tutorialChapters.ts for player and coach chapter metadata.
- Create src/app/learn/catalog.ts for groups, selectors, search helpers, and catalog validation.
- Replace src/app/learn/guides.ts with a compatibility re-export while callers migrate.
- Expand src/app/learn/guides.test.ts into the catalog contract suite.
- Create scripts/generate-ios-learn.ts to emit the iOS-visible catalog.
- Replace ios/PongLens/PongLens/Resources/guides.json with Resources/learn-catalog.json.
- Create src/app/learn/audience.ts for pure audience resolution.
- Create src/app/learn/serverContext.ts for signed-in user, dual-role evidence, and audience resolution.
- Create src/app/learn/LearnAudienceSwitch.tsx for URL-only audience switching.
- Modify LearnIndex.tsx, page.tsx, [slug]/page.tsx, videos/page.tsx, and videos/VideoCourse.tsx to consume filtered data.
- Replace videos/chapters.ts with compatibility exports from the catalog.
- Create src/app/learn/tutorialRequest.ts and modify src/app/api/tutorial-url/route.ts to whitelist course-platform media.
- Create src/app/learn/tutorialProgress.ts and update both web first-step checklists.
- Create ios/PongLens/PongLens/Core/LearnCatalog.swift for decoding and selectors.
- Modify ios/PongLens/PongLens/Screens/LearnScreen.swift and App/MainTabView.swift for role-aware guides and videos.
- Create ios/PongLens/PongLensTests/LearnCatalogTests.swift and add the PongLensTests target.
- Extend scripts/demos/learn_shots.mjs and refresh only screenshots referenced by changed guides.

---

### Task 1: Catalog types, selectors, and validation

**Files:**
- Create: src/app/learn/catalogTypes.ts
- Create: src/app/learn/playerGuides.ts
- Create: src/app/learn/coachGuides.ts
- Create: src/app/learn/tutorialChapters.ts
- Create: src/app/learn/catalog.ts
- Modify: src/app/learn/guides.ts
- Modify: src/app/learn/videos/chapters.ts
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Produces: LearnAudience, LearnPlatform, LearnVisibility, Guide, TutorialChapter.
- Produces: visibleGuides(audience, platform), visibleChapters(audience,
  platform), visibleGroups(audience, platform), visibleRelatedGuides(guide,
  audience, platform), guideBySlug(slug, audience, platform),
  guideBySlugForPlatform(slug, platform), guideSearchText(guide),
  guideSnippet(guide, query), tutorialTotalSeconds(audience, platform), and
  validateLearnCatalog().
- Consumes: no application state; this module must stay importable by node --test.

- [ ] **Step 1: Write the failing selector and validation tests**

Add tests with these assertions:

~~~ts
assert.deepEqual(
  visibleChapters("coach", "ios").map((chapter) => chapter.slug),
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
assert.equal(
  visibleGuides("coach", "ios").some((guide) =>
    guideSearchText(guide).includes("paid review")
  ),
  false,
);
assert.equal(visibleChapters("player", "web").length, 9);
assert.equal(visibleChapters("coach", "web").length, 9);
assert.deepEqual(validateLearnCatalog(), []);
~~~

Also construct invalid in-memory catalogs that prove duplicate slugs, unknown groups, broken related slugs, empty visibility arrays, and missing chapter guide relationships each produce a named validation error.

- [ ] **Step 2: Run the Learn tests and verify they fail**

Run: npm run test:learn

Expected: FAIL because catalogTypes.ts, catalog.ts, and the selector exports do not exist.

- [ ] **Step 3: Add the domain types**

Implement these exact public shapes. A section without visibility inherits
its guide visibility; selectors remove a section when its own visibility does
not include the requested audience and platform:

~~~ts
export type LearnAudience = "player" | "coach";
export type LearnPlatform = "web" | "ios";

export interface LearnVisibility {
  audiences: LearnAudience[];
  platforms: LearnPlatform[];
}

export interface GuideImage {
  src: string;
  alt: string;
  kind: "m" | "d";
  phoneTwin?: boolean;
}

export interface GuideSection {
  heading?: string;
  steps?: string[];
  paragraphs?: string[];
  bullets?: string[];
  tip?: string;
  images?: GuideImage[];
  visibility?: LearnVisibility;
}

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  group: string;
  visibility: LearnVisibility;
  sections: GuideSection[];
  related?: string[];
}

export interface TutorialChapter {
  slug: string;
  title: string;
  blurb: string;
  seconds: number;
  guide?: string;
  visibility: LearnVisibility;
  mediaKey: string;
}
~~~

- [ ] **Step 4: Add minimal catalog data and selectors**

Define player and coach group arrays separately. Implement selectors by checking both visibility arrays, derive chapter numbering from array order, and never store a chapter number in source data. Keep guideSearchText and guideSnippet behavior byte-for-byte compatible with the old helper.

The initial catalog only needs one representative player and coach guide plus all chapter records required by the tests. Chapter media keys must use tutorial/player/<slug>.mp4 and tutorial/coach/<slug>.mp4.

- [ ] **Step 5: Make validation return actionable errors**

Implement:

~~~ts
export function validateLearnCatalog(
  input: {
    guides: Guide[];
    chapters: TutorialChapter[];
    groups: Record<LearnAudience, readonly string[]>;
  } = { guides, chapters, groups: LEARN_GROUPS },
): string[]
~~~

Each error includes the offending slug and condition. Validation checks global guide slug uniqueness, chapter slug uniqueness within an audience, known groups for every audience, non-empty visibility, valid related links with at least one shared audience-platform pair, and valid chapter guide links.

- [ ] **Step 6: Preserve compatibility exports**

Make guides.ts and videos/chapters.ts re-export the new catalog interfaces and functions so intermediate commits compile while page callers migrate. CHAPTERS temporarily aliases visibleChapters("player", "web").

- [ ] **Step 7: Run tests and commit**

Run: npm run test:learn

Expected: PASS.

Commit:

~~~bash
git add src/app/learn
git commit -m "refactor: introduce shared Learn catalog"
~~~

### Task 2: Complete coach curriculum and refresh player guides

**Files:**
- Modify: src/app/learn/playerGuides.ts
- Modify: src/app/learn/coachGuides.ts
- Modify: src/app/learn/tutorialChapters.ts
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Consumes: Guide and TutorialChapter from catalogTypes.ts.
- Produces: the complete guide and chapter arrays used by all later tasks.

- [ ] **Step 1: Add failing curriculum-contract tests**

Assert the coach web guide slugs are exactly:

~~~ts
[
  "coaching-workspace",
  "add-connect-student",
  "keep-lesson-entries",
  "audio-record-lesson",
  "share-coach-entry",
  "review-student-match",
  "leave-match-feedback",
  "setup-paid-reviews",
  "complete-paid-review",
]
~~~

Assert the final two are absent on iOS. Assert audio-record-lesson contains the phrase Audio record a lesson and contains neither video recording nor coming soon. Assert every guide starts with Quick steps and has at least three steps.

Assert player guides include record-a-match on iOS only and create-share-highlights on both platforms. Assert these existing slugs remain valid: upload-a-video, upload-from-youtube, match-viewer, score-points, score-keeper, match-analysis, journal, export, invite-a-coach, tags, stats, and share-a-link.

- [ ] **Step 2: Run tests and verify the curriculum assertions fail**

Run: npm run test:learn

Expected: FAIL listing the missing coach and player slugs.

- [ ] **Step 3: Write all nine coach guides**

Use the exact guide titles, ordering, capability boundaries, and section coverage from the spec section Written coach curriculum. Use these coach groups in order:

~~~ts
["Get started", "Lesson entries", "Match feedback", "Paid reviews"]
~~~

Every guide begins with Quick steps. The first seven target web and iOS. setup-paid-reviews and complete-paid-review target web only. The audio guide describes choosing Audio record a lesson, student selection, phone placement, start, pause, resume, finish, transcript review, prepared-note review, corrections, and save; it contains no video-recording roadmap language.

- [ ] **Step 4: Refresh the player guide data**

Apply every item under Written player audit in the spec. Preserve accurate wording in the four verify-only guides unless a live label disagrees. Add:

- create-share-highlights on web and iOS; put Instagram Story and Reel
  instructions in a GuideSection whose visibility is
  { audiences: ["player"], platforms: ["ios"] }.
- record-a-match on iOS only; cover match versus practice, camera alignment, optional spoken scores, pause, finish, and upload handoff.

Keep the player group structure and remove the obsolete For coaches group after for-coaches is retired.

- [ ] **Step 5: Replace chapter metadata**

Enter all nine player and nine coach chapter records from the approved spec. Use the exact titles and guide relationships. Set seconds to the current measured player values where footage is unchanged and to the script estimates where a new render is pending; the media plan replaces estimates with measured values before release.

- [ ] **Step 6: Run catalog tests and inspect copy boundaries**

Run:

~~~bash
npm run test:learn
rg -ni "coming soon|video lesson|video recording" src/app/learn/coachGuides.ts
~~~

Expected: tests PASS and rg returns no coach-copy matches.

- [ ] **Step 7: Commit**

~~~bash
git add src/app/learn
git commit -m "content: expand coach Learn and refresh player guides"
~~~

### Task 3: Generate and check the iOS catalog

**Files:**
- Create: scripts/generate-ios-learn.ts
- Modify: package.json
- Delete: ios/PongLens/PongLens/Resources/guides.json
- Create: ios/PongLens/PongLens/Resources/learn-catalog.json
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Consumes: visibleGuides and visibleChapters from catalog.ts.
- Produces: deterministic LearnCatalogFile JSON containing schemaVersion, groups, guides, and chapters for platform ios only.

- [ ] **Step 1: Add a failing freshness and exclusion test**

The test runs the serializer in memory and compares it to the committed file.
It also selects the serialized coach records and asserts that
setup-paid-reviews, complete-paid-review, coach-paid-reviews, paid review,
payout, and offering do not occur case-insensitively.

- [ ] **Step 2: Run the test and verify it fails**

Run: npm run test:learn

Expected: FAIL because serializeIOSLearnCatalog and learn-catalog.json do not exist.

- [ ] **Step 3: Implement deterministic serialization**

Export serializeIOSLearnCatalog(): string from scripts/generate-ios-learn.ts. Emit two-space JSON, one terminal newline, player then coach groups, source-order guides, and source-order chapters. Strip web-only records before serialization. Retain audience on every record; images may be omitted because Swift does not render them.

Support --check without writing:

~~~ts
if (process.argv.includes("--check")) {
  if (existing !== output) process.exitCode = 1;
} else {
  writeFileSync(target, output);
}
~~~

- [ ] **Step 4: Add package scripts and generate the file**

Add:

~~~json
"learn:ios": "node --experimental-strip-types scripts/generate-ios-learn.ts",
"learn:ios:check": "node --experimental-strip-types scripts/generate-ios-learn.ts --check"
~~~

Run: npm run learn:ios

Expected: Resources/learn-catalog.json is created and contains no web-only coach commerce.

- [ ] **Step 5: Run checks and commit**

Run:

~~~bash
npm run learn:ios:check
npm run test:learn
git diff --check
~~~

Expected: all PASS.

Commit:

~~~bash
git add package.json scripts/generate-ios-learn.ts ios/PongLens/PongLens/Resources src/app/learn/guides.test.ts
git commit -m "build: generate the iOS Learn catalog"
~~~

### Task 4: Resolve the web Learn audience without changing workspace

**Files:**
- Create: src/lib/dualRoleEligibility.ts
- Modify: src/lib/coachEligible.ts
- Create: src/app/learn/audience.ts
- Create: src/app/learn/serverContext.ts
- Create: src/app/learn/LearnAudienceSwitch.tsx
- Modify: src/app/learn/page.tsx
- Modify: src/app/learn/LearnIndex.tsx
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Produces: dualRoleEligible(evidence), resolveLearnAudience(input), loadLearnServerContext(requested).
- Produces: LearnIndex({ audience, platform, canSwitch, afterSearch }).
- Consumes: rememberedWorkspace(), useCoachEligible(), and catalog selectors.

- [ ] **Step 1: Write failing audience tests**

~~~ts
assert.equal(resolveLearnAudience({
  active: "coach", requested: undefined, canSwitch: false,
}), "coach");
assert.equal(resolveLearnAudience({
  active: "player", requested: "coach", canSwitch: true,
}), "coach");
assert.equal(resolveLearnAudience({
  active: "player", requested: "coach", canSwitch: false,
}), "player");
assert.equal(resolveLearnAudience({
  active: "coach", requested: "invalid", canSwitch: true,
}), "coach");
~~~

Test dualRoleEligible with the same evidence matrix documented by useCoachEligible: a player profile with setup_done_at plus any coach flag, profile, accepted coach link, or roster makes the account dual-role; either side alone does not.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:learn

Expected: FAIL because audience.ts and dualRoleEligibility.ts do not exist.

- [ ] **Step 3: Extract and reuse the eligibility predicate**

Make useCoachEligible call dualRoleEligible after its current Supabase queries. Do not change its sessionStorage key or hydration behavior.

- [ ] **Step 4: Implement the server context**

loadLearnServerContext(requested) authenticates once, reads rememberedWorkspace(), queries the same four coach/player evidence sources as useCoachEligible, applies resolveLearnAudience, and returns:

~~~ts
{
  user: User;
  avatarUrl: string | null;
  activeWorkspace: LearnAudience;
  audience: LearnAudience;
  canSwitch: boolean;
}
~~~

Unauthenticated requests redirect to /login. The helper performs no workspace write.

- [ ] **Step 5: Render filtered web guides and the URL-only switch**

LearnPage accepts searchParams: Promise<{ audience?: string }>. Pass audience and canSwitch to LearnIndex. LearnIndex searches only visibleGuides(audience, "web"), groups with visibleGroups, and preserves ?audience=<value> in guide and video links when the selected audience differs from the active workspace.

LearnAudienceSwitch renders only when canSwitch is true. Its two links update the audience query and never call setWorkspace.

- [ ] **Step 6: Run tests, lint, and commit**

Run:

~~~bash
npm run test:learn
npx eslint src/app/learn src/lib/coachEligible.ts src/lib/dualRoleEligibility.ts
~~~

Expected: PASS.

Commit:

~~~bash
git add src/app/learn src/lib/coachEligible.ts src/lib/dualRoleEligibility.ts
git commit -m "feat: adapt web Learn to the active workspace"
~~~

### Task 5: Filter guide detail pages and retire the catch-all coach guide

**Files:**
- Modify: src/app/learn/[slug]/page.tsx
- Modify: src/app/learn/catalog.ts
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Consumes: guideBySlugForPlatform for stable direct audience links and
  visibleRelatedGuides for platform filtering.
- Produces: stable web guide routes and the for-coaches legacy redirect.

- [ ] **Step 1: Add failing redirect and relationship tests**

Assert legacyGuideRedirect("keep-score") returns score-keeper and legacyGuideRedirect("for-coaches") returns review-student-match. Assert every related card returned for an iOS coach guide is iOS-visible and every web coach paid guide remains web-visible.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:learn

Expected: FAIL because legacyGuideRedirect does not exist.

- [ ] **Step 3: Implement direct-link behavior**

Add guideBySlugForPlatform for routing only. A valid web-visible direct guide
URL displays that guide even when it differs from the active workspace, uses
the guide audience for its back link and related cards, and filters related
cards to web. An iOS-only guide such as record-a-match returns notFound() on
the web. Preserve ?audience=<guide audience> on all Learn links.

Redirect /learn/for-coaches to /learn/review-student-match?audience=coach and preserve the existing keep-score redirect.

- [ ] **Step 4: Run tests and commit**

Run: npm run test:learn

Expected: PASS.

Commit:

~~~bash
git add src/app/learn
git commit -m "feat: keep role-aware Learn guide links stable"
~~~

### Task 6: Make the web tutorial course and signing endpoint role-aware

**Files:**
- Create: src/app/learn/tutorialRequest.ts
- Modify: src/app/learn/videos/page.tsx
- Modify: src/app/learn/videos/VideoCourse.tsx
- Modify: src/app/api/tutorial-url/route.ts
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Produces: resolveTutorialRequest({ course, platform, slug }).
- Consumes: visibleChapters and tutorialTotalSeconds.
- VideoCourse props: { audience: LearnAudience; activeWorkspace: LearnAudience; canSwitch: boolean }.

- [ ] **Step 1: Write failing request tests**

Test that coach/web without a slug returns nine keys, coach/ios returns eight, coach/ios plus coach-paid-reviews returns an empty result, player/web plus a coach slug returns an empty result, and arbitrary strings never become media keys.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:learn

Expected: FAIL because resolveTutorialRequest does not exist.

- [ ] **Step 3: Implement the pure request resolver**

Return null for an invalid course or platform. Otherwise filter visibleChapters(course, platform), then optionally match slug. Return only catalog chapter objects; do not construct a key from request text.

- [ ] **Step 4: Update the API route**

Parse:

~~~ts
interface TutorialURLRequest {
  course: LearnAudience;
  platform: LearnPlatform;
  slug?: string;
}
~~~

Return 400 for invalid course/platform, 404 for a valid set with no matching chapter, and sign each chapter.mediaKey directly. Keep sign-in required and the six-hour inline disposition.

- [ ] **Step 5: Update the video page and course UI**

Resolve the audience from searchParams with loadLearnServerContext. VideoCourse derives cards, numbers, duration, previous/next behavior, and directory rows from visibleChapters(audience, "web"). Fetch URLs with { course: audience, platform: "web" }. Reset current chapter and URL state when audience changes. Show LearnAudienceSwitch on both desktop and mobile course entry surfaces.

- [ ] **Step 6: Run tests, lint, and commit**

Run:

~~~bash
npm run test:learn
npx eslint src/app/learn src/app/api/tutorial-url/route.ts
~~~

Expected: PASS.

Commit:

~~~bash
git add src/app/learn src/app/api/tutorial-url/route.ts
git commit -m "feat: add player and coach tutorial courses"
~~~

### Task 7: Split player and coach tutorial progress

**Files:**
- Create: src/app/learn/tutorialProgress.ts
- Modify: src/app/learn/videos/VideoCourse.tsx
- Modify: src/app/dashboard/FirstSteps.tsx
- Modify: src/app/coaching/CoachFirstSteps.tsx
- Modify: src/app/coaching/page.tsx
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Produces: tutorialProgressKey(audience) and tutorialWasStarted(metadata, audience).
- Consumes: player_tutorial_started, coach_tutorial_started, and legacy tutorial_started.

- [ ] **Step 1: Write failing metadata tests**

~~~ts
assert.equal(tutorialProgressKey("player"), "player_tutorial_started");
assert.equal(tutorialProgressKey("coach"), "coach_tutorial_started");
assert.equal(tutorialWasStarted({ tutorial_started: true }, "player"), true);
assert.equal(tutorialWasStarted({ tutorial_started: true }, "coach"), false);
assert.equal(tutorialWasStarted({ coach_tutorial_started: true }, "coach"), true);
~~~

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:learn

Expected: FAIL because tutorialProgress.ts does not exist.

- [ ] **Step 3: Update playback progress writes**

On the first actual play per mounted audience, update only the key returned by tutorialProgressKey(audience). Reset the one-shot ref when the audience prop changes.

- [ ] **Step 4: Update both checklists**

The player checklist reads tutorialWasStarted(metadata, "player") and links to /learn/videos?audience=player. The coach checklist reads tutorialWasStarted(metadata, "coach"), links to /learn/videos?audience=coach, replaces /learn/for-coaches with /learn/review-student-match?audience=coach, and retains the web-only Offer paid reviews checklist item.

- [ ] **Step 5: Run relevant tests and commit**

Run:

~~~bash
npm run test:learn
npm run test:coach-landing
npm run test:auth
~~~

Expected: all PASS.

Commit:

~~~bash
git add src/app/learn src/app/dashboard/FirstSteps.tsx src/app/coaching
git commit -m "fix: track tutorial progress by workspace"
~~~

### Task 8: Decode and test the shared catalog in iOS

**Files:**
- Create: ios/PongLens/PongLens/Core/LearnCatalog.swift
- Create: ios/PongLens/PongLensTests/LearnCatalogTests.swift
- Modify: ios/PongLens/PongLens.xcodeproj/project.pbxproj
- Modify: ios/PongLens/PongLens/Screens/LearnScreen.swift

**Interfaces:**
- Produces: LearnAudience, LearnGuide, LearnChapter, NumberedLearnChapter,
  LearnCatalogFile, LearnCatalogStore.
- Produces: guides(audience), chapters(audience),
  numberedChapters(audience), groups(audience), related(for:audience), and
  search(query:audience).
- Consumes: Resources/learn-catalog.json.

- [ ] **Step 1: Add the PongLensTests target and failing tests**

Create an XCTest unit-test target with @testable import PongLens. Tests decode the committed resource and assert:

~~~swift
XCTAssertEqual(store.chapters(for: .player).count, 9)
XCTAssertEqual(store.chapters(for: .coach).count, 8)
XCTAssertTrue(store.search("paid review", audience: .coach).isEmpty)
XCTAssertEqual(
    store.numberedChapters(for: .coach).map(\.number),
    Array(1...8)
)
~~~

Also test that related results stay in the selected audience and that search includes tips and bullets, not only steps and paragraphs.

- [ ] **Step 2: Run the unit test and verify failure**

Run:

~~~bash
xcodebuild test -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" -only-testing:PongLensTests/LearnCatalogTests
~~~

Expected: FAIL because LearnCatalogStore does not exist.

- [ ] **Step 3: Implement the Swift models and selectors**

Decode audience as a String-backed Codable enum. numberedChapters(for:)
enumerates the filtered source-order array into NumberedLearnChapter values;
the number is not serialized. Tests load the committed resource relative to
#filePath, while LearnCatalogStore.loadBundled() reads Bundle.main and exposes
an empty fallback only to the shipping view.

Search concatenates title, summary, headings, steps, paragraphs, bullets, and tips after lowercasing. The generated resource contains no images and no web-only records.

- [ ] **Step 4: Remove duplicate models from LearnScreen**

Delete GuideSectionData, GuideData, GuidesFile, and GuideLibrary from LearnScreen.swift. Replace them with the Core/LearnCatalog.swift types.

- [ ] **Step 5: Run tests and commit**

Run:

~~~bash
xcodebuild test -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" -only-testing:PongLensTests/LearnCatalogTests
~~~

Expected: PASS.

Commit:

~~~bash
git add ios/PongLens
git commit -m "test: decode and filter Learn content on iOS"
~~~

### Task 9: Make iOS Learn and tutorials follow the active workspace

**Files:**
- Modify: ios/PongLens/PongLens/Screens/LearnScreen.swift
- Modify: ios/PongLens/PongLens/App/MainTabView.swift
- Modify: ios/PongLens/PongLens/Screens/HomeScreen.swift
- Test: ios/PongLens/PongLensTests/LearnCatalogTests.swift

**Interfaces:**
- Consumes: AppState.workspace, AppState.playerSetupPending, CoachingStore, LearnCatalogStore, and the course-platform tutorial API.
- Produces: LearnVideosRoute(audience) and role-aware LearnScreen/TutorialVideosScreen.

- [ ] **Step 1: Add failing route and progress-key tests**

Add pure tests for:

~~~swift
XCTAssertEqual(LearnAudience(workspace: .coach), .coach)
XCTAssertEqual(LearnAudience.coach.progressKey, "coach_tutorial_started")
XCTAssertTrue(LearnAudience.player.started(in: ["tutorial_started": true]))
XCTAssertFalse(LearnAudience.coach.started(in: ["tutorial_started": true]))
~~~

- [ ] **Step 2: Run tests and verify failure**

Run the LearnCatalogTests xcodebuild command from Task 8.

Expected: FAIL because the workspace initializer and progress helpers do not exist.

- [ ] **Step 3: Add audience state and switching to LearnScreen**

Use selectedAudience as an optional local @State. The effective audience is selectedAudience or LearnAudience(workspace: app.workspace). Render the switch only when the same iOS eligibility expression used in MainTabView is true and app.playerSetupPending is false. Changing it updates local state only and never calls app.setWorkspace.

Filter the index, groups, search, detail related guides, and tutorial card using LearnCatalogStore. Pass the effective audience through LearnVideosRoute so a locally selected coach course does not fall back to the active player workspace during navigation.

- [ ] **Step 4: Replace the hard-coded tutorial chapter array**

TutorialVideosScreen accepts a LearnAudience, loads store.chapters(for: audience), uses one-based visible numbering, and posts:

~~~swift
struct Req: Encodable {
    let course: LearnAudience
    let platform = "ios"
    let slug: String
}
~~~

On first playback set audience.progressKey. Player completion reads player_tutorial_started or legacy tutorial_started; coach completion reads coach_tutorial_started only.

- [ ] **Step 5: Update iOS first-step links**

HomeScreen uses player tutorial progress semantics and opens LearnVideosRoute(.player). Any coach first-step tutorial entry in CoachHomeScreen opens LearnVideosRoute(.coach). No iOS checklist or Learn screen introduces an offering, order, price, payment, or payout label.

- [ ] **Step 6: Run tests, build, and commit**

Run:

~~~bash
npm run learn:ios:check
xcodebuild test -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" -only-testing:PongLensTests/LearnCatalogTests
xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" CODE_SIGNING_ALLOWED=NO
~~~

Expected: all PASS.

Commit:

~~~bash
git add ios/PongLens
git commit -m "feat: add role-aware Learn to iOS"
~~~

### Task 10: Refresh guide screenshots and verify the product implementation

**Files:**
- Modify: scripts/demos/learn_shots.mjs
- Modify: src/app/learn/playerGuides.ts
- Modify: src/app/learn/coachGuides.ts
- Modify: public/learn/*.jpg only for changed or new referenced shots
- Test: src/app/learn/guides.test.ts

**Interfaces:**
- Consumes: live staged player and coach accounts and guide image metadata.
- Produces: current, privacy-checked screenshots with every web path present.

- [ ] **Step 1: Extend the screenshot manifest**

Add named desktop/mobile shots for the exact guide states that are not already represented by verified public/showcase coach assets: Learn audience switch, player highlights, original video control, missed-rally restoration, placement retry, journal Ask/Recollect, coach direct share, coach public entry link, and overall match feedback.

Reuse existing public/showcase/coach-*.jpg only when the visible labels and state match the guide text. Reference reused files directly; do not copy them under new names.

- [ ] **Step 2: Capture read-only screenshots**

Run the local app and:

~~~bash
SERVICE_KEY="$(security find-generic-password -a openclaw -s ponglens-service-role -w)" BASE=http://localhost:3000 node scripts/demos/learn_shots.mjs
~~~

The script must not create exports, orders, charges, or public links. If a state requires a link, stage it before capture or bracket it with explicit cleanup.

- [ ] **Step 3: Inspect every changed image**

Open every changed JPEG and check current labels, no loading skeleton, no email or token, intended crop, readable mobile text, and correct Playing or Coaching workspace.

- [ ] **Step 4: Run the complete verification contract**

Run:

~~~bash
npm run learn:ios:check
npm run test:learn
npm run test:coach-landing
npm run test:auth
npm run test:journal
npm run test:upload
npm run test:starred
npx eslint src/app/learn src/app/api/tutorial-url/route.ts src/app/dashboard/FirstSteps.tsx src/app/coaching/CoachFirstSteps.tsx
npm run build
xcodebuild test -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" -only-testing:PongLensTests/LearnCatalogTests
xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" CODE_SIGNING_ALLOWED=NO
git diff --check
~~~

Expected: every command PASS.

- [ ] **Step 5: Inspect both apps**

On web inspect /learn and /learn/videos at desktop width and 393 by 660 for active player, active coach, and a dual-role URL override. In the simulator inspect player and coach guide lists, searches, related links, eight-chapter coach numbering, nine-chapter player numbering, rotation during playback, and the absence of iOS coach commerce copy.

- [ ] **Step 6: Commit**

~~~bash
git add scripts/demos/learn_shots.mjs public/learn src/app/learn
git commit -m "docs: refresh Learn screenshots"
~~~

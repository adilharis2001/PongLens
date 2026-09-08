# Match Tools and Sharing Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify the match Tools information architecture, make Match analysis an inline destination, unify public-link creation, repair score and stats on public highlight links, and remove duplicated Instagram and coach actions.

**Architecture:** Public highlight links continue to play the worker's one ready automatic-highlight MP4. Token-gated SQL resolvers publish the full scored point context plus a sanitized highlight output timeline; the public player maps output time to a point ID and derives the score entering that rally without a render. iOS and authenticated web retain their existing visual systems while sharing the same action ownership and copy.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Next.js 15, React 19, TypeScript, Node test runner, Swift, SwiftUI, AVFoundation, shell-based Swift tests, XCTest, Playwright/browser inspection.

**Spec:** `docs/superpowers/specs/2026-09-07-match-tools-sharing-simplification-design.md`

## Global Constraints

- Start implementation from the current production `origin/main` in an isolated `codex/` worktree; the present main checkout is divergent and contains unrelated uncommitted highlight-worker work.
- Preserve the approved Tools, chooser-sheet, form, card, toggle, color, typography, spacing, corner, and button treatments.
- The Tools row label is `Share a link`.
- The Highlights video-appearance helper is `For Instagram and saved videos.`
- The public link setting is `Include score and stats` with helper `The running score over the video, plus the result and the placement maps.`
- Public highlight links never enqueue a render and never consume processing minutes.
- Opening Highlights, Share a link, or a public link never generates or regenerates highlights.
- The score overlay shows the score entering the rally. During the 0.3-second crossfade, the incoming rally owns the overlap from `output_start_s`.
- Existing point, starred, tag, entry, coach-access, and revocation behavior must remain available.
- Mobile web verification is at 393x660. Native iOS verification is separate.
- Completion requires the real `npm run build`, not a filtered typecheck.

## File Map

### Database and public page

- Create `supabase/migrations/20260907180000_highlight_share_score_and_stats.sql`: token-gated point, placement, and sanitized highlight-timeline resolution.
- Modify `src/lib/research/migration.test.ts`: migration contract checks.
- Modify `src/app/s/[token]/shareData.ts`: public highlight timeline types and playback-timeline builder.
- Modify `src/app/s/[token]/shareData.test.ts`: match-clock and highlight-clock mapping tests.
- Modify `src/app/s/[token]/page.tsx`: load scored context for match and highlight links.
- Modify `src/app/s/[token]/ShareView.tsx`: consume an explicit playback timeline.
- Modify `src/app/api/share/highlightShare.ts`: export `sanitizeHighlightTimeline` for public highlight timeline rows.
- Modify `src/app/api/share/highlightShare.test.ts`: malformed-timeline coverage.

### Authenticated web

- Modify `src/components/ShareSheet.tsx`: add the Highlights target, accept an initial target, remove coach access from the public-link sheet, and use the `Share a link` title.
- Modify `src/app/match/[id]/MatchView.tsx`: reorder Tools, rename Share, feed highlight readiness to the link sheet, and retain the analysis anchor.
- Modify `src/app/match/[id]/HighlightsRow.tsx`: report the current highlight state to the owning page without triggering generation.
- Modify `src/app/match/[id]/ReelBar.tsx`: remove Instagram Reel from Export and clarify the export-only score setting.
- Modify `src/components/ShareWithCoach.tsx`: put starter selections before Create invite link.
- Create `src/app/match/[id]/toolsStructure.test.ts`: source-level regression contract for the large match component and its sheets.

### Native iOS

- Modify `ios/PongLens/PongLens/Screens/MatchTools.swift`: reorder Tools, rename Share, replace the analysis sheet action with a scroll callback, unify link targets, remove Instagram Reel from Export, and reorder coach creation.
- Modify `ios/PongLens/PongLens/Screens/MatchDetailScreen.swift`: add the inline owner analysis section and stable anchor.
- Modify `ios/PongLens/PongLens/Screens/HighlightsSheet.swift`: open the common link composer with Highlights selected and label the video-only appearance settings.
- Modify `ios/PongLens/PongLens/Screens/AnalysisSheet.swift`: keep reusable `AnalysisCards`; remove `AnalysisSheet` only if no other caller remains.
- Modify `ios/PongLens/PongLens/Core/Models.swift`: add the pure `ShareLinkTarget` availability model used by the app and shell test harness; add no persisted field.
- Modify `ios/Tests/HighlightsTests.swift`: highlight action and link-entry contracts.
- Create `ios/Tests/MatchToolsTests.swift`: pure row ordering and link-target availability tests.
- Modify `ios/Tests/run.sh`: compile the new pure test file.
- Modify `ios/Tests/main.swift`: call the new test entry point.

---

### Task 1: Token-gated public highlight score data

**Files:**
- Create: `supabase/migrations/20260907180000_highlight_share_score_and_stats.sql`
- Modify: `src/lib/research/migration.test.ts`

**Interfaces:**
- Produces: `resolve_share_highlight_timeline(p_token text)` returning `point_id`, `output_start_s`, and `output_end_s` only.
- Changes: `resolve_share_points(p_token text)` accepts active `match` and `highlights` tokens.
- Changes: `resolve_share_placement(p_token text)` accepts active `match` and `highlights` tokens when `show_score` is true.
- Preserves: no direct anonymous table grants and every existing return column.

- [ ] **Step 1: Add the failing migration contract test**

Append assertions for the new migration:

```ts
const highlightShareScore = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260907180000_highlight_share_score_and_stats.sql",
  ),
  "utf8",
);

assert.match(
  highlightShareScore,
  /resolve_share_highlight_timeline\s*\(p_token text\)/,
);
assert.match(highlightShareScore, /output_start_s/);
assert.match(highlightShareScore, /output_end_s/);
assert.match(highlightShareScore, /sl\.kind in \('match', 'highlights'\)/);
assert.doesNotMatch(highlightShareScore, /grant\s+select\s+on\s+public\./i);
```

- [ ] **Step 2: Run the contract test and observe the missing-file failure**

Run:

```bash
node --test --experimental-strip-types src/lib/research/migration.test.ts
```

Expected: failure because the new migration file does not exist.

- [ ] **Step 3: Create the sanitized timeline resolver**

The migration drops and recreates functions whose return types change. The
new timeline function must use the token as the only credential and return no
detector evidence:

```sql
create function public.resolve_share_highlight_timeline(p_token text)
returns table (
  point_id uuid,
  output_start_s numeric,
  output_end_s numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (segment ->> 'point_id')::uuid,
    (segment ->> 'output_start_s')::numeric,
    (segment ->> 'output_end_s')::numeric
  from public.share_links sl
  join public.match_reels mr
    on mr.match_id = sl.match_id and mr.scope = 'highlights'
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(mr.manifest -> 'points') = 'array'
        then mr.manifest -> 'points'
      else '[]'::jsonb
    end
  ) segment
  where sl.token = p_token
    and sl.kind = 'highlights'
    and sl.revoked_at is null
    and mr.status = 'ready'
    and mr.r2_key is not null
    and jsonb_typeof(mr.manifest -> 'points') = 'array'
    and segment ? 'point_id'
    and segment ? 'output_start_s'
    and segment ? 'output_end_s'
  order by (segment ->> 'output_start_s')::numeric;
$$;

revoke execute on function public.resolve_share_highlight_timeline(text)
  from public;
grant execute on function public.resolve_share_highlight_timeline(text)
  to anon, authenticated;
```

Use the latest production definitions of `resolve_share_points` and
`resolve_share_placement` and change only their kind predicates from
`sl.kind = 'match'` to:

```sql
sl.kind in ('match', 'highlights')
```

Do not reconstruct an older resolver from migration 130 and thereby drop
columns added by later migrations.

- [ ] **Step 4: Run migration contract tests**

Run:

```bash
node --test --experimental-strip-types src/lib/research/migration.test.ts
```

Expected: all migration contract tests pass.

- [ ] **Step 5: Apply the migration to the local database and probe permissions**

Use the repository's local Supabase workflow. Verify:

```sql
select * from public.resolve_share_highlight_timeline('<valid token>');
select * from public.resolve_share_highlight_timeline('<revoked token>');
```

Expected: the valid token returns only selected point IDs and output bounds;
the revoked token returns zero rows. Direct anonymous reads of
`match_reels`, `points`, and `share_links` remain denied.

- [ ] **Step 6: Commit the database contract**

```bash
git add supabase/migrations/20260907180000_highlight_share_score_and_stats.sql src/lib/research/migration.test.ts
git commit -m "fix: expose scored context to highlight links"
```

### Task 2: One playback-timeline authority for public links

**Files:**
- Modify: `src/app/s/[token]/shareData.ts`
- Modify: `src/app/s/[token]/shareData.test.ts`

**Interfaces:**
- Produces: `PublicHighlightTimelineRow`.
- Produces: `SharePlaybackTimelineEntry`.
- Produces: `buildSharePlaybackTimeline(kind, points, highlights)`.
- Consumers: `page.tsx` and `ShareView.tsx`.

- [ ] **Step 1: Write failing match-clock and highlight-clock tests**

Add tests with three full-match points and two selected highlight segments:

```ts
test("highlight playback uses output time and keeps the full-match score index", () => {
  const sharePoint = (value: { id: string; cut_t0: number }) => ({
    id: value.id,
    idx: 0,
    t0: 0,
    t1: 8,
    cut_t0: value.cut_t0,
    clip_path: null,
    starred: false,
    is_let: false,
    confirmed_winner: null,
    game_end_override: null,
    game_winner_override: null,
    server: null,
    server_override: null,
    placement_flagged: false,
  });
  const points = [
    sharePoint({ id: "p1", cut_t0: 14 }),
    sharePoint({ id: "p2", cut_t0: 42 }),
    sharePoint({ id: "p3", cut_t0: 88 }),
  ];
  const result = buildSharePlaybackTimeline("highlights", points, [
    { point_id: "p2", output_start_s: 0, output_end_s: 8 },
    { point_id: "p3", output_start_s: 7.7, output_end_s: 18 },
  ]);
  assert.deepEqual(result, [
    { at: 0, end: 8, pointId: "p2", pointIndex: 1 },
    { at: 7.7, end: 18, pointId: "p3", pointIndex: 2 },
  ]);
});

test("an unknown or malformed highlight point is omitted", () => {
  const sharePoint = (value: { id: string; cut_t0: number }) => ({
    id: value.id,
    idx: 0,
    t0: 0,
    t1: 8,
    cut_t0: value.cut_t0,
    clip_path: null,
    starred: false,
    is_let: false,
    confirmed_winner: null,
    game_end_override: null,
    game_winner_override: null,
    server: null,
    server_override: null,
    placement_flagged: false,
  });
  const result = buildSharePlaybackTimeline("highlights", [
    sharePoint({ id: "p1", cut_t0: 14 }),
  ], [
    { point_id: "missing", output_start_s: 0, output_end_s: 8 },
    { point_id: "p1", output_start_s: Number.NaN, output_end_s: 8 },
  ]);
  assert.deepEqual(result, []);
});
```

Also assert that `kind = 'match'` still uses each point's `cut_t0` and full
point index.

- [ ] **Step 2: Run the focused test and observe missing exports**

Run:

```bash
node --test --experimental-strip-types 'src/app/s/[[]token[]]/shareData.test.ts'
```

Expected: failure because the timeline types and builder do not exist.

- [ ] **Step 3: Add the pure timeline types and builder**

Add:

```ts
export type PublicHighlightTimelineRow = {
  point_id: string;
  output_start_s: number;
  output_end_s: number;
};

export type SharePlaybackTimelineEntry = {
  at: number;
  end: number | null;
  pointId: string;
  pointIndex: number;
};

export function buildSharePlaybackTimeline(
  kind: "match" | "highlights",
  points: ResolvedSharePoint[],
  highlights: PublicHighlightTimelineRow[] = [],
): SharePlaybackTimelineEntry[] {
  const indexById = new Map(points.map((point, index) => [point.id, index]));
  if (kind === "match") {
    return points.flatMap((point, pointIndex) => {
      const at = Number(point.cut_t0);
      return point.cut_t0 !== null && Number.isFinite(at)
        ? [{ at, end: null, pointId: point.id, pointIndex }]
        : [];
    });
  }
  return highlights.flatMap((row) => {
    const pointIndex = indexById.get(row.point_id);
    const at = Number(row.output_start_s);
    const end = Number(row.output_end_s);
    return pointIndex !== undefined && Number.isFinite(at) && Number.isFinite(end) && end > at
      ? [{ at, end, pointId: row.point_id, pointIndex }]
      : [];
  });
}
```

Sort sanitized highlight rows by `at` before returning so a malformed database
ordering cannot move the score backward.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test --experimental-strip-types 'src/app/s/[[]token[]]/shareData.test.ts'
```

Expected: all share-data tests pass.

- [ ] **Step 5: Commit the clock authority**

```bash
git add 'src/app/s/[token]/shareData.ts' 'src/app/s/[token]/shareData.test.ts'
git commit -m "feat: map highlight output time to scored points"
```

### Task 3: Show score, result, analysis, and placement on highlight links

**Files:**
- Modify: `src/app/s/[token]/page.tsx`
- Modify: `src/app/s/[token]/ShareView.tsx`
- Modify: `src/app/api/share/highlightShare.ts`
- Modify: `src/app/api/share/highlightShare.test.ts`

**Interfaces:**
- Consumes: `resolve_share_highlight_timeline` rows.
- Consumes: `buildSharePlaybackTimeline()`.
- Produces: `sanitizeHighlightTimeline(value: unknown) -> PublicHighlightTimelineRow[]` in `highlightShare.ts`.
- Changes: `ShareView` receives `timeline: SharePlaybackTimelineEntry[]`.
- Preserves: match-link start seek and dead-span skipping only for whole-match playback.

- [ ] **Step 1: Add failing highlight-timeline validation tests**

Test that the public page accepts finite ordered rows and rejects unsafe or
unusable values:

```ts
test("sanitizes the public highlight timeline", () => {
  const POINT_ID = "00000000-0000-0000-0000-000000000001";
  assert.deepEqual(
    sanitizeHighlightTimeline([
      { point_id: POINT_ID, output_start_s: "0", output_end_s: "8.2" },
    ]),
    [{ point_id: POINT_ID, output_start_s: 0, output_end_s: 8.2 }],
  );
  assert.deepEqual(
    sanitizeHighlightTimeline([
      { point_id: "not-a-uuid", output_start_s: 0, output_end_s: 8 },
      { point_id: POINT_ID, output_start_s: 9, output_end_s: 8 },
    ]),
    [],
  );
});
```

- [ ] **Step 2: Run the focused public-share tests and observe failure**

Run:

```bash
node --test --experimental-strip-types src/app/api/share/highlightShare.test.ts 'src/app/s/[[]token[]]/shareData.test.ts'
```

Expected: failure because `sanitizeHighlightTimeline` is missing.

- [ ] **Step 3: Load scored context for both match and highlight pages**

In `page.tsx`, replace the match-only gates with an explicit scored-video
context:

```ts
const isScoredVideo = isMatch || isHighlights;
const points: ResolvedSharePoint[] = isScoredVideo
  ? await resolveSharePoints(token)
  : [];
const highlightRows = isHighlights
  ? sanitizeHighlightTimeline(await resolveHighlightTimeline(token))
  : [];
const playbackTimeline = buildSharePlaybackTimeline(
  isHighlights ? "highlights" : "match",
  points,
  highlightRows,
);
const scored =
  isScoredVideo &&
  link.show_score &&
  points.some((point) => !point.is_let && point.confirmed_winner !== null);
```

Keep `resolveShareSkips` behind `isMatch`. Compute result, serving, stats,
analysis, and maps from the complete point list for both match and highlight
links. Pass `playbackTimeline` into `ShareView`.

- [ ] **Step 4: Make ShareView use the supplied timeline**

Remove its local `cut_t0` timeline construction and accept:

```ts
timeline?: SharePlaybackTimelineEntry[];
```

Determine the active timeline row using `at <= playheadT`. Compute the score
entering the active rally with:

```ts
const upto = activeRow < 0 ? 0 : timeline[activeRow].pointIndex;
return computeMatchScore(asPoints.slice(0, upto));
```

Because the second segment begins at its crossfade-adjusted
`output_start_s`, the incoming point and its entering score own the overlap.
Enable previous/next rally navigation for both `match` and `highlights`, while
keeping the initial first-rally seek and dead-span skipping match-only.

- [ ] **Step 5: Add a calm invalid-timeline state**

If a highlight link has a ready video but zero valid selected timeline rows,
do not invent a score mapping. Render the existing unavailable media state:

```tsx
<p className="text-sm text-zinc-500">
  These highlights are unavailable right now.
</p>
```

Do not enqueue generation or regeneration from this public request.

- [ ] **Step 6: Run focused share tests**

Run:

```bash
node --test --experimental-strip-types src/app/api/share/highlightShare.test.ts 'src/app/s/[[]token[]]/shareData.test.ts'
```

Expected: all focused share tests pass.

- [ ] **Step 7: Commit the public page fix**

```bash
git add 'src/app/s/[token]/page.tsx' 'src/app/s/[token]/ShareView.tsx' src/app/api/share/highlightShare.ts src/app/api/share/highlightShare.test.ts
git commit -m "fix: show scored context on highlight links"
```

### Task 4: Unify public-link targets on iOS

**Files:**
- Modify: `ios/PongLens/PongLens/Screens/MatchTools.swift`
- Modify: `ios/PongLens/PongLens/Screens/HighlightsSheet.swift`
- Modify: `ios/PongLens/PongLens/Core/Models.swift`
- Modify: `ios/Tests/HighlightsTests.swift`
- Create: `ios/Tests/MatchToolsTests.swift`
- Modify: `ios/Tests/run.sh`
- Modify: `ios/Tests/main.swift`

**Interfaces:**
- Produces: `ShareLinkTarget` with `match`, `highlights`, and `starred`.
- Changes: `ShareLinksSheet` accepts `initialTarget`, `highlightsReady`, and `scored`.
- Changes: `HighlightsSheet` receives `scored` and opens `ShareLinksSheet(initialTarget: .highlights)`.
- Preserves: one active link per match and kind, native share, copy, QR, and Account revocation.

- [ ] **Step 1: Write failing pure iOS target tests**

Add `runMatchToolsChecks()` and verify availability and order:

```swift
func runMatchToolsChecks() {
    print("\n— match tools —")
    check(
        shareLinkTargets(processed: true, highlightsReady: true)
            == [.match, .highlights, .starred],
        "ready matches show the three primary public-link targets"
    )
    check(
        shareLinkTargets(processed: true, highlightsReady: false)
            == [.match, .starred],
        "the link sheet does not start missing highlights"
    )
    check(
        shareLinkTargets(processed: false, highlightsReady: false)
            == [.match],
        "unprocessed matches offer only their live whole-match link"
    )
}
```

Call `runMatchToolsChecks()` from `ios/Tests/main.swift`.

- [ ] **Step 2: Run the focused Swift tests and observe missing symbols**

Run:

```bash
ios/Tests/run.sh
```

Expected: compile failure because `ShareLinkTarget` and
`shareLinkTargets` do not exist.

- [ ] **Step 3: Add the target model and refactor ShareLinksSheet**

Define the pure model in `Core/Models.swift` so the app and shell harness use
the same availability rule:

```swift
enum ShareLinkTarget: String, CaseIterable, Hashable {
    case match
    case highlights
    case starred
}

func shareLinkTargets(
    processed: Bool,
    highlightsReady: Bool
) -> [ShareLinkTarget] {
    var targets: [ShareLinkTarget] = [.match]
    if highlightsReady { targets.append(.highlights) }
    if processed { targets.append(.starred) }
    return targets
}
```

Replace the two-segment selector with existing-style target rows so the three
labels remain readable at phone width. Selecting a target opens the existing
link creation content. Keep the target-specific link cache and reset QR,
copied, and errors when changing target.

POST bodies are:

```swift
// This match
{ "matchId": id, "showScore": showScore }

// Highlights
{ "matchId": id, "kind": "highlights", "showScore": showScore }

// Starred points
{ "matchId": id, "kind": "starred" }
```

Show **Include score and stats** for `.match` and `.highlights` when `scored`
is true. The navigation title and Tools row read **Share a link**.

- [ ] **Step 4: Replace direct highlight-link minting with the common composer**

In `AutomaticHighlightActions`, replace the direct link POST with a closure
that presents:

```swift
ShareLinksSheet(
    match: match,
    starredCount: starredCount,
    scored: scored,
    processed: true,
    initialTarget: .highlights,
    highlightsReady: true
)
```

Pass `scored` from `ToolsSection` through `HighlightsSheet`,
`HighlightsTakeover`, and `HighlightsShareSheet`. Preserve the player's Share
shortcut and the pre-play Highlights sheet as two entrances to the same
actions.

- [ ] **Step 5: Clarify video-only appearance settings**

Immediately before the three existing toggles, add existing typography only:

```swift
Text("Video appearance")
    .font(.plBody)
    .foregroundStyle(PL.text200)
Text("For Instagram and saved videos.")
    .font(.plCaption)
    .foregroundStyle(PL.text500)
```

Do not wrap this text or the toggles in another bordered panel. Confirm that
the three switches still feed only `StoryShareModel.prepareAuto`.

- [ ] **Step 6: Run focused and complete Swift harnesses**

Add `MatchToolsTests.swift` to the `swiftc` source list in `ios/Tests/run.sh`,
then run:

```bash
ios/Tests/run.sh
```

Expected: both commands pass.

- [ ] **Step 7: Commit the iOS link flow**

```bash
git add ios/PongLens/PongLens/Core/Models.swift ios/PongLens/PongLens/Screens/MatchTools.swift ios/PongLens/PongLens/Screens/HighlightsSheet.swift ios/Tests/HighlightsTests.swift ios/Tests/MatchToolsTests.swift ios/Tests/run.sh ios/Tests/main.swift
git commit -m "feat: unify iOS public link sharing"
```

### Task 5: Make Match analysis an inline destination and reorder Tools

**Files:**
- Modify: `ios/PongLens/PongLens/Screens/MatchTools.swift`
- Modify: `ios/PongLens/PongLens/Screens/MatchDetailScreen.swift`
- Modify: `ios/PongLens/PongLens/Screens/AnalysisSheet.swift`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/HighlightsRow.tsx`
- Create: `src/app/match/[id]/toolsStructure.test.ts`

**Interfaces:**
- Adds: iOS `onScrollToAnalysis: () -> Void`.
- Adds: iOS scroll ID `match-analysis`.
- Changes: `HighlightsRow` may report `HighlightState` upward through `onStateChange` without changing the GET lifecycle.
- Preserves: current analysis calculations and card rendering.

- [ ] **Step 1: Add the failing web structure contract**

Read `MatchView.tsx`, `HighlightsRow.tsx`, `ReelBar.tsx`, and
`ShareSheet.tsx` as strings. Assert:

```ts
assert.match(matchView, />Share a link</);
assert.ok(
  matchView.indexOf(">Match analysis<") <
    matchView.indexOf("<PlacementToolsRow"),
);
assert.ok(
  matchView.indexOf("<AnalysisCards") <
    matchView.indexOf("<PlacementAggregate"),
);
assert.doesNotMatch(reelBar, /Instagram Reel/);
assert.doesNotMatch(shareSheet, /With your coach/);
```

- [ ] **Step 2: Run the web structure test and observe failures**

Run:

```bash
node --test --experimental-strip-types 'src/app/match/[[]id[]]/toolsStructure.test.ts'
```

Expected: failures for the current label, order, Export Instagram row, and
coach action in Share.

- [ ] **Step 3: Reorder iOS Tools and replace the analysis sheet**

Order the applicable rows exactly as specified. Add
`onScrollToAnalysis` to `ToolsSection`, remove `analysisOpen` and its sheet,
and invoke the callback from Match analysis.

In `MatchDetailScreen`, after `pointsSection` and before placement, render:

```swift
if isOwner && tracksServe {
    VStack(alignment: .leading, spacing: 12) {
        SectionHeading("Match analysis")
        AnalysisCards(
            bundle: MatchAnalysisBundle(
                match: current,
                model: model,
                score: score
            ),
            coachView: false
        )
    }
    .id("match-analysis")
}
```

Wire the Tools callback to:

```swift
withAnimation { proxy.scrollTo("match-analysis", anchor: .top) }
```

Respect the app's existing reduced-motion handling if that path disables the
animation. Delete `AnalysisSheet` only after `rg 'AnalysisSheet'` proves no
caller remains; retain `AnalysisCards` and its file.

- [ ] **Step 4: Reorder and rename authenticated web Tools**

Move Match analysis before `PlacementToolsRow`, followed by Share a link,
Coach, and Export. Keep `scrollToSection(matchStatsRef)` and the existing lower
page order, where `AnalysisCards` already precedes placement.

Change the label to:

```tsx
<span className="text-sm font-semibold">Share a link</span>
```

Use `HighlightsRow.onStateChange` only to expose whether the ready Highlights
target belongs in the link sheet. The callback must not POST or enqueue work.

- [ ] **Step 5: Run focused web and Swift tests**

Run:

```bash
node --test --experimental-strip-types 'src/app/match/[[]id[]]/toolsStructure.test.ts' 'src/app/match/[[]id[]]/highlights.test.ts'
ios/Tests/run.sh
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit navigation and ordering**

```bash
git add ios/PongLens/PongLens/Screens/MatchTools.swift ios/PongLens/PongLens/Screens/MatchDetailScreen.swift ios/PongLens/PongLens/Screens/AnalysisSheet.swift 'src/app/match/[id]/MatchView.tsx' 'src/app/match/[id]/HighlightsRow.tsx' 'src/app/match/[id]/toolsStructure.test.ts'
git commit -m "feat: clarify match tools navigation"
```

### Task 6: Separate links, files, social sharing, and coach access

**Files:**
- Modify: `src/components/ShareSheet.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/ReelBar.tsx`
- Modify: `src/components/ShareWithCoach.tsx`
- Modify: `ios/PongLens/PongLens/Screens/MatchTools.swift`
- Modify: `src/app/match/[id]/toolsStructure.test.ts`
- Modify: `ios/Tests/MatchToolsTests.swift`

**Interfaces:**
- Web `ShareTarget` gains `highlights`.
- Web `ShareSheet` gains `initialTarget?: ShareTarget` and `highlightsReady?: boolean`.
- Export no longer exposes an Instagram destination.
- Coach creation still calls the existing invite and starter-pack stores once.

- [ ] **Step 1: Extend the failing structure and action-order tests**

Read `ShareWithCoach.tsx` into `shareWithCoach`, then assert the exact
public-link primary targets and coach action order:

```ts
assert.match(shareSheet, /This match/);
assert.match(shareSheet, /Highlights/);
assert.match(shareSheet, /Starred points/);
assert.ok(
  shareWithCoach.indexOf("Give them a head start") <
    shareWithCoach.indexOf("Create invite link"),
);
```

In Swift, add a pure array describing the new-invite form order and assert:

```swift
check(
    coachInviteCreationOrder.last == .createLink,
    "coach invite creation ends with its primary action"
)
check(
    coachInviteCreationOrder.firstIndex(of: .starterPack)! <
        coachInviteCreationOrder.firstIndex(of: .createLink)!,
    "starter selections come before invite creation"
)
```

- [ ] **Step 2: Run tests and observe current hierarchy failures**

Run:

```bash
node --test --experimental-strip-types 'src/app/match/[[]id[]]/toolsStructure.test.ts'
ios/Tests/run.sh
```

Expected: failures until Export, Share, and Coach are separated.

- [ ] **Step 3: Add Highlights to the web public-link sheet**

Extend the target union:

```ts
type ShareTarget = "link" | "highlights" | "starred" | `tag:${string}`;
```

Render primary rows in this order: This match, Highlights when ready, Starred
points. Preserve existing tag rows after them and preserve direct point
sharing. The highlight request body is:

```ts
{ matchId, kind: "highlights", title, showScore }
```

Show the score-and-stats setting for whole-match and highlight targets when
the match is scored. Accept `initialTarget` so a future web highlight-actions
surface can enter the same composer without a second implementation.

Remove the `With your coach` row and the `ShareWithCoachSheet` import from
`ShareSheet`; the Tools Coach row remains the single match-level entrance.

- [ ] **Step 4: Remove social sharing from Export**

In iOS `ExportSheet` and web `ReelBar`, keep:

- Full match
- Starred points
- Raw match

Remove the Instagram Reel row, state, and nested social sheet that are used
only by Export. Do not remove Instagram from automatic Highlights. Change the
Tools trailing copy to `Video files` when no active export state is more
useful. Keep `Include score` connected only to rendered Full match and Starred
points output; raw download ignores it.

- [ ] **Step 5: Reorder coach invitation creation**

On iOS and web, keep existing coaches and pending invitations above the new
invite form. Within the form, render in this order:

```text
Their name (optional)
This match / All my matches
Give them a head start
Starter match and journal selections
Existing concise access explanation
Create invite link
```

Move the existing primary button; do not add a second button or another
bordered container. The create handler must still create or name the invite,
then apply the currently selected starter pack as one user action.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test --experimental-strip-types 'src/app/match/[[]id[]]/toolsStructure.test.ts'
ios/Tests/run.sh
```

Expected: all focused structure and action tests pass.

- [ ] **Step 7: Commit the ownership cleanup**

```bash
git add src/components/ShareSheet.tsx 'src/app/match/[id]/MatchView.tsx' 'src/app/match/[id]/ReelBar.tsx' src/components/ShareWithCoach.tsx ios/PongLens/PongLens/Screens/MatchTools.swift 'src/app/match/[id]/toolsStructure.test.ts' ios/Tests/MatchToolsTests.swift
git commit -m "refactor: separate match sharing actions"
```

### Task 7: Full verification and visual acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-09-07-match-tools-sharing-simplification.md` only to append measured verification results during execution.

**Interfaces:**
- Produces: recorded evidence for tests, builds, viewports, and deployment readiness.

- [ ] **Step 1: Run focused web, migration, and Swift tests together**

Run:

```bash
node --test --experimental-strip-types src/lib/research/migration.test.ts src/app/api/share/highlightShare.test.ts 'src/app/s/[[]token[]]/shareData.test.ts' 'src/app/match/[[]id[]]/toolsStructure.test.ts' 'src/app/match/[[]id[]]/highlights.test.ts'
ios/Tests/run.sh
```

Expected: every listed test passes. Record counts and any skips.

- [ ] **Step 2: Run the complete production web build**

Run in the isolated worktree after ensuring no dev server shares its `.next`:

```bash
npm run build
```

Expected: exit 0 through compile, full type checking, and page generation.
Do not describe a separate filtered typecheck as build verification.

- [ ] **Step 3: Build native iOS for the simulator**

Run:

```bash
xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" CODE_SIGNING_ALLOWED=NO
```

Expected: `** BUILD SUCCEEDED **`. Record the simulator and OS actually used.

- [ ] **Step 4: Verify authenticated web at desktop and 393x660**

Inspect a ready scored match and a ready unscored match. Confirm:

- Tools keeps the approved card and row styling.
- Order and trailing values match the spec.
- Match analysis scrolls to the visible section above placement.
- Share a link shows readable targets without horizontal truncation.
- Highlights does not generate or update on open.
- Export has no Instagram row.
- Coach creation ends with Create invite link.
- No sheet or page has horizontal overflow at 393x660.

- [ ] **Step 5: Verify native iOS separately**

On the iPhone simulator, inspect the same states. Confirm 44pt targets,
Dynamic Type at one larger accessibility size, VoiceOver labels for rows and
statuses, Match analysis scrolling, the Highlights video-appearance helper,
the preselected highlight-link composer, Export, and Coach ordering.

- [ ] **Step 6: Verify a real scored public highlight link**

Create a highlight link for a private test match with at least two selected
rallies from different score states. At 393x660 and desktop width, verify:

- the first selected rally shows the score entering that rally;
- the score switches to the incoming rally at the start of the 0.3-second
  overlap;
- previous and next rally navigation stays inside the single video;
- result, analysis, and placement maps match the whole-match link;
- turning Include score and stats off hides all four scored elements;
- turning it back on updates the same URL;
- regenerating the reel keeps the token and updates its media and timeline;
- revoking the link prevents both page and media resolution.

- [ ] **Step 7: Run final hygiene checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only scoped files changed. Confirm the
original dirty main checkout was never altered by implementation work.

- [ ] **Step 8: Commit verification evidence**

Append the exact test counts, build result, simulator, browser sizes, and any
unverified production-only behavior to this plan, then commit:

```bash
git add docs/superpowers/plans/2026-09-07-match-tools-sharing-simplification.md
git commit -m "docs: record match tools verification"
```

### Task 8: Production release

**Files:**
- Create: `docs/releases/2026-09-07-match-tools-sharing-simplification.md`

**Interfaces:**
- Produces: deployed migration, production web release, and a verified iOS build ready for TestFlight or App Store distribution.

- [ ] **Step 1: Write the release note before deployment**

Record the user-visible changes, migration name, commit range, test counts,
web build result, native build result, and rollback order. State explicitly
that no highlight worker or quality rule changed.

- [ ] **Step 2: Apply the additive resolver migration**

Apply `20260907180000_highlight_share_score_and_stats.sql` using the existing
production migration procedure. Probe valid, revoked, match, and highlight
tokens without exposing table reads.

- [ ] **Step 3: Deploy web and wait for Ready**

Deploy the verified production commit through the repository's normal web
release path. Wait for the hosting deployment to report Ready before smoke
testing. Do not describe a queued deployment as complete.

- [ ] **Step 4: Run production web smoke checks**

Repeat Share a link, Match analysis anchor, Export, Coach, and scored public
highlight checks on `www.ponglens.com` at 393x660 and desktop width. Verify
that an existing highlight link still resolves.

- [ ] **Step 5: Produce the iOS release build**

Increment the build number only through the project's existing release
procedure, archive the verified commit, upload it, and wait until processing
completes. Record the build number and distribution state. Do not claim the
build is installed or approved unless that state is observed.

- [ ] **Step 6: Commit the release record**

```bash
git add docs/releases/2026-09-07-match-tools-sharing-simplification.md
git commit -m "docs: record match tools release"
```

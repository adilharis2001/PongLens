# Quality-first continuous highlights implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duration-filling automatic highlight selection with fail-closed rally evidence and play the result as one continuous worker-rendered video on web and iOS.

**Architecture:** The points pipeline persists versioned hit, connected-crossing, bounce, and observed-end evidence. A pure Python module is the only qualification and budgeting authority. The trusted worker renders and stores a revision-keyed continuous MP4 during match processing, while authenticated clients fetch its state and timeline instead of rebuilding the selection or seeking around the match cut.

**Tech Stack:** Python 3, pytest, FFmpeg/ffprobe, PostgreSQL/Supabase migrations and RLS, Next.js/TypeScript/React, Vitest, Swift/SwiftUI/AVFoundation, shell-based Swift tests.

**Spec:** `docs/superpowers/specs/2026-09-05-quality-first-continuous-highlights-design.md`

## Global constraints

- Automatic inclusion requires `n_hits >= 5`, `connected_crossings >= 4`, and `table_bounces >= 2`.
- Missing, legacy, edited, deleted, skipped, let, clipless, or unmapped evidence fails closed.
- The 150-, 60-, and 20-second values are ceilings, never fill targets.
- The worker is the only qualification authority; TypeScript and Swift must not duplicate thresholds.
- In-app playback uses one continuous MP4 and performs no rally-boundary seek.
- Automatic highlight failure is fail-soft and consumes no customer processing minutes.
- Existing starred, tagged, full-match, and vertical point exports keep their behavior.
- Keep `automatic_highlights` private and off through migration and client deployment.
- Preserve unrelated worktree changes and commit only files belonging to each task.
- Verify web at desktop and 393×660, then verify native iOS separately.

---

### Task 1: Database evidence and artifact states

**Files:**
- Create: `supabase/migrations/172_quality_first_highlights.sql`
- Test: `src/lib/research/migration.test.ts`

**Interfaces:**
- Produces: nullable `points.highlight_evidence jsonb`.
- Produces: `match_reels.scope = 'highlights'` and `status = 'empty'`.
- Produces: private `app_config.key = 'automatic_highlights'`, initially `off`.
- Produces: `points_invalidate_highlight_evidence()` trigger function.

- [x] **Step 1: Add a failing migration contract test**

Add assertions that migration 172 contains the new column, widens both reel checks, inserts a non-public switch, and installs a trigger for membership-changing point edits:

```ts
const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/172_quality_first_highlights.sql"),
  "utf8"
);
expect(sql).toContain("add column if not exists highlight_evidence jsonb");
expect(sql).toContain("'highlights'::text");
expect(sql).toContain("'empty'::text");
expect(sql).toContain("automatic_highlights");
expect(sql).toContain("points_invalidate_highlight_evidence");
```

- [x] **Step 2: Run the focused test and observe the missing-file failure**

Run: `node --test --experimental-strip-types src/lib/research/migration.test.ts`

Expected: failure because migration 172 does not exist.

- [x] **Step 3: Add migration 172**

The migration must:

```sql
alter table public.points
  add column if not exists highlight_evidence jsonb;

alter table public.match_reels drop constraint match_reels_status_check;
alter table public.match_reels add constraint match_reels_status_check
  check (status = any (array['queued'::text, 'rendering'::text,
                             'ready'::text, 'failed'::text, 'empty'::text]));
```

Copy the live scope constraint from migration 137 and add `highlights`. Insert
`automatic_highlights = off` using the current `app_config` schema without
adding it to the anonymous allow-list. Install a `before update` trigger that
sets `new.highlight_evidence = null` when `t0`, `t1`, `cut_t0`, `clip_path`,
`deleted`, or `edited` changes. A split child receives the column default and
therefore starts with null evidence.

- [x] **Step 4: Run migration tests**

Run: `node --test --experimental-strip-types src/lib/research/migration.test.ts`

Expected: all migration contract tests pass.

- [x] **Step 5: Commit the schema unit**

```bash
git add supabase/migrations/172_quality_first_highlights.sql src/lib/research/migration.test.ts
git commit -m "feat: add automatic highlight evidence schema"
```

### Task 2: Pure qualification, ranking, budgets, and revisions

**Files:**
- Create: `worker/highlights.py`
- Create: `worker/tests/test_highlights.py`

**Interfaces:**
- Produces: `qualifies(point: dict) -> bool`.
- Produces: `select_highlights(points: list[dict], max_seconds: float) -> list[dict]`.
- Produces: `build_manifest(points: list[dict], max_seconds: float = 150.0) -> dict`.
- Produces: `points_revision(points: list[dict]) -> str`.
- Manifest segment keys are `point_id`, `cut_start_s`, `cut_end_s`, `output_start_s`, `output_end_s`, `n_hits`, and `connected_crossings`.

- [x] **Step 1: Write failing selector tests**

Cover each threshold boundary independently, every missing field, edited and
deleted points, unused budget, skip-over of a long qualified point, match-order
output, deterministic revision, and crossfade-adjusted output positions:

```python
def test_never_fills_budget_with_unqualified_point():
    strong = point("strong", hits=8, crossings=7, bounces=4, seconds=12)
    weak = point("weak", hits=2, crossings=1, bounces=1, seconds=8)
    result = select_highlights([strong, weak], 60)
    assert [p["id"] for p in result] == ["strong"]

def test_exact_v1_threshold_qualifies():
    assert qualifies(point("p", hits=5, crossings=4, bounces=2, seconds=9))
```

- [x] **Step 2: Run the focused tests and observe import failure**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_highlights.py -q`

Expected: failure because `worker.highlights` does not exist.

- [x] **Step 3: Implement the pure module**

Use constants `MIN_HITS = 5`, `MIN_CONNECTED_CROSSINGS = 4`,
`MIN_TABLE_BOUNCES = 2`, `AUTO_MAX_S = 150.0`, and `XFADE_S = 0.3`.
Qualification validates `highlight_evidence.v == 1`, `status == 'ready'`,
the three thresholds, a finite observed end inside the point, clip/cut bounds,
and untouched visibility state. Ranking is:

```python
key = (
    min(evidence["n_hits"], evidence["connected_crossings"] + 1),
    evidence["connected_crossings"],
    evidence["observed_end_s"] - point["t0"],
    -point["idx"],
)
```

Greedily admit only qualified points whose real segment cost fits, then return
them in `idx` order. Hash canonical JSON containing selected IDs, current cut
bounds, visibility/edit state, and evidence version. Compute output positions
with 0.3 seconds of overlap after the first segment.

- [x] **Step 4: Run selector tests**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_highlights.py -q`

Expected: all selector tests pass.

- [x] **Step 5: Commit the selector unit**

```bash
git add worker/highlights.py worker/tests/test_highlights.py
git commit -m "feat: select only evidenced highlight rallies"
```

### Task 3: Persist measured evidence from the v2 points pipeline

**Files:**
- Modify: `worker/points_pipeline.py`
- Modify: `worker/worker.py`
- Create: `worker/tests/test_highlight_evidence.py`
- Modify: `worker/tests/test_points_pipeline.py`

**Interfaces:**
- Consumes: v2 `Evidence.cross`, `Evidence.bt_table`, card source bounds, the
  `fit_play` result, and `end_evidence_s`.
- Produces: each match JSON point has `highlight_evidence`.
- Produces: `insert_points()` writes `points.highlight_evidence` and returns
  `cut_t0`, `rally_end_cut_s`, `clip_path`, and evidence for manifest building.

- [x] **Step 1: Write failing evidence tests**

Build small source-clock fixtures showing that only the longest crossing cluster
within `CROSS_GAP_S` counts, bounces are limited to the calibrated table and
card window, and hit count remains available when winner classification is
inconclusive:

```python
assert evidence["n_hits"] == 6
assert evidence["connected_crossings"] == 5
assert evidence["table_bounces"] == 3
assert evidence["observed_end_s"] == 14.2
assert evidence["status"] == "ready"
```

Add unavailable fixtures for v1, missing table, missing candidates, missing
crossing chain, and failed shot counting.

- [x] **Step 2: Run the focused evidence tests and observe failures**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_highlight_evidence.py worker/tests/test_points_pipeline.py -q`

Expected: assertions fail because match JSON and inserts contain no highlight evidence.

- [x] **Step 3: Measure v1 evidence in source time**

Add a focused helper that receives card bounds, `v2_E`, and the `fit_play`
result. Persist `classify_play(...)["n_hits"]` even when `winner_side` is null.
Derive the longest ordered crossing chain inside the card, count `bt_table`
events inside it, constrain `end_evidence_s` to the point, and write stable
unavailable reason strings when any required measurement is absent.

- [x] **Step 4: Pass evidence through match JSON and point insertion**

Add `highlight_evidence` to the point dictionary and to `insert_points()`:

```python
"suggestion, cut_t0, rally_end_cut_s, highlight_evidence) "
"values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
```

Return enough stored point data from `insert_points()` for the selector without
re-querying or mixing source and cut clocks.

- [x] **Step 5: Run evidence and existing points tests**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_highlight_evidence.py worker/tests/test_points_pipeline.py worker/tests/test_points_v2_rally_end.py -q`

Expected: all listed tests pass.

- [x] **Step 6: Commit the evidence unit**

```bash
git add worker/points_pipeline.py worker/worker.py worker/tests/test_highlight_evidence.py worker/tests/test_points_pipeline.py
git commit -m "feat: record trustworthy rally evidence"
```

### Task 4: Render and store the automatic continuous MP4

**Files:**
- Modify: `worker/worker.py`
- Create: `worker/tests/test_auto_highlight_render.py`
- Modify: `worker/tests/test_worker.py`

**Interfaces:**
- Consumes: `build_manifest()` output and the local cut path.
- Produces: `render_auto_highlights(manifest: dict, cut_local: str, workdir: str) -> tuple[str, dict]`.
- Produces: `prepare_auto_highlights(conn, user_id, match_id, points, cut_local, enabled) -> str` returning `ready`, `empty`, `failed`, or `off`.

- [x] **Step 1: Write failing synthetic renderer tests**

Generate short color/test-source inputs with mixed frame rates and missing
audio. Assert one MP4, H.264/yuv420p, at most one-second GOP, AAC stereo,
fast-start placement, positive monotonic timestamps, correct frame mapping, and
manifest duration after 0.3-second overlaps.

- [x] **Step 2: Run focused renderer tests and observe missing functions**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_auto_highlight_render.py -q`

Expected: failures because the automatic renderer is absent.

- [x] **Step 3: Implement a separate automatic renderer**

Normalize every cut segment to one even resolution and a 24–60 FPS source rate.
Create silent stereo audio for any audio-less segment. Use existing
`_run_ffmpeg_encoded()` with one-second keyframes, xfade/acrossfade, yuv420p,
AAC 48 kHz stereo, `+faststart`, and no cards, watermark, score, or outro.
Probe the final file and write measured `output_start_s`/`output_end_s` values
back into the returned manifest.

- [x] **Step 4: Implement fail-soft storage orchestration**

Read the private switch once per match. Upsert `(match_id, 'highlights')` as
`empty`, `rendering`, `ready`, or `failed`; use
`reels/<match>-highlights-<revision prefix>.mp4`; book storage as `reel`; and
delete/negate the previous revision only after the replacement upload succeeds.
Call the stage after point IDs are inserted and before `finish_match(...,
'ready')`. Wrap the entire stage so it can record `failed` but cannot fail the
match or add customer minutes.

- [x] **Step 5: Run renderer and worker orchestration tests**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_auto_highlight_render.py worker/tests/test_worker.py -q`

Expected: all listed tests pass, including empty and forced-render-failure cases.

- [x] **Step 6: Commit the render unit**

```bash
git add worker/worker.py worker/tests/test_auto_highlight_render.py worker/tests/test_worker.py
git commit -m "feat: render continuous automatic highlights"
```

### Task 5: Authenticated highlight state and regeneration API

**Files:**
- Create: `src/app/api/highlights/route.ts`
- Create: `src/app/api/highlights/highlightsRoute.test.ts`
- Modify: `src/app/api/reel/route.ts`
- Modify: `src/app/api/media-url/route.ts`

**Interfaces:**
- Produces: `GET /api/highlights?matchId=<uuid>` returning `ready`, `rendering`,
  `empty`, `unavailable`, or `failed`.
- Ready shape: `{status:"ready", url, durationS, manifest}`.
- Consumes: owner RLS, private switch, `match_reels`, current point boundaries,
  and the stored manifest revision.

- [ ] **Step 1: Write failing route tests**

Test authentication, ownership, switch-off behavior, R2-prefix validation,
ready signing, empty/failed states, stale revision enqueue, cut-retention
unavailable, and single-job deduplication.

- [ ] **Step 2: Run route tests and observe missing route failure**

Run: `node --test --experimental-strip-types src/app/api/highlights/highlightsRoute.test.ts`

Expected: failure because the route does not exist.

- [ ] **Step 3: Implement the read/freshness route**

Use the established server Supabase and R2 signing helpers. Never return or
sign a row the authenticated owner cannot select. Validate `r2_key` begins
with `reels/`. If the stored revision is stale, enqueue the existing `reel`
job with `scope: 'highlights'` only when the cut exists, otherwise return
`unavailable`.

- [ ] **Step 4: Teach reel processing the highlights scope**

Allow only the exact non-vertical `highlights` scope, rebuild membership via
the Python authority rather than client JSON, and retain revision-keyed
automatic files. Keep current share/export scopes unchanged.

- [ ] **Step 5: Run API and media tests**

Run: `node --test --experimental-strip-types src/app/api/highlights/highlightsRoute.test.ts`

Expected: all listed tests pass.

- [ ] **Step 6: Commit the API unit**

```bash
git add src/app/api/highlights src/app/api/reel/route.ts src/app/api/media-url/route.ts
git commit -m "feat: serve automatic highlight assets"
```

### Task 6: Web continuous playback and product states

**Files:**
- Modify: `src/app/match/[id]/HighlightsRow.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/Player.tsx`
- Delete: `src/app/match/[id]/highlights.ts`
- Modify: `src/app/match/[id]/highlights.test.ts`
- Modify: `src/app/match/[id]/playerStructure.test.ts`

**Interfaces:**
- Consumes: the server highlight state and output timeline.
- Produces: `PlayerHandle.openHighlights(asset, onDownload)` where `asset`
  contains one signed URL, duration, and manifest.

- [ ] **Step 1: Replace picker tests with failing server-state tests**

Assert the row renders exact ready/rendering/empty/failed copy, has no
Short/Long chooser, and enables playback only for ready. Add a structural test
that highlight mode selects one video URL and contains no assignment of
`currentTime` for automatic rally transitions.

- [ ] **Step 2: Run the affected web tests and observe failures**

Run: `node --test --experimental-strip-types 'src/app/match/[id]/highlights.test.ts' 'src/app/match/[id]/playerStructure.test.ts'`

Expected: failures against the client picker and boundary-seek implementation.

- [ ] **Step 3: Make the row server-authoritative**

Fetch `/api/highlights`, poll only while rendering, show `Preparing highlights`,
`No highlight rallies`, or `Highlights unavailable`, and show
`<count> rallies · <duration>` when ready. Remove the chooser and pass the
asset directly to the player. Keep the row in its existing Tools card and use
the existing row/button styling.

- [ ] **Step 4: Add dedicated continuous source mode to Player**

Store the highlight asset separately from the match-cut URL. On open, swap the
video element to that one URL, start at zero, disable deleted-span/tape jumps
and scoring pause boundaries, and map output time to point ID using the
manifest. Closing restores the match-cut URL and its prior cut time. Previous
and next use output positions; natural transitions never assign
`currentTime`.

- [ ] **Step 5: Run affected and match-structure tests**

Run: `node --test --experimental-strip-types 'src/app/match/[id]/highlights.test.ts' 'src/app/match/[id]/playerStructure.test.ts'`

Run: `npm run test:match-structure`

Expected: all listed tests pass.

- [ ] **Step 6: Commit the web unit**

```bash
git add 'src/app/match/[id]/HighlightsRow.tsx' 'src/app/match/[id]/MatchView.tsx' 'src/app/match/[id]/Player.tsx' 'src/app/match/[id]/highlights.test.ts' 'src/app/match/[id]/playerStructure.test.ts'
git rm 'src/app/match/[id]/highlights.ts'
git commit -m "feat: play one continuous highlight on web"
```

### Task 7: iOS continuous playback and product states

**Files:**
- Modify: `ios/PongLens/PongLens/Core/Models.swift`
- Delete: `ios/PongLens/PongLens/Core/Highlights.swift`
- Modify: `ios/PongLens/PongLens/Screens/HighlightsSheet.swift`
- Modify: `ios/PongLens/PongLens/Screens/MatchTools.swift`
- Modify: `ios/PongLens/PongLens/Screens/PlayerTakeover.swift`
- Modify: `ios/Tests/HighlightsTests.swift`
- Modify: `ios/Tests/PlayerTakeoverTests.swift`
- Delete: `ios/Tests/fixtures/highlights-parity.json`

**Interfaces:**
- Consumes: the same `GET /api/highlights` states and manifest as web.
- Produces: one `AVPlayerItem` highlight mode with output-time point mapping and
  no rally-boundary observer.

- [ ] **Step 1: Write failing Swift tests**

Replace picker parity assertions with JSON decode, state-copy, and output-time
mapping tests. Assert highlight mode does not install the boundary-seek
observer and previous/next maps to manifest output positions.

- [ ] **Step 2: Run focused Swift tests and observe failures**

Run: `ios/Tests/run.sh HighlightsTests PlayerTakeoverTests`

Expected: failures because the models and continuous mode do not exist.

- [ ] **Step 3: Add API models and row state**

Decode `status`, `url`, `durationS`, and manifest points with snake-case point
fields. Fetch on sheet/row appearance, poll rendering with cancellation, use
the same four strings as web, and remove Short/Long selection.

- [ ] **Step 4: Add one-item highlight mode**

Create one `AVPlayerItem` from the signed highlight URL. Do not build boundary
observers that seek between cut positions. Map visible point and previous/next
through `output_start_s` and `output_end_s`; closing restores normal match
playback. Keep the existing native layout and touch-target conventions.

- [ ] **Step 5: Run iOS tests and build**

Run: `ios/Tests/run.sh`

Run the repository's documented `xcodebuild` command for the PongLens scheme.

Expected: all shell tests and the native build pass.

- [ ] **Step 6: Commit the iOS unit**

```bash
git add ios/PongLens/PongLens/Core/Models.swift ios/PongLens/PongLens/Screens/HighlightsSheet.swift ios/PongLens/PongLens/Screens/MatchTools.swift ios/PongLens/PongLens/Screens/PlayerTakeover.swift ios/Tests/HighlightsTests.swift ios/Tests/PlayerTakeoverTests.swift
git rm ios/PongLens/PongLens/Core/Highlights.swift ios/Tests/fixtures/highlights-parity.json
git commit -m "feat: play one continuous highlight on iOS"
```

### Task 8: Full verification, canary, and production worker activation

**Files:**
- Modify: `worker/README.md` only if the production restart or switch procedure is absent.
- Modify: `docs/superpowers/plans/2026-09-05-quality-first-continuous-highlights.md` to check completed steps and record commands.

**Interfaces:**
- Consumes: all preceding units.
- Produces: verified release evidence and an enabled canary worker.

- [ ] **Step 1: Run complete affected worker tests**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_highlights.py worker/tests/test_highlight_evidence.py worker/tests/test_auto_highlight_render.py worker/tests/test_points_pipeline.py worker/tests/test_points_v2_rally_end.py worker/tests/test_worker.py -q`

Expected: zero failures.

- [ ] **Step 2: Run the real web build and tests**

Use an isolated worktree with its own `.next` if a dev server is running.

Run: `npm run test:match-structure`

Run: `npm run build`

Expected: both exit zero.

- [ ] **Step 3: Run full iOS verification**

Run: `ios/Tests/run.sh`

Run the documented native build/test command.

Expected: zero failures and successful build.

- [ ] **Step 4: Apply migration with the switch off**

Use the repository's documented direct production migration procedure. Query
the resulting column, scope check, status check, trigger, and private config row
before proceeding. Do not enable anonymous access to the key.

- [ ] **Step 5: Deploy clients and restart the production Mac worker**

Confirm the startup/version line matches the released source. Keep cloud
dispatch disabled because no matching Modal implementation exists in this
repository.

- [ ] **Step 6: Enable only an internal canary and process five matches**

Review every selected rally and every rendered transition on web and native
iOS. Confirm no selected point violates a threshold, no boundary seek occurs,
and no match fails because highlights fail.

- [ ] **Step 7: Record what was and was not verified**

Add the exact commands, counts, device/simulator, desktop browser, 393×660
browser, canary match IDs, selection review counts, and any unverified item to
the final handoff. Do not claim production-safe or globally enabled without
that evidence.

- [ ] **Step 8: Commit verification documentation**

```bash
git add docs/superpowers/plans/2026-09-05-quality-first-continuous-highlights.md worker/README.md
git commit -m "docs: record highlight release verification"
```

# Temporal Serve Results Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a protected, read-only 24-point review of the held-out temporal serve experiment inside `/research/serve-detection`.

**Architecture:** A deterministic Python publisher converts the sealed holdout predictions into a dedicated research batch and copies only the selected clips into the existing protected research media namespace. The Next.js page queries that batch separately from writable labeling assignments and renders it through a focused client component with one active video, exact timestamp jumps, honest full-cohort metrics, and no mutation controls.

**Tech Stack:** Python 3.11+, unittest, Supabase/Postgres REST, Cloudflare R2/boto3, Next.js 15, React 19, TypeScript, Tailwind CSS, Node test runner.

## Global Constraints

- Publish exactly 24 unique holdout points: eight correct, eight wrong, and eight withheld when each stratum has enough candidates.
- Keep clips protected by assignment-based RLS and `/api/research/media`.
- Never modify the existing serve-detection batch, its assignments, or its labels.
- Headline metrics come from all 403 held-out points, not the curated sample.
- Expected server is labeled `PongLens score rotation; not an independent visual adjudication`.
- The results mode is read-only and does not change production scoring behavior.
- Reuse RTMPose/MMPose Apache 2.0 and production BlurBall-derived evidence; add no YOLO, Ultralytics, OpenPose, or AGPL dependency.

---

### Task 1: Deterministic held-out result selection

**Files:**
- Create: `worker/publish_temporal_serve_results.py`
- Create: `worker/tests/test_publish_temporal_serve_results.py`

**Interfaces:**
- Consumes: `manifest.json` and `results.json` from `temporal-serve-scale-v1`.
- Produces: `validate_experiment(manifest, results)`, `classify_prediction(row)`, and `select_review_sample(manifest, results, total=24, per_stratum=8, per_match_cap=3)`.

- [ ] **Step 1: Write failing selection tests**

Add fixtures with correct, wrong, and withheld holdout rows across multiple matches. Assert that hash mismatches raise `ValueError`, train/development rows are ignored, output is deterministic, each stratum contains eight items, source IDs are unique, and the first selection pass caps a match at three items per stratum.

- [ ] **Step 2: Run the tests and verify the expected import failure**

Run:

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_publish_temporal_serve_results -v
```

Expected: FAIL because `worker.publish_temporal_serve_results` does not exist.

- [ ] **Step 3: Implement validation, classification, and stable selection**

Implement `OUTCOMES = ("correct", "wrong", "withheld")`. A high-confidence fused side matching truth is correct; a high-confidence disagreement is wrong; every other row is withheld. Rank by fused confidence descending, raw `abs(near-far)` descending, then source ID. Resolve each result row to the matching sealed holdout point by `source_id`, attach `model_input.clip_uri`, and reject duplicate/missing sources.

- [ ] **Step 4: Run the selector tests green**

Run the Task 1 test command. Expected: all tests PASS.

- [ ] **Step 5: Commit the selector**

```bash
git add worker/publish_temporal_serve_results.py worker/tests/test_publish_temporal_serve_results.py
git commit -m "feat: select temporal serve result review"
```

### Task 2: Idempotent protected-batch publisher

**Files:**
- Modify: `worker/publish_temporal_serve_results.py`
- Modify: `worker/tests/test_publish_temporal_serve_results.py`

**Interfaces:**
- Consumes: the selected rows from Task 1 plus the existing `Production` R2/Supabase adapter.
- Produces: `build_result_proposal(item, video, experiment)`, `seed_results(production, manifest, results)`, `audit_results(production)`, and CLI commands `build-sample`, `seed`, and `audit`.

- [ ] **Step 1: Write failing proposal and row-construction tests**

Assert that proposals include outcome, predicted/expected sides, confidence, reason, raw probabilities, onset, first/second bounces, model/checkpoint hashes, video metadata, and the sealed manifest hash. Assert stable UUID/media keys under `research/serve-detection/v4/sources`, draft-before-active batch status, assignment rows for every reviewer from the original serve batch, and provenance that explicitly says the truth is rotation-derived.

- [ ] **Step 2: Run tests and verify missing publisher behavior**

Run the Task 1 test command. Expected: FAIL on missing proposal/seed helpers.

- [ ] **Step 3: Implement build, seed, CLI, and audit**

Reuse `Production`, `parse_r2_uri`, `probe_video`, `stable_uuid`, and SHA/canonical-hash helpers from the existing research publisher. Verify the current point `clip_path` equals the sealed URI and its downloaded SHA equals the sealed `media_sha256`. Upsert a separate batch, sources, gold labels, and assignments; never update rows belonging to another batch. Audit 24 sources, 24 gold labels, 24 unique point IDs, exact stratum counts, one complete queue per original serve reviewer, matching hashes, and all R2 objects before changing status to active.

- [ ] **Step 4: Run publisher tests green**

Run the Task 1 test command. Expected: all tests PASS.

- [ ] **Step 5: Build and inspect the real 24-item sample locally**

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m worker.publish_temporal_serve_results build-sample \
  --manifest /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/manifest.json \
  --results /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/results.json \
  --output /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/review-sample.json
```

Expected: 24 unique holdout sources, eight per outcome, with match diversity and the Chris canary represented only if its ranking earns a slot.

- [ ] **Step 6: Commit the publisher**

```bash
git add worker/publish_temporal_serve_results.py worker/tests/test_publish_temporal_serve_results.py
git commit -m "feat: publish protected temporal serve results"
```

### Task 3: Result types and pure view behavior

**Files:**
- Modify: `src/app/research/serve-detection/types.ts`
- Create: `src/app/research/serve-detection/temporalServeResultsView.ts`
- Create: `src/app/research/serve-detection/temporalServeResultsView.test.ts`

**Interfaces:**
- Consumes: `proposal.temporal_result` from Task 2.
- Produces: `TemporalServeResultAssignment`, `TemporalServeResultSummary`, `filterTemporalServeResults`, `temporalResultJumpTargets`, `temporalResultBadge`, and the frozen `TEMPORAL_SERVE_RESULT_SUMMARY`.

- [ ] **Step 1: Write failing TypeScript behavior tests**

Assert outcome/match filters preserve source order, the badge is correct/wrong/withheld from the stored stratum, invalid/negative timestamps are omitted, jump targets use exact timestamps without padding, and summary copy reports 786 points, 22 matches, 403 holdout points, 48.9% raw accuracy, 52.4% fused precision, 5.2% fused coverage, `research_only`, 6.076761 seconds/point, and $0.0675/100 points.

- [ ] **Step 2: Run tests and verify the expected import failure**

```bash
node --test --experimental-strip-types src/app/research/serve-detection/temporalServeResultsView.test.ts
```

Expected: FAIL because the view module does not exist.

- [ ] **Step 3: Implement types and pure helpers**

Keep the result proposal separate from writable `ServeDetectionProposal`. Validate timestamps with `Number.isFinite` and `>= 0`. Export stable labels `Model onset`, `Placement first bounce`, and `Placement second bounce`.

- [ ] **Step 4: Run TypeScript tests green**

Run the Task 3 test command. Expected: all tests PASS.

- [ ] **Step 5: Commit view behavior**

```bash
git add src/app/research/serve-detection/types.ts src/app/research/serve-detection/temporalServeResultsView.ts src/app/research/serve-detection/temporalServeResultsView.test.ts
git commit -m "feat: model temporal serve result review"
```

### Task 4: Read-only results interface and server query

**Files:**
- Create: `src/app/research/serve-detection/TemporalServeResults.tsx`
- Modify: `src/app/research/serve-detection/ServeDetectionLabeler.tsx`
- Modify: `src/app/research/serve-detection/page.tsx`
- Modify: `src/app/research/serve-detection/serveDetectionView.test.ts`

**Interfaces:**
- Consumes: `initialResultAssignments` and `TEMPORAL_SERVE_RESULT_SUMMARY`.
- Produces: an optional first `Latest results` tab and the one-video-at-a-time protected review workspace.

- [ ] **Step 1: Add a failing mode-isolation test**

Add a pure assertion that results assignments are kept separate from writable label queues and that the default workspace is `results` only when results are present. The production change that makes this pass is the new `initialServeWorkspace` helper and separate page props.

- [ ] **Step 2: Run the serve view tests red**

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts src/app/research/serve-detection/temporalServeResultsView.test.ts
```

Expected: FAIL because `initialServeWorkspace` is missing.

- [ ] **Step 3: Implement the component and query**

Query `serve-detection-temporal-results-v1` separately for the signed-in reviewer. Add a `Latest results` button to the existing header and render `TemporalServeResults` when selected. The component requests media only for its active assignment, applies quarter-speed playback, supports ±1/±2/±3 frames, exact timestamp jumps, outcome/match filtering, previous/next navigation, and the full-cohort summary. Show expected truth as `Rotation-derived` and include the onset-ground-truth caveat. Render no save, label, reviewer-assignment, or export controls in results mode.

- [ ] **Step 4: Run focused UI tests green**

Run the Task 4 test command. Expected: all tests PASS.

- [ ] **Step 5: Run type checking and touched-file lint**

```bash
npx tsc --noEmit
npx eslint src/app/research/serve-detection/page.tsx src/app/research/serve-detection/ServeDetectionLabeler.tsx src/app/research/serve-detection/TemporalServeResults.tsx src/app/research/serve-detection/types.ts src/app/research/serve-detection/serveDetectionView.ts src/app/research/serve-detection/temporalServeResultsView.ts
```

Expected: both commands exit zero.

- [ ] **Step 6: Commit the interface**

```bash
git add src/app/research/serve-detection
git commit -m "feat: add temporal serve results review"
```

### Task 5: Publish, verify, and deploy

**Files:**
- Generate outside git: `/Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/review-sample.json`
- Modify only if verification exposes a defect in Tasks 1–4.

**Interfaces:**
- Consumes: completed publisher and UI.
- Produces: active protected research batch plus verified production page.

- [ ] **Step 1: Run complete automated verification**

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest discover -s worker/tests -p 'test_*.py'
npm run test:research
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts src/app/research/serve-detection/temporalServeResultsView.test.ts
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all tests, type checking, build, and diff checks pass.

- [ ] **Step 2: Seed and audit the protected result batch**

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m worker.publish_temporal_serve_results seed \
  --manifest /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/manifest.json \
  --results /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/results.json
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m worker.publish_temporal_serve_results audit
```

Expected: an active batch with 24 sources, 24 gold labels, exact 8/8/8 outcomes, complete reviewer queues, valid object heads, and unchanged existing labeling assignments.

- [ ] **Step 3: Merge the verified branch to `main` and push the authorized research-page publication**

Capture the worktree metadata, update `main` without destructive commands, merge `codex/service-motion-first-server`, rerun the production build, and push `main`. Do not force-push.

- [ ] **Step 4: Verify the hosted authenticated page**

Open `https://www.ponglens.com/research/serve-detection` in the signed-in in-app browser. Confirm the latest-results tab, full-cohort metrics, 24-item navigation, outcome/match filters, protected video playback, exact jumps, frame controls, and absence of write controls. Confirm the existing labeling tabs still open and retain their prior completion states.

- [ ] **Step 5: Report the deployed URL and evidence**

Report the production URL, selected strata/matches, exact verification counts, batch audit, deployment commit, and any explicit limitations. Do not describe the detector as production-ready.

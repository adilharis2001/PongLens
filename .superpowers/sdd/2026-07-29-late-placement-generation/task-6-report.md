# Task 6: 30-Day Retention, Legal Copy, and Operator Documentation

## Status

Complete. Raw-upload retention and placement eligibility now use 30 days,
with placement expiry calculated from the original source job's `created_at`.

## TDD evidence

### RED

Added `worker/tests/test_raw_retention.py` and extended the initial placement
failure email test before changing production code.

Command:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_raw_retention \
  worker.tests.test_placement_notifications -v
```

Result: 8 tests ran; 2 expected failures:

- `R2_RAW_RETENTION_DAYS` was `7`, not `30`.
- The initial placement-failure email did not contain `30 days` and still
  contained `seven days`.

### GREEN

After the runtime and copy changes, the same focused command passed: 8 tests,
0 failures.

## Implementation

- `worker/worker.py` sets `R2_RAW_RETENTION_DAYS = 30`, documents the raw
  sweep as 30 days, and uses `jobs.created_at + interval '30 days'` for both
  `not_requested` and `retry_available` placement states.
- The expiry-normalization sweep remains restricted to `retry_available`, so
  an expired unattempted `not_requested` match is not incorrectly changed to
  `final_failed`.
- The initial placement-failure email, raw-export guidance, legal/homepage
  copy, API/UI comments, R2 documentation, and worker/operator documentation
  all state 30 days. Processed cut-video, clip, voice, and legacy-upload
  retention periods were not changed.
- The earlier placement-retry spec and plan now carry a dated supersession
  note instead of having their historical architecture rewritten.

## Verification

Commands run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest \
  worker.tests.test_raw_retention \
  worker.tests.test_placement_notifications -v
npm run test:learn
npx eslint src/app/privacy/page.tsx src/app/terms/page.tsx \
  src/app/page.tsx src/app/learn/guides.ts
rg -n "7 days|seven days|7-day|seven-day" \
  src/app/privacy/page.tsx \
  src/app/terms/page.tsx \
  src/app/page.tsx \
  src/app/learn/guides.ts \
  src/app/api/media-url/route.ts \
  'src/app/match/[id]/ReelBar.tsx' \
  src/lib/r2.ts worker/README.md worker/worker.py supabase/README-SETUP.md
git diff --check
```

Results:

- Worker focused suite: 8 passed.
- Learn suite: 4 passed.
- ESLint: passed with no diagnostics.
- Retention-copy scan: zero matches.
- `git diff --check`: passed with no output.

The intentional pre-rollout migration guard was separately verified unchanged:

```bash
rg -n "j\\.created_at >= now\\(\\) - interval '7 days'" \
  supabase/migrations/055_late_placement_generation.sql
```

Result: the expected two migration-only matches remain on lines 19 and 27.

## Files changed

- `worker/worker.py`
- `worker/tests/test_raw_retention.py`
- `worker/tests/test_placement_notifications.py`
- `worker/README.md`
- `src/lib/r2.ts`
- `src/app/privacy/page.tsx`
- `src/app/terms/page.tsx`
- `src/app/page.tsx`
- `src/app/learn/guides.ts`
- `src/app/api/media-url/route.ts`
- `src/app/match/[id]/ReelBar.tsx`
- `supabase/README-SETUP.md`
- `docs/superpowers/specs/2026-07-29-placement-retry-recovery-design.md`
- `docs/superpowers/plans/2026-07-29-placement-retry-recovery.md`

## Self-review

- Confirmed the placement deadline is based on the source job timestamp, not
  completion time or retry request time.
- Confirmed `not_requested` receives an eligibility deadline but is never
  normalized into `final_failed` solely because that deadline elapsed.
- Confirmed every requested public/legal/operator surface reports 30 days and
  none retains a live seven-day raw-retention statement.
- Confirmed existing processed-media and non-retention policies are unchanged.

## Concerns

None. `npm run test:learn` emits the repository's existing Node
`MODULE_TYPELESS_PACKAGE_JSON` warning; the suite still passes.

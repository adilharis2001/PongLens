# Audio Impact Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the protected desktop audio-impact labeler, reproducible 90-point corpus builder, and offline model-evaluation path described by the approved design.

**Architecture:** Reuse the existing research batch/source/assignment tables and protected media signer. Keep label state and candidate selection in pure modules with exhaustive tests; the React page only coordinates playback, persistence, and navigation. Extend the offline Python research tooling for dual-band candidate extraction, deterministic cohort construction, seeding, and match-grouped evaluation.

**Tech Stack:** Next.js 15, React 19, TypeScript with `node:test`, Supabase/Postgres RLS, Python 3 with unittest/numpy/scipy/scikit-learn, ffmpeg/ffprobe, and R2.

**Spec:** `docs/superpowers/specs/2026-09-01-audio-impact-labeling-design.md`

## Global Constraints

- The production route is `/research/audio-impacts`; the batch slug is `audio-impact-labeling-recent-v1`.
- Store exactly nine classes: `paddle`, `table`, `floor`, `shoe`, `net`, `background`, `other`, `no_impact`, and `unsure`.
- Candidate semantics are hidden; only neutral timing proposals appear in the reviewer.
- Source media stays at native 44.1/48 kHz; model windows are 200 ms resampled reproducibly to 48 kHz.
- Round C is sealed before training and may not enter training, tuning, threshold selection, or acquisition scoring.
- Production point, serve, and placement behavior is unchanged; no raw audio peaks enter production.
- All implementation follows red-green-refactor TDD and uses path-scoped commits.

---

### Task 1: Audio-impact label domain

**Files:**
- Create: `src/lib/research/audioImpacts.ts`
- Create: `src/lib/research/audioImpacts.test.ts`

**Interfaces:**
- Produces: `AudioImpactKind`, `AudioImpactCandidate`, `AudioImpactHumanEvent`, `AudioImpactHumanLabel`, `createAudioImpactLabel`, `hydrateAudioImpactLabel`, `labelAudioImpactEvent`, `insertManualAudioImpactEvent`, `validateAudioImpactLabel`, `audioImpactProgress`, `audioImpactKindForShortcut`, and `isAudioImpactShortcutTarget`.
- Consumes: plain JSON from `research_sources.proposal` and `research_assignments.human_label`.

- [ ] **Step 1: Write failing taxonomy, hydration, and validation tests**

```ts
test("every frozen sound needs an explicit answer before point completion", () => {
  const label = createAudioImpactLabel([candidate("a", 1), candidate("b", 2)]);
  const answered = labelAudioImpactEvent(label, "a", "unsure");
  assert.deepEqual(validateAudioImpactLabel(answered), ["events.b.kind"]);
  assert.deepEqual(validateAudioImpactLabel({ ...answered, sequence_complete: true }), [
    "events.b.kind",
  ]);
});

test("hydration rejects unknown stored classes without inventing a prediction", () => {
  const label = hydrateAudioImpactLabel({
    schema_version: 1,
    events: [{ candidate_id: "a", time_s: 1, kind: "laser" }],
  }, [candidate("a", 1)]);
  assert.equal(label.events[0].kind, null);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test --experimental-strip-types src/lib/research/audioImpacts.test.ts`

Expected: FAIL because `audioImpacts.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure label model**

```ts
export const AUDIO_IMPACT_KINDS = [
  "paddle", "table", "floor", "shoe", "net",
  "background", "other", "no_impact", "unsure",
] as const;

export function labelAudioImpactEvent(
  label: AudioImpactHumanLabel,
  eventId: string,
  kind: AudioImpactKind,
): AudioImpactHumanLabel {
  return {
    ...label,
    events: label.events.map((event) =>
      event.id === eventId ? { ...event, kind } : event,
    ),
  };
}
```

Implement candidate-preserving hydration, stable manual IDs, 50 ms snap selection, explicit sequence completion, progress counts, the nine shortcuts, and interactive-focus guards. Invalid stored values normalize to `null`; `unsure` is a valid completed answer.

- [ ] **Step 4: Run focused and full research tests**

Run: `node --test --experimental-strip-types src/lib/research/audioImpacts.test.ts`

Expected: all new tests PASS.

Run: `npm run test:research`

Expected: 0 failures.

- [ ] **Step 5: Commit the domain model**

```bash
git add src/lib/research/audioImpacts.ts src/lib/research/audioImpacts.test.ts
git commit -m "Add audio impact label domain"
```

---

### Task 2: Protected route, types, migration, and dashboard entry

**Files:**
- Create: `src/app/research/audio-impacts/types.ts`
- Create: `src/app/research/audio-impacts/page.tsx`
- Create: `src/app/research/audio-impacts/audioImpactRoute.test.ts`
- Modify: `src/app/research/researchDashboardModel.ts`
- Modify: `src/app/research/researchDashboard.test.ts`
- Modify: `src/lib/research/labeling.ts`
- Modify: `src/lib/research/labeling.test.ts`
- Create: `supabase/migrations/152_audio_impact_research.sql`
- Modify: `src/lib/research/migration.test.ts`

**Interfaces:**
- Consumes: Task 1 `AudioImpactHumanLabel` and existing Supabase server client.
- Produces: `AudioImpactResearchAssignment` and a server page that passes assignments to `AudioImpactLabeler`.

- [ ] **Step 1: Write failing access, catalog, and media-namespace tests**

```ts
test("audio impact route is authenticated, scoped, and noindex", () => {
  const page = read("./page.tsx");
  assert.match(page, /redirect\("\/login\?next=\/research\/audio-impacts"\)/);
  assert.match(page, /supabase\.rpc\("is_admin"\)/);
  assert.match(page, /research_batches\.slug/);
  assert.match(page, /audio-impact-labeling-recent-v1/);
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
});
```

Add a media-key assertion for `research/audio-impacts/v1/sources/<uuid>.mp4`, rejection of non-UUID/other prefixes, and a migration assertion that the regex contains all five explicit namespaces without wildcard grants or RLS changes.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/audioImpactRoute.test.ts src/app/research/researchDashboard.test.ts src/lib/research/labeling.test.ts src/lib/research/migration.test.ts`

Expected: FAIL for missing route and missing audio-impact namespace/catalog entry.

- [ ] **Step 3: Add the route contract and schema migration**

```ts
const BATCH_SLUG = "audio-impact-labeling-recent-v1";

export default async function AudioImpactResearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/audio-impacts");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();
  // Query the current user's batch-scoped assignments and normalize joins.
}
```

Use an explicit `research_sources!inner(...)` selection containing `id`, `source_point_idx`, `match_label`, `venue_label`, `duration_s`, `proposal`, and `prefill`. Keep the page admin-only even though the shared RLS infrastructure supports reviewers.

Migration SQL:

```sql
alter table public.research_sources
  drop constraint if exists research_sources_media_key_check;
alter table public.research_sources
  add constraint research_sources_media_key_check
  check (media_key ~ '^research/(fused-labeling|placement-calibration|serve-detection|winner-constrained-endings|audio-impacts)/v[0-9]+/sources/[0-9a-f-]{36}\.mp4$');
```

- [ ] **Step 4: Run focused and research tests**

Run the Step 2 command, then `npm run test:research`.

Expected: all PASS.

- [ ] **Step 5: Commit the protected surface**

```bash
git add src/app/research/audio-impacts src/app/research/researchDashboardModel.ts src/app/research/researchDashboard.test.ts src/lib/research/labeling.ts src/lib/research/labeling.test.ts src/lib/research/migration.test.ts supabase/migrations/152_audio_impact_research.sql
git commit -m "Add protected audio impact research route"
```

---

### Task 3: Desktop review state and interface

**Files:**
- Create: `src/app/research/audio-impacts/audioImpactView.ts`
- Create: `src/app/research/audio-impacts/audioImpactView.test.ts`
- Create: `src/app/research/audio-impacts/AudioImpactLabeler.tsx`
- Modify: `src/app/research/audio-impacts/audioImpactRoute.test.ts`

**Interfaces:**
- Consumes: Task 1 label functions and Task 2 `AudioImpactResearchAssignment`.
- Produces: queue filtering, candidate navigation, loop bounds, progress summaries, and the mounted review page.

- [ ] **Step 1: Write failing pure view-state tests**

```ts
test("candidate loop uses one second of context and clamps to the clip", () => {
  assert.deepEqual(candidateLoop(0.2, 8), { start_s: 0, end_s: 1.2 });
  assert.deepEqual(candidateLoop(7.7, 8), { start_s: 6.7, end_s: 8 });
});

test("next unresolved sound advances within the point before the next point", () => {
  assert.deepEqual(nextReviewTarget(assignments, "one", "a"), {
    assignment_id: "one",
    event_id: "b",
  });
});
```

Also test venue/round/completion filters, sounds-and-points progress, submitted-point selection, and previous-target behavior.

- [ ] **Step 2: Run view tests and verify RED**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/audioImpactView.test.ts`

Expected: FAIL because `audioImpactView.ts` does not exist.

- [ ] **Step 3: Implement pure view helpers**

```ts
export function candidateLoop(time_s: number, duration_s: number): LoopWindow {
  return {
    start_s: Math.max(0, round4(time_s - 1)),
    end_s: Math.min(duration_s, round4(time_s + 1)),
  };
}
```

Keep navigation deterministic by assignment sequence and event time. Filters must never strand the active assignment; the current item is temporarily prepended when filtered out.

- [ ] **Step 4: Run view tests and verify GREEN**

Run the Step 2 command.

Expected: all PASS.

- [ ] **Step 5: Extend the route structural test before adding the component**

Assert that the real component contains one `<video>`, uses `/api/research/media`, updates `research_assignments`, guards editable shortcut targets, renders all nine visible definitions, starts at playback rate 1, supports 0.5x and 0.25x, and never renders proposal confidence as a semantic hint.

- [ ] **Step 6: Run the structural test and verify RED**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/audioImpactRoute.test.ts`

Expected: FAIL because `AudioImpactLabeler.tsx` does not exist.

- [ ] **Step 7: Implement the desktop labeler**

Build a three-column layout with queue/filters, one protected video plus waveform/marker, and the nine large label buttons. On candidate change, seek to the natural-speed loop start and play; enforce the loop in `onTimeUpdate`. Label keys call one serialized `saveAndAdvance(kind)` operation. A failed save retains the pending label, displays retry, and blocks navigation. `Undo`, `Previous`, `Add missed sound`, full-point context, 1x/0.5x/0.25x, point-complete validation, admin export, before-unload protection, and sound-level progress are required.

Persist:

```ts
await supabase.from("research_assignments").update({
  status,
  human_label: nextLabel,
  review_metrics: metrics,
  started_at: assignment.started_at ?? now,
  submitted_at: status === "submitted" ? now : null,
}).eq("id", assignment.id);
```

- [ ] **Step 8: Run focused tests, lint changed files, and full research tests**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/*.test.ts src/lib/research/audioImpacts.test.ts`

Run: `npx eslint src/app/research/audio-impacts src/lib/research/audioImpacts.ts`

Run: `npm run test:research`

Expected: 0 failures and 0 lint errors.

- [ ] **Step 9: Commit the usable reviewer**

```bash
git add src/app/research/audio-impacts
git commit -m "Build desktop audio impact labeler"
```

---

### Task 4: Dual-band candidate extraction

**Files:**
- Modify: `worker/research_audio_candidates.py`
- Create: `worker/tests/test_research_audio_candidates.py`

**Interfaces:**
- Produces: `analyze_samples(samples, sample_rate)` returning native metadata, waveform, high/low detector scores, merged stable candidates, and uncapped provenance.
- Consumes: native mono audio decoded from the source clip.

- [ ] **Step 1: Write failing signal-fixture tests**

Use hand-built numpy signals containing a 12 kHz click at 0.5 s, a 120 Hz stomp burst at 1.0 s, and coincident dual-band energy at 1.5 s. Assert that the first identifies `high_frequency`, the second `low_frequency`, the coincident proposals merge within 35 ms, stable IDs do not change across runs, and returned sample rate remains the input native rate.

- [ ] **Step 2: Run and verify RED**

Run: `cd worker && venv/bin/python -m unittest tests.test_research_audio_candidates -v`

Expected: FAIL because the dual-band interfaces are absent.

- [ ] **Step 3: Implement native decode and merged candidates**

Keep display envelopes at 10 ms, calculate high-pass and low-band transient envelopes at 1 ms, retain per-detector raw score/provenance, merge detections within 35 ms, and cap review candidates to 9-14 using score plus temporal coverage. Include deterministic quiet/low-score controls marked only by proposal origin, never a semantic class.

- [ ] **Step 4: Run focused and worker tests**

Run the Step 2 command, then `cd worker && venv/bin/python -m unittest discover tests -v`.

Expected: 0 failures.

- [ ] **Step 5: Commit detector changes**

```bash
git add worker/research_audio_candidates.py worker/tests/test_research_audio_candidates.py
git commit -m "Add dual-band audio impact proposals"
```

---

### Task 5: Deterministic 90-point builder and idempotent seeder

**Files:**
- Create: `worker/build_audio_impact_research.py`
- Create: `worker/tests/test_build_audio_impact_research.py`

**Interfaces:**
- Consumes: production match/point metadata, source media identities, Task 4 analyzer, Postgres, and R2.
- Produces: `eligible_recordings`, `select_cohort`, `select_round_points`, `verified_manifest`, `seed_batch`, `--dry-run`, `--seed`, and Round B acquisition mode.

- [ ] **Step 1: Write failing cohort and leakage tests**

Create fixtures with four recordings per venue, shared source hashes for crop duplicates, and 15 points each. Assert exactly three unique hashes per venue, ten points per recording, 30 points per round, newest eligible Westchester/PingPod/LYTTC ordering, deterministic results, cross-round duplicate rejection, and Round C exclusion from acquisition inputs.

- [ ] **Step 2: Run and verify RED**

Run: `cd worker && venv/bin/python -m unittest tests.test_build_audio_impact_research -v`

Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement deterministic manifests and dry run**

Use SHA-256 source identity first, normalized raw/job identity second, `played_at DESC` plus stable hash ordering, timeline-stratified point selection for Rounds A/C, and stored acquisition scores/model hash for Round B. `verified_manifest` recomputes the canonical hash and asserts the complete 90/9/3/10 contract.

- [ ] **Step 4: Run builder tests and verify GREEN**

Run the Step 2 command.

Expected: all PASS.

- [ ] **Step 5: Add seeding failure tests before mutation code**

Test with an in-memory fake boundary that identical batch/source hashes are no-ops, a manifest mismatch raises before any write, submitted labels are never overwritten, media failures leave the batch draft, and the active transition occurs only after all 90 sources and assignments verify.

- [ ] **Step 6: Implement explicit `--seed` behavior**

Default execution is read-only dry run. `--seed --reviewer-email <email>` copies verified clips to `research/audio-impacts/v1/sources/<stable-uuid>.mp4`, inserts draft rows transactionally where possible, verifies object and manifest hashes, creates deterministic assignments, and activates only after the QA invariants pass. Never update production match or point rows.

- [ ] **Step 7: Run focused and worker tests**

Run: `cd worker && venv/bin/python -m unittest tests.test_build_audio_impact_research -v`

Run: `cd worker && venv/bin/python -m unittest discover tests -v`

Expected: 0 failures.

- [ ] **Step 8: Commit builder and seeder**

```bash
git add worker/build_audio_impact_research.py worker/tests/test_build_audio_impact_research.py
git commit -m "Build reproducible audio impact corpus"
```

---

### Task 6: Offline training, sealed evaluation, and final verification

**Files:**
- Create: `worker/train_audio_impacts.py`
- Create: `worker/tests/test_train_audio_impacts.py`
- Modify: `docs/research/2026-09-01-audio-impact-labeling/README.md`

**Interfaces:**
- Consumes: pinned research export, manifests, source media, and optional pseudo-label cache.
- Produces: fixed 200 ms features, match-grouped linear/CNN experiment inputs, abstention-aware metrics, per-venue report JSON, and a model artifact with data/model hashes.

- [ ] **Step 1: Write failing window, leakage, and metric tests**

Assert exact 9,600-sample 200 ms windows at 48 kHz, explicit zero padding at boundaries, `unsure` exclusion, no Round C IDs in fit/tune inputs, match-grouped folds, per-venue class metrics, coverage after abstention, and data-insufficient status below 30 development or 15 sealed examples.

- [ ] **Step 2: Run and verify RED**

Run: `cd worker && venv/bin/python -m unittest tests.test_train_audio_impacts -v`

Expected: FAIL because the trainer does not exist.

- [ ] **Step 3: Implement the richer linear baseline first**

Extract deterministic short-time spectral features, class-weighted regularized linear probabilities, development-only threshold selection, and grouped validation. Keep pseudo labels separate and tagged; never count them as human gold.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: all PASS.

- [ ] **Step 5: Add optional small-spectrogram experiment and sealed scorer**

The CNN path may be unavailable without its optional dependency and must fail with a precise install message; the linear path remains complete. The sealed scorer requires a frozen model/threshold hash and refuses any artifact whose training source list intersects Round C.

- [ ] **Step 6: Document exact dry-run, seed, export, train, and score commands**

Create the research README with the batch slug, environment prerequisites, immutable artifacts, QA checklist, and explicit warning that the tools do not alter production detection.

- [ ] **Step 7: Run final verification**

Run: `npm run test:research`

Run: `npx eslint src/app/research/audio-impacts src/lib/research/audioImpacts.ts`

Run: `cd worker && venv/bin/python -m unittest tests.test_research_audio_candidates tests.test_build_audio_impact_research tests.test_train_audio_impacts -v`

Run: `npm run build`

Expected: all tests and the production build pass with no new warnings or errors.

- [ ] **Step 8: Commit the offline evaluation path**

```bash
git add worker/train_audio_impacts.py worker/tests/test_train_audio_impacts.py docs/research/2026-09-01-audio-impact-labeling/README.md
git commit -m "Add sealed audio impact evaluation"
```

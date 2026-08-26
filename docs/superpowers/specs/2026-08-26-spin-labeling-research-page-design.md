# Serve Spin Labeling Research Page

**Status:** Draft for review, 2026-08-26

**Production route:** `/research/spin`

## Objective

Build the ground-truth set the spin work needs: hundreds of serves labeled
by the owner, each shown beside what the current spin estimator predicted,
with one-keystroke correction and free-text notes. The page must make
labeling fast enough that 300+ labels are a few evenings of work, and it
must keep an honest, versioned record of prediction-vs-human agreement so
estimator accuracy is measured, not vibed.

Feeds directly on the findings in
`docs/research/2026-08-26-spin-estimation/` (feasibility study): the
bounce speed ratio is the signal, serves are the target, and the estimator
is a physics-feature classifier whose current form lives in that study's
scripts.

## What already exists and is reused

- **Ball tracks**: `~/Library/Caches/PongLens/serve-study/det/*.jsonl` —
  per-frame detections over per-point serve windows for 24 resolvable
  matches (1,882 non-deleted, non-warmup points; 1,103 with a serve bounce
  pair in placement).
- **Bounce events**: `points.placement` v3 candidates and hypotheses
  (pixel + table coords + times).
- **Calibration**: production quads from each match's `match.json` in R2
  (these reproduce the stored u,v exactly; `table_calibration_review` is
  corrections, not what production used, and must not be used to interpret
  stored u,v).
- **Existing labels**: `points.serve_spin` / `serve_sidespin` (69 rows) as
  prefills, marked as coming from the review flow.
- **Feature extraction + gates**: the study's `real_extract2.py` /
  `real_analyze.py` logic (clock re-anchoring by pixel matching, teleport
  chunking, robust window velocities, physical sanity gates including the
  heading-reversal fake-serve gate).
- **Labeling UX precedent**: `src/app/research/fused-labeling/
  ResearchLabeler.tsx` (video + keyboard + autosave states) and the
  lighter per-point notes pages (`serve_review_notes`,
  `crossing_review_notes` pattern).
- **Point clips**: every point has `clip_path` in R2; the serve sits at
  the head of the clip by construction.

## Decision: dedicated light page, not a research batch

The research batch platform (`research_sources` / `research_assignments` /
`ResearchLabeler`) is built for timeline-event labeling over frozen
cohorts, with per-source media copies cut to R2. Spin labels are four
small categorical fields plus a note over a pool that should stay live
(new matches join as the worker computes predictions; predictions
re-version as the estimator improves). The right shape is the fourth
existing pattern — worker writes a purpose-built review table
pre-populated with the model's proposal, page reads it server-side,
owner corrects into the same domain (`table_calibration_review` is the
precedent) — combined with the light notes-page UX
(`serve_detector_notes` family).

Concretely, confirmed against the codebase:

- **Gating**: no research layout guard exists; every page self-guards.
  Copy the canonical preamble (`serve-detector/page.tsx:13-24`): login
  redirect, `supabase.rpc("is_admin")`, `notFound()` (404, not
  redirect) for non-admins, `export const dynamic = "force-dynamic"`,
  robots noindex. Admin-only tier, not the reviewer tier — the page
  reads production `points`.
- **Registration**: one entry in `RESEARCH_PAGES`
  (`researchDashboardModel.ts`).
- **Data loading**: server component reads `points` +
  `spin_predictions` + `spin_review_notes` at request time
  (serve-accuracy pattern). No committed `data.ts` — predictions live
  in the DB, so re-running the build script updates the page with no
  deploy.
- **Saving**: client-side `supabase.from("spin_review_notes").upsert()`
  with optimistic set and rollback on error, exactly the
  `ServeDetector.tsx:280-300` shape; `updated_at` stamped client-side;
  PK `point_id` is the conflict key. Notes textarea debounced 700 ms
  with the idle/saving/saved/error chip (`ServeReview.tsx:270-299`
  precedent — an earlier localStorage version lost notes twice).
- **RLS**: copy migration `109_serve_detector_notes.sql:52-61` verbatim
  (admin-only `for all using (public.is_admin())`), vocabulary enforced
  by CHECK constraints, extended by later migrations rather than edited
  (the `099`/`111` convention).
- **View logic**: verdict vocabulary, queue filtering, and the
  agreement/confusion math live in a tested `serveSpinView.ts`,
  following `serveDetectorView.ts` / `recallView.ts`.

## Data model

### New table `spin_predictions` (worker-written)

One row per point the estimator could measure, upserted by the build
script and, later, by the worker inline at processing time.

- `point_id uuid` PK references points on delete cascade
- `algo text` — estimator version tag, e.g. `ratio-v1`
- `predicted_spin text` — `top | back | none | unmeasurable`
- `confidence numeric` — 0..1
- `ratio1 numeric` — bounce ground-speed ratio (null when unmeasurable)
- `kick1_deg numeric`, `hop_t numeric`, `hop_speed numeric`,
  `pre_speed numeric`, `post_speed numeric` — supporting features
- `quality jsonb` — gate outcomes: anchor offset, window sample counts,
  fit residuals, reject reasons (`fake_serve_reversal`, `no_anchor`,
  `track_sparse`, ...)
- `serve_cut_s numeric` — first serve bounce on the cut video's clock
  (`cut_t0 + (b1_t - t0)`), so the page seeks without recomputing
- `updated_at timestamptz`

RLS: `is_admin()` select for `authenticated`; no write policy (the
worker and build script write over the direct Postgres connection).

### New table `spin_review_notes` (page-written)

One row per labeled point, following the `serve_review_notes` shape:

- `point_id uuid` PK references points on delete cascade
- `spin text` — `top | back | none | cant_tell`
- `side text` — `left | right | none | cant_tell` (direction captured
  here even though `points.serve_sidespin` is a bare boolean; this table
  is the future ground truth and must not lose left/right)
- `strength text` — `light | heavy | cant_tell` (two buckets by design;
  the study showed three is not separable)
- `note text`
- `predicted_spin text`, `predicted_confidence numeric`, `algo text` —
  frozen snapshot of what the page showed at label time, so accuracy
  stays computable after the estimator re-versions
- `blind boolean` — whether the prediction was hidden when the label was
  committed (see holdout below)
- `updated_at timestamptz`

RLS: admin only, both directions, same policy shape as
`serve_review_notes`.

Existing `points.serve_spin`/`serve_sidespin` stay untouched and continue
to be written by the review flow; the page shows them as prefill chips
("labeled in review: back + sidespin") but saves its own record.

## Build script: `worker/build_spin_research.py`

Runs on the Mac, worker venv. For each of the 24 cached matches:

1. Load the det jsonl and current DB points (idx, t0, cut_t0, placement).
2. Re-anchor the study cache's clock per point by matching placement
   bounce-candidate pixels into the track (the study's `calibrate_offset`,
   densest-cluster vote; reject points that do not anchor).
3. Pick the serve bounce pair (chosen hypothesis first, candidate pairing
   fallback), run the hygiene gates, compute features, classify:
   `ratio1 < 0.55 -> back`, `> 0.95 -> top`, else `none`, confidence from
   the margin and measurement quality; gate failures write
   `unmeasurable` with the reason.
4. Upsert `spin_predictions`.

Every labelable point in a covered match gets a row (`unmeasurable` when
gated out) so the page's queue and the yield metric are complete. Points
in matches with no det cache simply have no row yet; the page can still
serve them label-only if selected, but the default queue is covered
matches first. Expected outcome per the study: ~1,900 rows, several
hundred with a confident prediction.

Later (out of scope here): the worker computes the same features inline
for new matches, keeping the page evergreen.

## The page: `/research/spin`

Admin-gated like the other research pages. Three zones:

**Queue rail (left).** Match groups, each with progress (`labeled/total`)
and filters: unlabeled only; has prediction; predicted class (to balance
the label set — backspin will dominate otherwise); disagreements
(labeled != predicted); can't-tell. Defaults: unlabeled, covered matches
first, ordered by match then point idx. A running total at the top:
`labels: 138 · agreement: 84% (n=112 non-blind)`.

**Player (center).** One `<video>` per match: sign the whole cut video
once with `POST /api/media-url` `{ matchId, preview: true }` and use
scripted seek-and-stop (`ServeDetector.tsx:141-160` `play(from, until)`
pattern) — selecting a point seeks to `serve_cut_s - 0.5` and plays a
~3.5 s window at 0.5x by default, looping. This makes point-to-point
advance instant, which is what makes hundreds of labels bearable. Media
access is proven: serve-detector already plays these exact matches for
the admin through this route. Controls: Space replay, `,`/`.` frame
nudge, `-` toggles 0.25x, `0` full speed, Enter plays the whole point.
`serve_cut_s` (cut-video clock) comes from `spin_predictions`, computed
as `cut_t0 + (b1_t - t0)`; for points with no prediction row it falls
back to `cut_t0`.

**Label panel (right).** Four option groups + note, keyboard-first using
the `key_hint` pattern from `HoldoutReview.tsx:79-93` (mnemonic letters,
auto-advance inside save), with the standard guards: text-field bail-out,
current-row ref (not state) in the handler, and registration on capture
so keys reach the handler while focus sits in the video
(`FullMatch.tsx:506-510` note):

- Spin: `T` top, `B` back, `F` flat/none, `U` can't tell
- Sidespin: `A` left, `S` none, `D` right, `W` can't tell
- Strength: `1` light, `2` heavy (enabled when spin is not flat)
- Note: `N` focuses the text box
- `Enter` save + next, `ArrowLeft`/`ArrowRight` previous/next, `X` skip

Prediction display: a chip under the video — `predicted: back (0.81
ratio, conf 0.7)` — with agree/disagree coloring after the label is
saved. **Holdout rule:** a deterministic 20% of points (hash of point id)
render with the prediction hidden until the label is committed; the saved
row records `blind = true`. This keeps a bias-free slice for accuracy
claims while the other 80% get the fast correct-the-prediction flow the
page is for. A header toggle can force blind mode globally for a session.

Prefills: existing `points.serve_spin`/`serve_sidespin` labels appear
pre-selected with a "from review" tag; saving normally writes
`spin_review_notes` and leaves the product columns alone.

## Accuracy readout

A small summary block on the page (and nothing else — no dashboards yet):
confusion matrix of prediction vs human over non-blind and blind rows
separately, measurement yield (`measured / total`), and reject-reason
counts. All computed client-side from the two tables. This is the number
that decides whether the estimator graduates per the study's success
criteria (>= 50% clean yield, >= 85% top-vs-back on labels).

## Decisions settled during design

- **No write-through to `points.serve_spin`.** `PointScorecard.tsx` is
  today the only writer of the product columns and stays that way. The
  research page shows the product label as a "from review" prefill and
  writes only `spin_review_notes`. Mixing a research corpus into product
  rows is new behaviour with no upside; the corpus can be reconciled
  later by a deliberate script if ever wanted.
- **Label every serve, not just `receive_error`/`weak_serve` points.**
  The product only asks about spin when the point outcome made it
  matter (`serveApplies`, `scorecard.ts:152-155`). The research page's
  whole purpose is coverage, so every non-deleted, non-warmup point is
  labelable.
- **Label space is richer than the product's.** Product columns are
  `{back, top, none}` plus a sidespin boolean, with the 033 constraint
  that `none + sidespin` is illegal and pure sidespin is stored as
  `serve_spin = null` + `serve_sidespin = true`. The research table
  keeps direction (left/right) and an explicit `cant_tell` everywhere.
  Mapping research → product (for prefill comparison only): side
  left/right → `true`, flat + any side → the null-spin shape. The
  estimator only ever predicts `top | back | none | unmeasurable`, so
  the illegal pair cannot arise from predictions.
- **The worker writes `spin_predictions` over its direct Postgres
  connection** (same as `build_table_calibration_review.py`), so no RLS
  write policy is needed on that table at all; `authenticated` gets
  select gated by `is_admin()`.

## Out of scope

- Rally spin, sidespin prediction (collected as labels, not predicted),
  RPM anything.
- Re-running blurball for uncovered matches (fallback if anchoring
  proves too lossy: the study's per-match cut.mp4 copies are still in
  `~/Library/Caches/PongLens/serve-study/work/`).
- Any player-facing surface. This is `/research`, admin only.

## Build order

1. Migration: `spin_predictions` + `spin_review_notes` (+ RLS).
2. `worker/build_spin_research.py`, run once, sanity-check counts.
3. Page: queue + player + label panel + upsert (lift ResearchLabeler
   keyboard/autosave patterns).
4. Prediction chip + blind holdout + summary block.
5. Label an evening's worth, then review the disagreement filter
   together before trusting the accuracy readout.

---

## Built, 2026-08-26

Live at `/research/spin` (77bfc275, 8c15e1cd, e15ed2b6). Three things
came out different from the design, each found by driving the real page
rather than by typechecking it.

- **The page loads through one FK join, not an id list.** Fetching the
  predictions and then asking for those point ids in batches of 500
  built a query string long enough that fetch refused to send it, which
  surfaces as `TypeError: fetch failed` with no Postgres error behind
  it. `spin_predictions` embeds `points!inner(...)` instead.
- **Another account's match is hidden, and says so.** Julian's match —
  175 points carrying 46 of the 155 predictions — belongs to a
  different user, so RLS drops it from the join. That is the right
  outcome, since `/api/media-url` could not sign its video either, but
  the page prints the count rather than quietly reporting a smaller
  corpus than the estimator measured.
- **Refusals are never blinded.** The holdout hid the estimator's call
  on every fifth point including the refusals, where there is no call to
  anchor on and the refusal reason is the only useful thing on screen.
  `shouldBlind()` now requires a measurable prediction.

**Where it stands:** 1,551 prediction rows, 155 measured (10% yield),
1,373 points labelable with 109 predictions among them. The yield, not
the page, is the next piece of work — 338 points refuse as
`fake_serve_reversal` and 368 as `no_candidates`. Labeling a batch of
each is what tells us whether those gates are right, and a
refusal-reason filter (not built) would make that pass much faster.

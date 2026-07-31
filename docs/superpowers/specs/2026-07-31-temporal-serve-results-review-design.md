# Temporal Serve Results Review Design

## Purpose

Publish a compact, authenticated review of the scaled temporal serve experiment inside the existing `/research/serve-detection` page. The reviewer must be able to watch representative held-out clips, jump to the model's best estimated serve moment, and compare the model's server call with the rotation-derived source of truth without reviewing all 786 points.

This is a research report, not a labeling workflow and not a production serve-detection rollout.

## Scope

- Add a read-only `Latest results` mode to the existing serve-detection research page.
- Publish exactly 24 held-out examples from `temporal-serve-scale-v1`.
- Preserve the existing onset, follow-up, and original labeling modes without changing their data or completion state.
- Keep every clip protected by the existing reviewer/admin authorization and signed-media flow.
- Do not add a public page, anonymous media access, or a production scoring behavior change.

## Cohort Selection

The publisher consumes the sealed `manifest.json` and `results.json` from the completed experiment and rejects mismatched manifest hashes. Only rows in `predictions.holdout` are eligible.

The 24-item sample is deterministic and divided into three eight-item strata:

1. `correct`: high-confidence fused calls whose side equals `evaluation.expected_server_side`.
2. `wrong`: high-confidence fused calls whose side disagrees with `evaluation.expected_server_side`.
3. `withheld`: calls for which the fused detector abstained, ranked by the largest raw temporal near/far margin so reviewers see the system's strongest withheld evidence.

Within each stratum, rank by fused confidence, then raw temporal margin, then source ID. Apply a three-items-per-match cap in the first pass so one camera cannot dominate. If a stratum remains short, fill it from the same stratum without the cap. If fewer than eight candidates exist, leave that stratum short and fill the remaining total from the other strata in round-robin match order. Never relabel an incorrect call as a control or select from train/development.

Each published item records its stratum, rank, match ID, point ID/index, predicted side, expected side, fused status/confidence/reason, raw near/far scores, model onset timestamp, placement first/second-bounce timestamps when available, experiment/model hashes, and media hash.

## Data and Publishing

Use a dedicated research batch:

- Slug: `serve-detection-temporal-results-v1`
- Title: `Temporal serve detection — held-out results`
- Media prefix: `research/serve-detection/v4/sources`

A new idempotent Python publisher will:

1. Validate the experiment and sealed manifest.
2. Select the deterministic 24-item cohort.
3. Resolve each point's current `clip_path` and verify it matches the sealed input.
4. Copy the clip into the protected research media prefix, recording SHA-256 provenance.
5. Upsert one `research_source` per selected point with the result payload in `proposal.temporal_result`.
6. Store the rotation-derived expected server in `research_gold_labels`, with provenance explicitly labeled `PongLens score rotation; not an independent visual adjudication`.
7. Create read-only assignments for every active serve-research reviewer so the existing RLS-protected media endpoint can authorize access.
8. Audit source count, unique points, stratum counts, object existence, and manifest hashes before activating the batch.

The publisher must not modify existing batch sources, assignments, human labels, or gold labels.

## Server Page and Types

The server page queries both the existing labeling batch and the new temporal-results batch for the signed-in reviewer. It maps them into separate props:

- `initialAssignments`: unchanged writable labeling assignments.
- `initialResultAssignments`: new read-only results assignments.
- `resultSummary`: the frozen experiment summary (786 points, 22 matches, split sizes, held-out metrics, compute, preliminary/research-only recommendation).

The UI must not infer headline metrics from the 24 curated examples. Summary metrics always come from the complete 403-point held-out score.

## Results User Interface

Add `Latest results` as the first tab when result assignments are available. The tab is visually distinct and read-only.

The header shows:

- `Research only` recommendation.
- `48.9% raw held-out accuracy`.
- `52.4% precision at 5.2% coverage` for high-confidence fused calls.
- `786 points / 22 matches` and the preliminary-cohort warning.

The review workspace contains:

- Filters for outcome (`all`, `correct`, `wrong`, `withheld`) and match.
- Previous/next controls plus a compact `N of 24` selector.
- One protected video at a time with preload enabled only for the active clip.
- Quarter-speed playback and existing ±1/±2/±3-frame controls.
- Exact, no-padding jump buttons for model onset, placement first bounce, and placement second bounce when present.
- A comparison card with predicted server, rotation-derived expected server, confidence, raw near/far evidence, fused reason, and a large correct/wrong/withheld badge.
- A short caveat explaining that expected server comes from the scored rotation and onset timing lacks independent ground truth for these 24 cases.

Changing items resets the video session but never writes an assignment or label. Existing autosave, exports, and labeling controls are hidden in results mode.

## Media and Authorization

Reuse `/api/research/media` and assignment-based RLS. Result assignments are legitimate research assignments, but the client exposes no mutation controls. The result batch is included in the serve-detection page query only; no general research route or public API is added.

The existing media-key allowlist already accepts `research/serve-detection/v4/sources/<uuid>.mp4`, so no constraint broadening is required.

## Failure Handling

- Hide the results tab if the reviewer has no result assignments.
- Display a clear per-item media error without breaking navigation.
- Reject publication if a sealed clip changed, a manifest hash differs, a selected point is missing, a stratum is mislabeled, or fewer than 24 unique eligible items can be assembled.
- Keep a batch in `draft` until the full audit passes; only then mark it `active`.

## Testing

- Python unit tests cover manifest/hash validation, deterministic stratified selection, match caps, provenance, idempotent rows, and audit failures.
- TypeScript unit tests cover result filtering, outcome derivation, jump targets, read-only mode selection, and summary formatting.
- Existing serve-labeling tests prove that onset/follow-up/original behavior remains unchanged.
- Run the full worker and web test suites, TypeScript compilation, ESLint for touched files, and a production build.
- After seeding, audit the production batch and manually verify the authenticated page in the in-app browser: tab visibility, one-at-a-time video loading, seek buttons, filters, navigation, and absence of write controls.

## Success Criteria

- An authorized reviewer can open `/research/serve-detection`, choose `Latest results`, and inspect a diverse 24-point held-out sample.
- Every item makes the model-versus-rotation result and uncertainty immediately understandable.
- Video playback and exact timestamp jumps work without loading all 24 clips simultaneously.
- The page accurately communicates the full-cohort result and does not imply production readiness.
- No existing research labels or workflows are mutated.

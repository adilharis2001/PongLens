# Audio Impact Labeling Research Page Design

**Status:** Approved in conversation on 2026-09-01

**Route:** `/research/audio-impacts`

**Batch slug:** `audio-impact-labeling-recent-v1`

## Objective

Build a desktop-first, admin-only research page that makes it fast and intuitive to label individual sounds in recent table-tennis points. The resulting corpus will answer whether audio can reliably distinguish paddle contact from table bounce across both quiet and noisy venues, while also collecting the main confounds: ball-floor bounces, shoe/stomp sounds, net sounds, sounds from other courts, and unrelated transients.

The first deliverable is the labeling system and a reproducible 90-point research corpus. Model training and offline evaluation follow after the first labels are collected. This project does not change the production point, serve, or placement pipelines. Any eventual model runs in shadow mode first, and classified impacts may only support visual evidence; unclassified audio peaks must not be fed directly into production placement.

## Feasibility Evidence

The repository and existing research data support a focused pilot:

- The pseudo-labeled paddle/table cache contains 9,533 proposed events across 13 matches: 6,952 table bounces and 2,581 paddle contacts.
- A prior 15-feature leave-one-match-out classifier was weak, with median ROC AUC near 0.56.
- A throwaway 192-feature short-time spectral linear probe, evaluated by unseen match, reached median ROC AUC 0.846 and mean 0.789. Venue holdouts were uneven: PingPod 0.821, LYTTC 0.713, and Westchester 0.599.
- Existing explicit manual exports contain paddle, table, floor, net, body, other, and unsure labels, but too few examples for a robust venue-aware model.
- Existing serve research provides hundreds of human time anchors that can help select relevant point clips, but serve marks are not substitutes for impact-class labels.
- Raw audio peak injection previously damaged placement quality because it introduced thousands of false candidates. The useful path is classified, confidence-gated impacts with abstention.

This evidence makes paddle-versus-table classification a credible research target, not yet a production-ready capability. Floor, shoe/stomp, net, and background-court sounds are important labels even if their initial counts only support confound rejection rather than standalone classes.

## Approaches Considered

### Whole-point annotation

Playing an entire point and asking the reviewer to place and classify every sound provides maximum context, but it is slow and encourages missed events. It also makes progress difficult to estimate.

### Serve-only annotation

Anchoring every item around a known genuine serve gives clean early contacts and reuses existing labels, but it over-represents serves, under-represents rally strokes and noisy negatives, and would likely produce a brittle classifier.

### Individual candidate review with point context

This is the selected approach. The page presents one proposed sound at a time in a short natural-speed loop, with the containing point available for context. Each decision is small, progress is measured in sounds, and the reviewer can insert missed sounds. Candidate generation supplies timing only; it never displays a predicted class, avoiding label bias.

## Corpus and Split Contract

The builder creates exactly 90 point sources from exactly nine distinct source recordings: three recordings per venue category and ten points per recording.

| Round | Purpose | Sources | Rule |
| --- | --- | ---: | --- |
| A | Initial development | 30 points | Ten points from one recent session-distinct match in each venue category |
| B | Targeted development | 30 points | Ten PingPod points and twenty LYTTC points from three distinct sessions, prioritizing uncertain and rare-sound-rich points after Round A |
| C | Sealed evaluation | 30 points | Ten points from a different session in each venue category, frozen before any model training |

The three venue categories are:

- recent PingPod footage, representing the usually quieter deployment environment;
- Westchester footage from its two retained eligible capture sessions, representing a noisy club;
- the newest eligible LYTTC footage, currently from 2026-08-09 through 2026-08-11, representing a second noisy club.

The builder determines exact match IDs from a dry-run inventory. It sorts eligible recordings by `played_at DESC`, then stable source identity, and selects three PingPod, two Westchester, and four LYTTC recordings. Westchester has only two retained independent sessions with sufficient point media, so a second LYTTC recording fills Round B; Round C still contains all three venue categories. Same-venue recordings separated by no more than six hours are conservatively treated as one capture session and cannot cross rounds; missing venue/time lineage fails closed. A recording is eligible only when its point media and native audio are readable, its source is not a crop or recut of another selected recording, and at least ten usable recent points exist. The ten Round A and Round C points are selected deterministically from a stable hash of batch slug, source identity, and point identity after stratifying across the recording timeline. This prevents the first ten points from dominating the corpus.

Round B's recording is frozen at the same time as Rounds A and C. Its ten points are selected after the Round A checkpoint from a frozen eligible-point manifest, using a stored model hash and deterministic acquisition score. The score combines predictive uncertainty, low-frequency shoe/stomp proposal strength, likely floor-bounce tails, and background/no-impact density. If no Round A model is available, the builder uses the same detector-derived terms without predictive uncertainty. The selected point IDs, scores, model hash, and tie-break order are persisted in the Round B manifest.

Duplicate prevention uses the full retained raw-media SHA-256 as the primary identity and normalized raw media/job input identity as a secondary check. Historical objects without trusted SHA metadata are streamed once to compute it. Cropped, shortened, transcoded, or re-exported copies of the same recording cannot cross rounds or venues. The builder fails closed when source or session identity cannot be resolved; it does not guess.

Before Round A labeling begins, the builder writes immutable cohort, split, source, point, and detector manifests. Round C identities and proposal timings are sealed then and never regenerated, tuned, or used for model selection. Round C labels remain hidden from training and tuning exports until the evaluation unlock step.

## Candidate Generation

Each point source retains its original 44.1 kHz or 48 kHz audio. Proposal generation runs two complementary onset detectors:

1. A short high-frequency/transient detector proposes likely paddle, table, net, and hard-background impacts.
2. A low-frequency detector proposes possible shoe stomps and heavier floor/body transients that the existing onset detector may miss.

Detector union candidates within 35 ms are merged into one stable candidate. The candidate records every contributing detector and its raw scores. Candidates are timing proposals only and carry no user-visible semantic prediction. Stable candidate IDs derive from source ID, rounded source-clock time, and detector-manifest version.

The proposal also includes a small deterministic control sample of low-scoring peaks and quiet moments. These are necessary to teach and measure `no_impact` rather than evaluating only detector-confirmed sounds. Candidate generation must target approximately 9-14 review decisions per point; it caps dense runs by score plus temporal coverage without deleting the uncapped detector output from the manifest.

All timestamps use the frozen point clip's local media clock. The builder verifies audio/video duration agreement and rejects a source when the streams disagree by more than 50 ms or the audio stream is missing. Source-clock and cut-clock timestamps may be stored as provenance, but the UI never joins a source-clock label directly to cut-clock audio.

## Label Contract

Each frozen candidate receives exactly one current label:

| Key | Label | Reviewer definition |
| --- | --- | --- |
| `P` | Paddle | The ball contacts either visible match player's paddle, including serve and rally contacts |
| `T` | Table | The ball contacts the visible match table |
| `F` | Ball on floor | The match ball bounces on the floor, distinct from a shoe impact |
| `S` | Shoe / stomp | A footfall, shoe squeak, or deliberate serving stomp |
| `N` | Net | The match ball contacts the visible table's net or net assembly |
| `B` | Background court | Paddle or table contact from another court or an off-camera game |
| `O` | Other | Voice, clap, catch, body contact, equipment movement, or another unrelated transient |
| `X` | No clear impact | No distinct impact is audible at the marker |
| `U` | Unsure | A sound is present, but the reviewer cannot assign it reliably |

The visible match is the point shown in the central player. A sound from another court stays `background` even when it clearly resembles paddle or table contact. `No clear impact` means the timing proposal itself is false; it must not be used for an ambiguous real sound. `Unsure` is retained for audit and excluded from training.

The reviewer may add a missed sound from the point-context player. A manual event snaps to the strongest uncaptured low-threshold onset within 50 ms of the playhead; if none exists, it uses the exact playhead time. Manual events use the same label vocabulary and store `origin: manual` plus their unsnapped and final times.

An assignment is complete when every frozen candidate has a label and the reviewer confirms the point sequence complete. Manual insertion is optional. All events remain editable until submission; after submission an admin can reopen the assignment. Current answers are stored with answer-change counts, playback counts, and time spent. Export contains both the current label and enough provenance to reconstruct the proposal and its revisions.

## Stored Schema and Existing Research Infrastructure

The feature reuses `research_batches`, `research_sources`, and `research_assignments` rather than creating a second review system.

- `research_batches.slug` is `audio-impact-labeling-recent-v1`.
- Each `research_source` is one frozen point clip. Its proposal stores schema version, native audio metadata, waveform envelope, frozen candidates, detector provenance, source-clock provenance, and media SHA-256.
- `prefill` stores venue category, round, split, source recording identity, point identity, source selection score, and manifest hashes. It does not contain predicted sound classes.
- Each `research_assignment.human_label` stores the current candidate labels, manual events, sequence-complete flag, and label schema version.
- `review_metrics` stores time spent, playback count, answer changes, replay-speed use, and whether full point context was played.

Research media uses permanent keys shaped as `research/audio-impacts/v1/sources/<uuid>.mp4`. A migration extends `isResearchMediaKey` and the database media-key constraint to that namespace. The existing `/api/research/media` assignment-scoped signing route remains the only media access path. The existing admin-only `/api/research/export` route and `research_export_batch` RPC are extended only if required to carry the new proposal fields without loss.

The seeder is idempotent on batch slug and stable source ID. Rerunning it with identical manifests is a no-op; a hash mismatch fails and requires a new batch version. It never overwrites submitted labels.

## Desktop Review Experience

The route is optimized for a desktop keyboard and a single mounted video element:

- Left column: venue/round filters, point queue, completed/remaining sound counts, and save state.
- Center: the containing point video with a prominent candidate marker, a 1-2 second looping review window, waveform, current timestamp, and full-point context control.
- Right column: large label buttons with keys and one-line definitions, followed by `Undo`, `Previous`, `Add missed sound`, and `Point complete`.

The first playback is always natural speed. The reviewer can replay at 0.5x or 0.25x, scrub the full point, and jump back to the short loop. A label click or shortcut autosaves and advances to the next unresolved sound only after the save succeeds. Undo restores the preceding answer and candidate. Previous allows explicit navigation without changing an answer.

The page shows progress as sounds labeled out of total sounds, with a secondary point count. It never shows a classifier prediction, candidate class, confidence-derived class hint, or model score. Detector timing markers are visually neutral.

Keyboard shortcuts are ignored while a text input, textarea, select, dialog, or editable element has focus. Browser media shortcuts do not compete with label keys. Labels and definitions remain visible without hover, and color is never the only indicator.

If autosave fails, the answer remains visibly pending in local state, advance is blocked, and the page offers retry without discarding the choice. Media-signing, decoding, missing-audio, and duration-validation failures mark the source unavailable for admin repair; they never create `no_impact` labels.

## Data Flow

1. The offline builder reads the production metadata and media inventory without modifying point or match records.
2. A dry run prints the eligible recordings, selected 90 points, duplicate exclusions, split assignment, media health, and expected candidate counts.
3. After explicit seed execution, point clips are copied to the permanent research namespace, analyzed, hashed, and inserted into the research batch.
4. The admin-only page loads RLS-visible assignments and requests assignment-scoped signed media URLs.
5. Every label is validated server-side, autosaved, and exportable through the research export endpoint.
6. The training script consumes a pinned export plus cohort and detector manifests and writes model, feature, split, and metric hashes.
7. Round C labels are unlocked only for the final scoring command; the command refuses to train or tune on Round C source IDs.

## Training and Evaluation Plan

Source audio remains archived at native rate. Model input uses a fixed 200 ms full-band window centered on the human event time and is resampled reproducibly to 48 kHz. Padding is explicit and recorded for boundary events.

The first experiment compares:

- a regularized linear classifier on the richer short-time spectral feature set, which is the required baseline;
- a small spectrogram convolutional model, accepted only when it improves untouched-match performance enough to justify deployment complexity.

The 9,533 pseudo-labeled paddle/table events may be used for pretraining or weak supervision, but never as sealed evaluation truth. Human Round A and B labels are the gold development set. `unsure` is excluded. `no_impact` is a detector-rejection class. All semantic classes remain distinct in storage and reporting; a class with fewer than 30 development and 15 sealed examples is reported as data-insufficient and is not silently merged.

Evaluation is grouped by source recording, never random event split. Reports include per-class precision, recall, F1, confusion matrix, macro F1, paddle-versus-table balanced accuracy and ROC AUC, abstention coverage, and every metric by venue. Pooled noisy-club results do not replace separate Westchester and LYTTC results.

The decision gates are:

- Stop or redesign if sealed paddle-versus-table balanced accuracy is at or below 0.60, the level of the prior small manual benchmark.
- Continue research, but do not integrate, when performance exceeds 0.60 yet remains materially venue-dependent.
- Consider shadow-mode integration only when paddle-versus-table balanced accuracy is at least 0.80 at at least 70% non-abstained coverage in each supported venue, and false classified impacts do not reduce the downstream visual benchmark.
- Floor, shoe/stomp, net, or background become supported production classes only after they meet the same per-venue gate with sufficient labeled examples. Until then they serve as explicit rejection/confound labels.

No result from Round C may influence feature design, thresholds, model choice, class grouping, or retraining for this batch version.

## Security and Performance

- The route and data queries require the existing admin/research authorization checks; anonymous users receive no rows or media URLs.
- RLS continues to limit reviewers to their assignments, while admins retain QA access.
- Signed media URLs expire after one hour and are never persisted in labels or exports.
- Only one video element and one decoded source are active. The next signed URL may be prefetched, but the next video is not decoded until navigation.
- Waveform data is a compact precomputed envelope. Candidate analysis and model inference never run in the browser or request path.
- The builder is read-only until a separately invoked seed step and never mutates production matches, points, or clips.

## Verification

Automated tests must cover:

- label creation, hydration, validation, edits, manual-event insertion, and completion;
- all nine shortcuts, focus guards, undo/previous behavior, and natural-speed initial playback;
- autosave success, retry after failure, blocked advance, and submitted-assignment reopening;
- progress counted by sounds and points;
- research-media key validation and assignment-scoped signing authorization;
- builder invariants: 90 points, nine distinct source hashes, three venues, three rounds, ten points per recording, no duplicate source across splits, deterministic selection, and frozen Round C;
- candidate merge windows, stable IDs, native-clock alignment, missing audio, and duration mismatch rejection;
- idempotent seeding and mismatch refusal;
- export completeness and deterministic manifests;
- trainer leakage guards that reject any Round C source in training or tuning;
- metric calculation by class, recording, venue, abstention coverage, and insufficient-data status.

Before activation, an admin QA pass must manually verify at least one point from every selected recording for audio presence, natural-speed playback, marker alignment, label save/reload, and export round-trip.

## Rollout

1. Implement the schema/types, pure label state, tests, page, media-key migration, builder, and trainer/evaluator scaffolding.
2. Run the builder in dry-run mode and review the exact nine recordings, 90 points, excluded duplicates, audio validation, and candidate distribution.
3. Seed the inactive batch, perform the nine-recording QA pass, then activate Round A.
4. Label Round A and export a pinned checkpoint.
5. Train the first development model, record its hash, select Round B deterministically, and label Round B.
6. Freeze the final model and thresholds, then label Round C without predictions or scores visible.
7. Unlock Round C for one final evaluation report.
8. Decide whether to stop, collect targeted data, or begin a separate shadow-mode integration project. Production behavior remains unchanged throughout this rollout.

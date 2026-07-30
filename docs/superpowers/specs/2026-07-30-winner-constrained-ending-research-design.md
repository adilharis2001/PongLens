# Winner-Constrained Point-Ending Research Design

**Status:** Approved in conversation on 2026-07-30

**Production route:** `/research/winner-constrained-endings`

**Evaluation scope:** 97 scored, non-let points across five production matches

## Objective

Measure whether knowing the confirmed point winner materially improves
PongLens' ability to reconstruct how a table-tennis point ended. The study
targets player-useful outcomes such as a net error, long or wide miss, clean
winner, missed return, edge, final hitter, shot count, and attempted return.

The result is a permanent, authenticated research page where a reviewer can
label a broad cross-match sample without seeing the automatic proposals. An
administrative export then compares human truth with two frozen analyses:

1. winner-constrained analysis without a serve-onset boundary; and
2. the same analysis starting at the existing high-confidence serve boundary,
   when that boundary is available.

This separates the value of the confirmed winner from the value of better clip
onset detection and provides a stable cohort that can later be joined to
human-labeled serve contacts.

## Chosen Approach

Extend the existing production research infrastructure and reuse the already
frozen cross-match serve-detection cohort.

The source cohort is the 100-point `serve-detection-cross-match-v1` batch
drawn from Vaibhav, Gui, Chris, Faye, and Patrick. Exclude the three points
without a confirmed winner and the single let, leaving 97 eligible source
points. Freeze new immutable media objects in a dedicated namespace and seed
new research sources and assignments. The original serve batch and all
production matches, points, clips, scores, and placements remain unchanged.

Reusing source point identities is preferable to a fresh sample because it:

- covers the requested matches and both current venues;
- preserves the existing production media basis;
- supports a direct future join to the serve-detection labels;
- avoids selection drift between the two experiments; and
- makes onset-boundary ablations interpretable point by point.

A static report was rejected because it cannot autosave durable human truth or
delegate private review. A live end-to-end model in the browser was rejected
because it would make the experiment irreproducible and expose private
production data.

## Source Cohort

The batch slug is `winner-constrained-endings-cross-match-v1`.

The expected eligible composition is:

| Match | Venue | Eligible points |
| --- | --- | ---: |
| Chris | PingPod | 20 |
| Gui | PingPod | 20 |
| Vaibhav | PingPod | 20 |
| Faye | Westchester TTC | 19 |
| Patrick | Westchester TTC | 18 |
| **Total** |  | **97** |

Eligibility requires:

- membership in the sealed serve-detection batch;
- a valid production source-point mapping;
- a confirmed winner of `user` or `opponent`;
- `is_let = false`;
- readable private clip media; and
- usable match calibration.

The builder fails closed if the source cohort, match counts, point identities,
media hashes, or calibration inputs differ from the sealed manifest.

## Analysis Inputs and Independence

The ending analyzer may receive:

- the confirmed winner;
- the authoritative scored server and physical side;
- the private point clip;
- BlurBall detections and trajectory evidence;
- placement candidates transformed to clip-relative time;
- audio impact candidates;
- table calibration; and
- optionally, the existing detector's high-confidence serve-contact time.

It must not receive:

- the reviewer's ending label;
- any previous ending-review note;
- a human serve label until the planned post-study rerun; or
- an outcome label inferred from score beyond the confirmed winner itself.

The confirmed winner is a hard constraint. A proposal may attribute an error
only to the confirmed loser and a clean/unreturned winner only to the confirmed
winner. Evidence that contradicts this is rejected rather than relabeled as a
winner-conflicting story.

## Ending Analysis

The worker runs BlurBall once per clip, extracts audio candidates, aligns the
stored placement reconstruction, and derives compact trajectory/contact
features. It then ranks player-facing ending families:

- `net`;
- `long`;
- `wide`;
- `clean_winner`;
- `missed_return`;
- `edge`;
- `other`; or
- `unsure`.

Net detection explicitly supports two common shapes:

1. **died or stuck at the net:** forward travel toward the net followed by a
   stop, short reversal, or strong lateral deflection near the net plane; and
2. **clipped and continued:** a localized velocity/direction discontinuity at
   the net followed by continued travel.

The analysis records the predicted final hitter, observed racket-contact count,
whether the loser attempted a return, net behavior, optional receiving zone,
confidence, alternatives, and the evidence supporting or contradicting each
candidate. It abstains when the video evidence is insufficient instead of
using the winner to manufacture unsupported detail.

Each source freezes two prediction variants:

- `without_serve_boundary`, which analyzes the full point clip; and
- `with_detected_serve_boundary`, which ignores earlier activity only when the
  existing serve detector marked a high-confidence serve contact.

The second variant is explicitly unavailable for sources without a
high-confidence boundary. The system does not silently substitute the first
variant.

## Blinded Review Page

The authenticated page lives at:

`https://www.ponglens.com/research/winner-constrained-endings`

Only assigned reviewers and administrators may open it. Search engines receive
`noindex`, `nofollow`, and no-cache metadata.

The page shows:

- the point video;
- match label and venue;
- known server;
- confirmed winner;
- progress, status filters, and previous/next navigation; and
- a plain-language label form.

It does not show either automatic prediction, automatic contact count,
automatic evidence, or automatic confidence while the reviewer labels. This
prevents anchoring and makes the exported accuracy meaningful.

### Human label

The required ending label contains:

- ending family: net, long, wide, clean winner/unreturned, missed return, edge,
  other, or unsure;
- observed racket-contact count, or unknown;
- final hitter: server, receiver, unknown, or unsure;
- attempted return: yes, no, unknown, or unsure;
- confidence: high, medium, or low.

Conditional and optional fields are:

- net behavior: died/stuck/lateral, clipped/continued, other, or unsure;
- final receiving zone: forehand, backhand, middle, or unknown;
- free-form notes.

The UI explains the labels in player language:

- `clean winner/unreturned` means the confirmed winner's shot was not touched;
- `missed return` means the losing player made a return attempt but did not
  contact the ball;
- `net`, `long`, and `wide` describe the confirmed loser's terminal shot.

This removes ambiguous phrases such as “Adil missed table” when Adil is the
confirmed winner.

## Storage Contracts

Review-safe source `proposal` data contains only:

- schema version;
- anonymous source display fields;
- clip duration;
- venue;
- read-only known server and winner;
- availability of a detected serve boundary, without its automatic ending
  result; and
- an explicit `automatic_prediction_withheld` flag.

The `prefill` contains the same non-predictive context used to hydrate the UI.
Automatic analysis is stored only in the protected gold record together with:

- production source mapping;
- source and configuration hashes;
- both frozen prediction variants;
- analyzer/BlurBall/audio/placement versions; and
- calibration and serve-boundary provenance.

The browser never queries gold labels or production point UUIDs.

## Batch Builder and Safety

Add an idempotent administrative builder with `build-manifest`,
`apply-migration`, `seed`, and `audit` commands. It:

1. reads the sealed serve batch and its private gold mappings;
2. resolves the five production matches and eligible points;
3. downloads and hashes each private clip;
4. retrieves match calibration and clip-relative placement candidates;
5. runs or resumes cached BlurBall/audio extraction;
6. creates both frozen winner-constrained predictions;
7. copies immutable media to
   `research/winner-constrained-endings/v1/sources/<stable-id>.mp4`;
8. writes a new batch, sources, protected gold labels, and owner assignments;
9. seals the batch only after all 97 sources pass validation; and
10. audits database rows and private object hashes after seeding.

Stable UUIDs derive from the source point and experiment version. Re-running
the builder does not duplicate sources, assignments, or media. The builder
never writes to production `matches`, `points`, scoring, placement, or the
serve-detection batch.

## Security and Privacy

- Research clips remain in private R2 storage.
- The existing protected media endpoint issues a URL only after assignment and
  RLS checks.
- The media-key allowlist is expanded only for the versioned
  `winner-constrained-endings` namespace.
- Automatic predictions and production mappings remain behind administrative
  gold/export access.
- No service-role or R2 credential reaches the browser.
- Private manifests, downloaded clips, and inference caches are never
  committed.

## Metrics

The administrative export must support:

- labeling coverage;
- exact ending-family accuracy;
- ending confusion matrix;
- net precision, recall, and F1;
- exact contact-count accuracy and mean absolute error;
- final-hitter accuracy;
- attempted-return accuracy;
- abstention coverage and accuracy;
- comparison of the two serve-boundary variants; and
- slices by match, venue, confidence, and serve-boundary availability.

A later analysis joins human serve-contact labels by private
`source_point_id`, reruns the second variant with the human boundary, and
reports whether the improvement comes from the winner constraint, onset
correction, or both.

## Failure Handling

- Missing winner, lets, unreadable media, missing calibration, or ambiguous
  source mapping fail eligibility before publication.
- Individual inference failures are recorded as explicit unavailable
  predictions; they do not fabricate outcomes.
- Autosave errors remain visible and retryable without clearing the local
  answer.
- An expired media link is refreshed through the protected endpoint.
- Seed publication remains inactive until source, assignment, object, and hash
  counts match the sealed manifest.

## Verification

Automated tests cover:

- exact 97-source cohort and per-match counts;
- eligibility and stable identity rules;
- winner-constraint invariants;
- net stop/reversal, lateral deflection, and clipped-continuation geometry;
- serve-boundary ablation behavior;
- label hydration, completion, and conditional net fields;
- prediction withholding in browser-facing data;
- narrow private-media namespace validation;
- authenticated route filtering; and
- export metric calculations.

Before deployment, run all worker tests, research tests, lint, production
build, migration checks, manifest audit, and browser smoke tests for sign-in,
one-video mounting, autosave restore, submission, navigation, and export.

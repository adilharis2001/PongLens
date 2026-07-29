# RTMPose Scoring Automation Production Design

**Status:** Approved in conversation on 2026-07-29

**Scope:** First-server detection and persistent player-end changes

**Production posture:** High-precision automation with one-tap undo

## Objective

Use the detector-free RTMPose work already validated on the Vaibhav match to
remove two pieces of scoring administration:

1. asking who served first when the match can determine it reliably; and
2. asking the scorer to manually repair a game boundary when a persistent
   player-end change reveals where the next game began.

The common path should be: open Keep Score, record point winners, and let
PongLens maintain the serve rotation and game partition quietly.

## Evidence and Constraints

The production design is based on the full-match benchmark, not on a claim
that pose is infallible:

- the first-server result was correct and high confidence on the reviewed
  match;
- the `sparse-3` profile found all six reviewed game end-change regions,
  with five exact boundaries and one boundary bracketed by a single
  unavailable point;
- the position scan took about 13 seconds and the serve pass about 6.5
  seconds for 125 points on the benchmark Mac;
- the detector requires two persistent, high-confidence contradictory
  player assignments before it declares an end change;
- an end change is evidence, not automatically a game end: a deciding-game
  change at five points is a legitimate exception;
- unavailable or ambiguous evidence must be withheld rather than guessed.

The expensive RTMPose work must never run in the browser or synchronously
inside a Keep Score interaction. It runs once in the background worker.

## Product Principles

1. **Automation removes questions; it does not add AI ceremony.**
   Successful detection appears as ordinary correct product behavior.
2. **High confidence acts; lower confidence withholds.**
   Only production-gated evidence may change resolved scoring state.
3. **The user is the final authority.**
   A user correction outranks detected evidence and is never overwritten by
   later processing.
4. **Every automatic correction is reversible.**
   A brief, contextual Undo restores the prior state and records the user's
   choice.
5. **Detection and truth remain separate data.**
   Raw/model evidence is stored independently from user overrides and
   resolved scoring state.
6. **Stable point IDs and timestamps anchor evidence.**
   Removing, skipping, or renumbering displayed points must not detach a
   detection from the underlying moment.

## Chosen Interaction Model

Three models were considered:

1. suggestions requiring confirmation;
2. high-confidence automatic application with Undo; and
3. fully pose-authoritative automation.

The chosen model is **high-confidence automatic application with Undo**.
Suggestion-only behavior preserves the current administrative burden, while
pose-authoritative behavior does not respect uncertainty or deciding-game
end changes.

## Processing Architecture

### Worker responsibilities

After point clips and table calibration are available, the worker:

1. runs the first-server pass over the first three eligible point clips;
2. runs the `sparse-3` player-identity profile over eligible clips;
3. stores per-point usable/unavailable identity evidence;
4. stores a match-level first-server result of near, far, or withheld;
5. stores persistent end-change candidate intervals;
6. records model, checkpoint, algorithm version, input point IDs,
   confidence gates, timing, and failure state; and
7. publishes results incrementally without delaying access to the match.

The production path uses the official RTMPose-M COCO-17 ONNX checkpoint,
calibration-guided player regions, and no YOLO-family dependency.

### Application responsibilities

The application performs only cheap deterministic work:

1. map near/far first-server evidence into user/opponent using `user_side`;
2. compute ITTF rotation from the resolved first server;
3. fold confirmed winners, lets, deleted points, and user overrides through
   the existing boundary walk;
4. reconcile high-confidence end-change intervals with score-derived
   boundaries; and
5. recompute immediately after a score or correction without rerunning pose.

### Incremental availability

The match and Keep Score remain usable while pose processing is pending. The
application subscribes to or refreshes processing state. Completed evidence
may be applied later, but only through the same precedence and Undo rules.

## Evidence and Resolution Model

### Evidence storage

Add a match-scoped structure evidence record rather than placing raw model
output in user-editable score fields. It contains:

- processing status: `pending`, `ready`, `withheld`, or `failed`;
- algorithm and checkpoint provenance;
- first-server near/far result, confidence class, and contributing point IDs;
- per-point anonymous player assignment and availability;
- end-change candidates with old-state point, new-state point, interval,
  persistence count, and confidence class;
- compute telemetry; and
- created/updated timestamps.

Exact table and column names may follow existing worker conventions, but the
contract must be typed and versioned.

### First-server precedence

Resolved first server follows this order:

1. explicit user selection or correction;
2. high-confidence detected first server mapped through `user_side`;
3. unknown.

The existing `matches.first_server` can remain the resolved value if it gains
an explicit source field such as `first_server_source = user | detected`.
Reprocessing may update a detected value, but must never replace a
user-sourced value. The migration must backfill every existing non-null
`first_server` as `user`; historical selections must not be mistaken for
replaceable detection.

### Game-boundary precedence

Resolved game boundaries follow this order:

1. explicit point-level `game_end_override`;
2. accepted high-confidence persistent end change;
3. the existing 11-point, two-clear score rule.

An end-change candidate is eligible for automatic use only when:

- old and new identities both meet the frozen high-confidence gate;
- persistence is confirmed by at least two eligible points;
- the candidate interval is exact, or an existing score boundary lies
  inside its bracket;
- it is not classified as a deciding-game five-point side change; and
- it does not conflict with a prior user override.

Ambiguous intervals, low coverage, multiple competing candidates, and
possible deciding-game changes are withheld for review. They never interrupt
Keep Score.

The reconciler should return both boundaries and provenance so every surface
reads the same result.

### Undo semantics

When automation changes a boundary, the UI keeps the prior resolved boundary
in the transient undo payload. Undo writes the minimum existing
`game_end_override` needed to restore that boundary:

- `end` at the user-preferred earlier boundary; or
- `continue` at the rejected detected boundary.

That persisted override then outranks future detection. Undoing a detected
first server writes the user's chosen `matches.first_server` with source
`user`.

## Keep Score Experience

### Entry

- When high-confidence first-server evidence is ready, Keep Score opens
  immediately with no “Who served first?” sheet.
- The scoreboard shows ordinary language such as “You serve” or “Vaibhav
  serves.”
- Tapping the server indicator opens the two-choice correction control.
- A correction reanchors the downstream ITTF rotation and becomes
  user-authoritative.

If evidence is still pending:

- Keep Score opens and scoring remains available;
- the server area may say “Detecting first server…” without blocking
  playback; and
- if evidence remains withheld, the existing two-choice question appears at
  the first natural pause rather than at entry.

The player-name setup remains independent. Missing names must not cause the
first-server question to reappear when server detection succeeded.

### Game endings

- A normal score-derived game end appears immediately.
- A later persistent side change that agrees with it causes no additional
  UI.
- If high-confidence evidence moves or creates a boundary, PongLens applies
  it and briefly shows “Game 2 started after Point 39 · Undo.”
- The correction is backdated to the stable point ID even if displayed point
  numbers have changed.

Remove the primary-flow “Didn’t end?”, “Game ended here?”, and persistent
“End game” controls. Manual repair remains available by tapping the game
score and from Point Detail. This cleanup is conditional on the automated
boundary application flag; when that flag is off, the current manual controls
remain available as the rollback experience.

## Point Detail Experience

Point Detail shows resolved facts without turning the page into a model
debugger:

- a server row states who served;
- a game row states “Game ended after this point” or “Game continued”; and
- tapping either row opens its correction control.

When useful, secondary copy may say “Detected from player positions” or
“Corrected by you.” Confidence percentages and model names are hidden from
the normal interface.

Server corrections write a point `server_override`, preserving the current
downstream re-anchoring behavior. Game corrections continue to use
`game_end_override`.

## Match Overview Experience

- Remove the large “Who served first?” banner when high-confidence detection
  is available.
- Timeline dividers and game summaries use the shared reconciled boundary
  result.
- A compact scoring-setup row may show the resolved first server and open
  editing controls.
- Successful automation produces no success banner.
- Only genuinely unresolved evidence produces a quiet notice such as “One
  game boundary may need review,” linking to the relevant point interval.

The overview must not expose raw anonymous-player assignments by default.
Those belong in diagnostics and evaluation tooling.

## First Open and Processing Experience

The existing processing status may add “Analyzing players and game
structure.” This is informational and never blocks opening the match.

When processing is ready before first open, the match opens in its resolved
state with no setup question. When processing finishes after first open, the
application adopts eligible evidence according to the same rules and shows
Undo only if visible scoring state actually changes.

Failures are quiet fallbacks:

- withheld first server uses the lightweight question;
- failed end-change analysis leaves the existing score-derived boundaries;
- no match becomes unscorable because pose evidence is absent.

## Feature Flag and Rollout

Use separate remotely controllable flags for:

1. worker evidence generation;
2. detected first-server application; and
3. detected boundary application.

Roll out in stages:

1. **Shadow:** generate and store evidence, but compare it with existing
   state without changing users' matches.
2. **First-server automation:** remove the question only for high-confidence
   cases and measure correction rate.
3. **Boundary automation:** enable high-confidence auto-correction with Undo
   for a small cohort.
4. **UI cleanup:** remove primary-flow manual boundary prompts after
   correction and undo telemetry demonstrate acceptable precision.

Turning off application flags must leave user overrides and resolved scores
readable.

## Telemetry and Success Criteria

Record aggregate product events without retaining raw video frames:

- processing completion, withholding, failure, wall time, and usable-point
  coverage;
- first-server auto-applied, manually corrected, and time-to-correction;
- boundary agreed, auto-moved, auto-created, undone, and later manually
  edited;
- fallback question shown and answered; and
- processing result arriving before or after first Keep Score entry.

Initial production gates:

- no user-sourced first server is overwritten;
- no explicit game boundary override is overwritten;
- scoring entry is never delayed by RTMPose;
- low-confidence evidence never changes resolved state;
- all automatic state changes have a working Undo;
- score, serve rotation, point detail, timeline dividers, and match summary
  agree because they consume one resolver; and
- feature flags can disable each automatic application path independently.

Precision is more important than coverage. A withheld result is acceptable;
a confident-looking wrong correction is the failure to minimize.

## Testing Strategy

### Pure resolver tests

- source precedence for first server;
- near/far mapping through both `user_side` values;
- no mapping before `user_side` exists;
- score boundary agreeing with a detected interval;
- detected boundary replacing, adding, or withholding;
- deciding-game five-point change rejection;
- explicit `end` and `continue` winning over detection;
- deleted, skipped, unscored, and renumbered points;
- stable-ID behavior after point removal; and
- undo restoring the exact prior result.

### Worker contract tests

- pinned RTMPose/checkpoint provenance;
- sparse-three frame selection and missing-frame withholding;
- two-point persistence;
- confidence and ambiguity gates;
- first-three-point serve consensus;
- idempotent reruns and algorithm versioning; and
- no YOLO-family dependency or provenance.

### UI tests

- high-confidence first server bypasses the setup sheet;
- pending processing does not block Keep Score;
- withheld evidence asks only at the natural fallback point;
- correction reanchors serve rotation;
- automatic boundary toast and Undo;
- no success banner on Match Overview;
- unresolved review notice links to the correct interval; and
- all four surfaces render the same resolved boundary.

### End-to-end acceptance

Replay the reviewed Vaibhav match fixture through the production resolver.
The six known game-end regions must reconcile correctly without using human
grades as model input. Also include fixtures for a deciding-game five-point
change, missing early points, removed clips, partial scoring, and a user
correction made before worker completion.

## Non-Goals

- live RTMPose inference in the browser;
- continuous reprocessing while the user scores;
- serve-spin classification;
- replacing point-winner input;
- exposing raw pose skeletons in the product;
- treating dense inference as production ground truth; or
- automatically acting on low-confidence or ambiguous evidence.

# Canonical scored-match state across PongLens

Store one versioned, database-derived answer for the owner-confirmed score, server, game and timeline state, while preserving the raw human inputs that produced it. Keep worker guesses, manual-cutter boundaries and admin research labels as explicitly named evidence sources so none can silently impersonate another. Roll this out additively across web, iOS, admin, worker, coach, sharing, statistics and exports before removing any existing calculation.

| Document control | Value |
| --- | --- |
| Date / status | September 15, 2026. Recommendation draft for Adil's review; no implementation or deployment is authorized by this document alone. |
| Primary decision | Persist a canonical **derived projection**, not an editable `server` value copied onto each point. Human answers remain the authority; the projection makes every reader use the same interpretation. |
| Scope | Owner scorekeeping, serve rotation, game boundaries, manual cutting, Split, Join, Adjust, Insert, delete/restore, web desktop, mobile web, native iOS, admin Upload Detail, research labelers, worker publication/reprocessing, coach views, shares, statistics, placement, highlights, reels and exports. |
| Evidence | Current repository behavior, migration history, the deployed database schema inspected read-only on September 15, and the existing scorekeeper/playback and hand-cut designs. No production rows were changed. |
| Related design | This document owns scored-match state and its mutation boundary. Source/media playback integrity remains governed by `2026-09-11-scorekeeper-playback-integrity-design.md`; the two designs share revisions and timing observations rather than creating parallel concepts. |
| Deliverable | Architecture, schema, mutation contracts, surface-by-surface behavior, rollout, compatibility, tests, monitoring and documentation handoff. A task-level implementation plan follows only after review. |

## 1. Outcome and invariants

| Invariant | Required result |
| --- | --- |
| One owner score | A point's owner-confirmed winner, let/skip state, server correction and game-boundary correction have one authoritative interpretation across every surface. |
| Derived facts are not editable facts | Server for point 41, score before point 41 and game number are calculated from the owner's inputs. No client writes those answers directly. |
| Worker evidence stays evidence | `points.server`, suggestions, detected first server, side changes and detected rally endings remain machine observations. They never become owner truth without an explicit owner action. |
| Manual cutter is ground truth | The owner's manual-cutter start and end marks are retained in source-video seconds as high-authority human boundaries. They are valid training/evaluation evidence for automatic processing, with `manual_cutter` provenance. |
| Admin research is separate | An admin's `fullmatch_labels` winner/end/let marks are research annotations. They cannot change the player's match score, statistics, shares, coaching or exports. |
| Structural edits are complete operations | Split, Join, Adjust, Insert, delete, restore and hand-cut publication update structure, score lineage, timing validity and the derived projection together. Partial success is not allowed. |
| Old clients keep working during rollout | Existing direct writes continue to work while the new projection is shadowed and verified. Direct score-field grants are revoked only after supported old builds have aged out. |
| No silent fallback | Unknown server stays unknown to score-dependent readers. A worker guess may be displayed as a clearly identified fallback, but is never counted as confirmed truth. |
| No UI redesign | Existing scorekeeper controls, gestures, terminology, colors and layout remain. Any later conflict/health message uses an approved shipped pattern and passes the web/iOS visual gate. |

## 2. Current system and why this change is needed

The current data model stores the owner's inputs correctly, but most derived answers are reconstructed repeatedly in TypeScript and Swift. That duplication is now used by enough surfaces that a small semantic change can leave two correct-looking but different scores.

| Current fact | Where it lives now | What is sound | What remains fragile |
| --- | --- | --- | --- |
| Point outcome | `points.confirmed_winner`, `confirmed_how`, `is_let` | Owner answer is preserved; the database forbids a let plus a winner. | Multiple web and iOS callers patch columns directly, often in separate requests. |
| First server | `matches.first_server`, `first_server_source` | Owner value is distinguished from detected value. | Every reader must remember that a detected value is not manual truth. |
| Per-point server correction | `points.server_override` | `set_server_override` already atomically clears later stale anchors. | The downstream serve walk is reimplemented in TypeScript and Swift. |
| Game boundary | `game_end_override`, `game_winner_override` | Owner can represent missing points and a game whose incomplete recorded score cannot prove its winner. | Boundary movement and named game winner can be written separately. |
| Timeline | Active `points`, ordered by source time with `idx` as the current fallback | Split-born children with high `idx` still land in the correct time position when source times exist. | Join hard-deletes rows; split/join outcomes are applied in follow-up calls; readers sometimes sort by `idx` alone, and the current mixed null/non-null comparator is not a total order. |
| Running score and games | `computeMatchScore` / `GameScore.swift` | Shared web boundary walk handles 11 clear by two and positional overrides. | It is still a port across runtimes rather than one persisted result. |
| Serve rotation | `computeServing` / `Serving.swift` | Handles two-serve blocks, deuce, lets, game alternation and re-anchoring overrides. | Each consumer must fetch the exact input set and call the exact implementation. |
| Score-button end tap | `scored_at_cut_s` | Useful historical human evidence exists. | It is a cut-clock observation and is sometimes confused with outcome or source truth. |
| Manual-cutter boundaries | `hand_cut_drafts.marks[].t0/t1`; published `points.t0/t1` | Owner directly marks serve start and point end in source-video time. | Provenance is implicit in `matches.cut_source`; marks are not normalized into the common evidence model. |
| Admin full-match labels | `fullmatch_labels` | Correctly separate from owner points. | The word “score” can obscure that these labels must never feed owner projections. |
| Worker server | `points.server` | Useful near/far machine guess and first-server prompt aid. | Its `user`/`opponent` names are historical worker-frame labels, not owner-confirmed logical players. |

### Deployed database audit

The read-only production schema inspection confirmed that the live database has the owner fields and edit RPCs described above, but no canonical score revision or projection yet.

| Area | Deployed state on September 15, 2026 |
| --- | --- |
| Owner rows | `matches`, `points`; owner/coach SELECT through RLS, owner column-scoped UPDATE. |
| Structural RPCs | SECURITY DEFINER `split_point`, `unsplit_point`, `merge_points`, `adjust_point`, `insert_point`. |
| Score correction RPC | SECURITY DEFINER `set_server_override`; other score fields still have direct column UPDATE grants. |
| Human boundary archive | `point_boundary_archive`, admin-readable, populated on deletion. |
| Manual cutter | `hand_cut_drafts` with source-time JSON marks, submission freeze and `mode`; worker publishes normal `points`. |
| Research scorer | `fullmatch_labels` with admin-only RLS policy; separate winner/end/let research events. |
| Existing triggers | Version guard, edit/reclip requests, highlight-evidence invalidation, boundary archive and admin-only serve-start guard. |
| Missing pieces | No match score revision, canonical point/game projection, mutation ledger, source-clock observation table or projection-health state. |

## 3. Authority model

Every value must answer two questions: **who asserted it** and **what is it allowed to change**.

| Authority scope | Examples | May change owner score? | May train/evaluate processing? | May drive playback? |
| --- | --- | --- | --- | --- |
| `owner_score` | Winner, skip/let, first server, server override, game end, game winner | Yes | Yes, for outcome/sequence questions | Yes, through resolved score/timing policies |
| `owner_manual_boundary` | Manual-cutter start/end, explicit Adjust/Split/Join boundary | Structure and timing, not winner unless the owner also supplied it | Yes, with provenance and suitability filters | Yes; manual boundary authority preserves requested context |
| `owner_live_observation` | Eligible first score-button end while continuously watching | No; accompanies an owner score command | Yes, but it is a human tap with measured uncertainty | Yes under the existing tap policy |
| `worker_evidence` | `points.server`, suggestion, detected first server, side-change marker, rally end | No | Yes as model output or candidate evidence | Only through an explicitly enabled conservative policy |
| `admin_research` | `fullmatch_labels`, admin event corrections, card review themes/notes | Never | Yes | Research pages only |
| `system_projection` | Score before/after, resolved server, game number, games tally | Derived only | Can be joined to evidence; is not a new human label | Yes for all owner-facing readers |

### Manual-cutter ground-truth rule

| Manual-cutter datum | Meaning | Storage and use |
| --- | --- | --- |
| `mark.t0` | Owner's source-video serve-start boundary after the manual cutter's documented reaction-time lead | Persist as `manual_cutter_start` in source seconds; retain raw tap/rate metadata. |
| `mark.t1` | Owner's source-video point-end boundary | Persist as `manual_cutter_end` in source seconds. Playback treats it as a structural manual end and retains the configured post context. |
| `mark.w` / `mark.let` | Owner's answer when the selected manual-cut mode includes scoring | Publish as the normal owner outcome and include in the canonical projection. |
| A cut-only mark | A trusted human boundary with no winner | Keep it as boundary truth; leave outcome unscored. A visible non-let point still consumes a serve position once first server is known, matching current behavior. |
| Evaluation use | Valid reference for evaluating the automatic worker on the same source video | Do not call it an independent evaluation of the manual cutter that produced it. Compare source-clock boundaries, not the rendered clip's own padded edges. |

This supersedes the older blanket instruction that hand-cut points should never enter the boundary corpus. The correct protection is provenance and evaluation discipline, not discarding high-quality human labels.

## 4. Recommended architecture

```text
owner actions ───────────────┐
manual-cutter publication ──┼──> typed atomic database commands
legacy client writes ────────┘               │
                                              ├── lock match
                                              ├── validate expected revision
                                              ├── write raw owner inputs
                                              ├── write timing/lineage records
                                              ├── recompute canonical projection
                                              └── return one revisioned snapshot

worker evidence ─────────────────────────> raw evidence columns/tables
admin research labels ───────────────────> research-only tables
                                                    │
                                                    └── never enter owner projection

canonical projection ──> web / iOS / admin read view / coach / shares
                     └─> stats / placement / highlights / reels / exports
```

### Why a projection instead of a stored editable server

| Option | Decision |
| --- | --- |
| Add `points.confirmed_server` and update downstream cards after every score change | Rejected. A correction to an early let, missing point or game boundary can change dozens of later servers; copied facts become stale. |
| Continue calculating everything independently in each reader | Rejected. It preserves the present drift risk and makes every narrow RPC responsible for reconstructing the same rules. |
| Full event-sourced rebuild of all match data | Rejected for now. It is larger than the problem and would force unrelated worker/media migration. |
| **Versioned database-derived projection plus a compact mutation ledger** | Recommended. Raw facts stay understandable, readers become simple, history is traceable, and rollout is additive. |

### Ownership of logic

| Layer | Responsibility |
| --- | --- |
| Database projector | Authoritative deterministic fold over one match's current owner inputs and visible timeline. Produces the persisted projection. |
| Typed database commands | Authorization, locking, validation, idempotency, coupled writes and one projection refresh. |
| Web and iOS | Render returned projection; maintain temporary optimistic UI only while a command is pending. They do not independently decide committed truth. |
| TypeScript reference model | Human-readable executable specification and fixture generator during migration. Must match database output exactly. |
| Swift model | Temporary optimistic port only during migration; parity-tested from the same fixtures, then reduced once all reads use the projection. |
| Worker | Publishes evidence and point structure; calls the bulk publication contract once. It never computes owner truth. |

## 5. Database design

All names below are proposed. The implementation migration may adjust mechanical names, but not their authority or behavior.

### 5.1 Match revision and projection health

Add to `matches`:

| Column | Type / default | Purpose |
| --- | --- | --- |
| `score_revision` | `bigint not null default 0` | Monotonic revision of score- or sequence-affecting owner state. |
| `score_projection_revision` | `bigint not null default 0` | Revision currently represented in projection rows. Equality means current. |
| `score_projection_status` | constrained text: `empty`, `current`, `stale`, `error` | Operational state for safe rollout and admin diagnostics. |
| `score_projection_error` | nullable text, admin/service only | Sanitized last projection failure; never returned in public/coach RPCs. |
| `score_projection_updated_at` | timestamptz | Diagnostics and rollout measurement, not scoring semantics. |

Only internal functions/service role may update these columns. Owner clients receive the values through scoped reads but receive no direct UPDATE grant.

### 5.2 Canonical point projection

Create private table `point_score_state`:

| Column | Meaning |
| --- | --- |
| `point_id` primary key / `match_id` | Current active point and owning match. Deleted or merged-away points have no active projection row. |
| `score_revision` | Revision shared by every row in the match snapshot. |
| `timeline_ordinal` | Zero-based position in the active timeline. If every active point has `t0`, sort by `(t0, idx, id)`; if any active point lacks `t0`, fall back for the whole match to `(idx, id)` and report the legacy fallback in projection diagnostics. |
| `display_number` | One-based card number for the visible timeline. Never use `idx` as a display number. |
| `game_number` | One-based game containing this point. |
| `score_user_before`, `score_opponent_before` | Current-game score before this visible point. |
| `score_user_after`, `score_opponent_after` | Current-game score after its outcome, or unchanged for unscored/skipped points. |
| `confirmed_winner` | Copied owner outcome for a stable narrow read; null for unscored/skipped. |
| `skip_kind` | Null or normalized `let`, `misrecorded`, `other`. |
| `resolved_server` | `user`, `opponent`, or null when owner-authoritative rotation cannot be established. |
| `server_source` | `rotation`, `owner_override`, or `unresolved`. Never call the worker fallback canonical. |
| `serve_number_in_block` | 1/2 before deuce, always 1 in one-serve deuce rotation; useful diagnostics, not UI copy. |
| `ends_game` | Whether a game closes after this point under the canonical walk. |
| `game_boundary_source` | `automatic_score`, `owner_end_override`, or null. Detected side changes do not silently create canonical boundaries. |
| `resolved_game_winner` | `user`, `opponent`, or null when a manually closed incomplete game has no owner winner. |
| `all_visible_points_answered_through_here` | Read optimization for resumable scorekeeper progress; not a claim that the match is complete. |
| `computed_at` | Operational timestamp only. |

Constraints/indexes:

- Unique `(match_id, timeline_ordinal)`, `(match_id, display_number)` and `(match_id, point_id)`.
- Every row for a match must carry the match's current `score_projection_revision` before the snapshot is made visible.
- RLS mirrors `points` SELECT access for owner and accepted coach. Direct INSERT/UPDATE/DELETE is denied to all client roles.
- Public shares never select this table directly; narrow SECURITY DEFINER functions expose only permitted fields.

### 5.3 Canonical match summary

Create private table `match_score_state` with one row per match:

| Column | Meaning |
| --- | --- |
| `match_id` primary key / `score_revision` | Snapshot identity. |
| `games_user`, `games_opponent` | Games whose winner is proved by score or explicitly named by the owner. |
| `current_game_number` | One plus completed game count. |
| `current_score_user`, `current_score_opponent` | Running score in the open game. |
| `completed_games` | Ordered JSON containing final point scores, winner and closing point ID; bounded by match length. |
| `visible_point_count`, `answered_point_count`, `skipped_point_count` | Stable progress counts. |
| `all_visible_points_answered` | True only when every active non-skipped card has a winner. This does not prove no rally is missing. |
| `first_server` / `first_server_source` | Effective owner-confirmed anchor or null. A detected candidate may be returned separately, never as owner truth. |

### 5.4 Source-clock timing observations

Create private table `point_timing_observations`:

| Column | Meaning |
| --- | --- |
| `id`, `match_id`, `point_id` | Stable observation identity and parent. Point deletion archives rather than destroys high-authority human rows. |
| `kind` | `serve_start` or `point_end`. |
| `source_s` | Canonical processed-source second. This is the comparison coordinate. |
| `origin` | `manual_cutter`, `continuous_first_score`, `legacy_cut_tap`, `worker_rally_end`, or another explicitly registered point-linked origin. |
| `authority_scope` | `owner_manual_boundary`, `owner_live_observation`, or `worker_evidence`. Admin full-match labels remain deliberately free-standing. |
| `timing_revision` | Point timing revision this observation describes. |
| `media_kind`, `media_revision`, `media_local_s` | Evidence needed to audit the source conversion. Manual cutter uses source media directly. |
| `reaction_meta` | Manual-cutter raw tap/rate/lead or live-score continuity metadata. |
| `eligible_for_training` | Explicit decision, not inferred from origin alone. |
| `eligible_for_playback` | Explicit policy result; manual structural ends are applied with padding, not score-tap trimming. |
| `invalidated_at`, `invalidated_reason` | Null while active; structural changes invalidate affected observations without deleting history. |
| `request_id`, `created_by`, `created_at` | Idempotency, actor and audit. |

Rules:

- A manual-cutter publication writes both start and end observations directly from each source-time mark and preserves raw `tap`, `rate` and applied lead.
- A cut-only manual pass writes observations even when it writes no winners.
- Manual-cutter observations are eligible for the automatic-worker corpus after ordinary validity checks; evaluation must record that their origin is `manual_cutter`.
- Existing `scored_at_cut_s`, `serve_start_at_cut_s` and `rally_end_cut_s` remain during compatibility. They are adapters into the new model, not repurposed columns.
- Legacy cut-clock values are converted only when `cut_t0`, pads and the relevant media/timing revision are known. Ambiguous rows remain legacy rather than being given invented precision.
- Admin full-match labels remain in `fullmatch_labels`. A research-only union view may present both datasets on one source clock, but it must preserve `admin_research` scope and may never write those free-standing events into point-linked owner observations.

### 5.5 Timing and media revisions

Add to `points`:

| Column | Behavior |
| --- | --- |
| `timing_revision bigint not null default 0` | Increments when `t0`, `t1`, tight edges or structural identity changes. Winner-only edits do not increment it. |
| `end_authority` | `automatic` or `manual`; explicit Adjust/Join/Split boundaries set manual authority as specified below. |

Media revision receipts described by the playback-integrity design remain separate. Re-encoding a clip changes media revision, not score or timing revision.

### 5.6 Mutation ledger

Create append-only private table `match_score_mutations`:

| Column | Purpose |
| --- | --- |
| `request_id` unique | Safe retry across poor mobile connectivity. |
| `match_id`, `actor_id`, `authority_scope` | Ownership and audit. Owner mutations use `owner_score`; research labels use their existing separate table and never enter this ledger. |
| `action` | Typed action name, not arbitrary prose. |
| `affected_point_ids` | Exact rows touched. |
| `before_state`, `after_state` | Minimal scorer/timing fields needed for audit and undo; exclude large placement/suggestion JSON. |
| `base_revision`, `result_revision` | Conflict and lineage. |
| `created_at` | Ordering/audit only. |

The ledger is not the primary read model and is not public event sourcing. The current rows plus canonical projection remain the normal truth.

## 6. Deterministic projection rules

The database projector must match the current approved behavior before any reader switches.

### 6.1 Timeline and outcome

1. Read active points only (`deleted = false`).
2. If every active point has source time, order by `(t0, idx, id)`. If any point lacks `t0`, order the entire legacy match by `(idx, id)` and record the fallback. Do not reproduce the current non-transitive mixed comparator in the database.
3. Every visible point gets a display number, including unscored and skipped points.
4. `is_let = true` contributes no score and consumes no serve. `confirmed_how` distinguishes let/misrecorded/other.
5. Every visible non-skipped point consumes one serve position even when its winner is still null. This preserves current card-position semantics during partial scoring.
6. Only `confirmed_winner` advances the point score.
7. Warmup remains a separate analysis exclusion; it does not silently disappear from the score walk unless the existing visible-timeline contract explicitly marks it skipped/deleted.

### 6.2 Game boundaries

1. Automatic boundary: first player at 11 with a lead of at least two.
2. `game_end_override = end` closes after that point, even if the point is unscored or skipped. It is positional.
3. `game_end_override = continue` suppresses automatic closure until a later explicit `end`.
4. `game_winner_override` applies only to the game closed on the same point and overrides the heuristic when present.
5. Detected side-change evidence may produce a suggestion/marker only. It does not enter the canonical boundary walk until the owner confirms “Game ended here.”

### 6.3 Serve rotation

1. Owner-confirmed `matches.first_server` anchors game 1. A detected value remains a candidate until explicitly accepted.
2. Serve alternates every two visible non-skipped points before deuce.
3. At 10–10 and later, serve alternates every point.
4. The first server alternates at each canonical game boundary.
5. A `server_override` is the server on its own point and a downstream anchor.
6. An override that agrees with the walk is a pin and preserves block phase.
7. A contradictory override starts a new serve block and flips the current game's first-server parity, matching the existing `computeServing` behavior designed for a missing rally.
8. A skipped point reports the current server but does not advance the rotation; a positional game boundary on it still alternates the next game's first server.
9. If first server remains unresolved, `resolved_server` remains null. UI may show the existing worker guess as `auto`, but confirmed serve statistics do not use it.

### 6.4 Physical near/far side

The canonical projection stores the existing logical player slots (`user`/`opponent`), not a mutable machine-frame label. A neutral or third-party match continues to render those slots with the two player names rather than claiming the uploader played. Physical side remains derived from `matches.user_side`, game number and the approved side-change rules; the deciding-game change at five remains a distinct side/presentation concern and must not be invented by the score projector.

## 7. Atomic command contracts

Prefer typed public RPCs over one arbitrary JSON dispatcher. All call a single internal authorization/locking/projector implementation, accept `request_id` and `expected_score_revision`, and return the same compact canonical snapshot.

| Command | Coupled work in one transaction |
| --- | --- |
| `set_point_outcome_v2` | Winner/skip/how plus an eligible first-score observation when supplied; enforce let/winner exclusivity; refresh projection. Corrections do not overwrite an existing end observation. |
| `set_first_server_v2` | Set `first_server` and `first_server_source = user`; refresh every downstream server. |
| `set_server_override_v2` | Set/clear one anchor, clear later stale anchors under the existing rule, refresh projection. |
| `set_game_boundary_v2` | Set/clear end override and its optional named game winner together; refresh projection. Moving a boundary is one command touching old and new anchors. |
| `split_point_v2` | Split structure, assign both segment dispositions, timing authority/revisions, invalidate affected observations, clear stale later server anchors, request reclip, refresh projection. |
| `unsplit_point_v2` | Restore parent plus all scorer/timing fields from the recorded split mutation, remove child, refresh projection. |
| `merge_points_v2` | Validate adjacency, select survivor/outcome explicitly, archive merged rows and observations, extend survivor, set manual end authority, request reclip, refresh projection. |
| `adjust_point_v2` | Re-anchor `cut_t0`, update bounds/tight flags, increment timing revision, invalidate observations for moved edges, request reclip, refresh if ordering can change. |
| `insert_point_v2` | Insert, trim overlapping neighbors, re-anchor next point, assign optional outcome, increment timing revisions, clear later server anchors, request reclip, refresh projection. |
| `set_point_visibility_v2` | Soft-delete/restore with expected revision; refresh display numbers, scores, games and rotation. High-authority observations are retained/archived, never discarded. |
| `publish_hand_cut_v2` | Publish all created points, manual start/end observations, outcomes, clip paths and match status; refresh exactly once before commit. |
| `replace_worker_points_v2` | Bulk worker publication/reprocessing with processing-version lock; preserve owner-owned state according to existing version policy; refresh once. Worker evidence never writes owner overrides. |

### Common response

Each successful command returns:

- `request_id`, `match_id`, `score_revision`, `score_projection_status`;
- affected raw points and active canonical point states;
- canonical match summary;
- changed timing/media readiness fields required by the calling surface;
- a stable conflict/error code rather than database prose.

### Conflict and retry behavior

| Situation | Required behavior |
| --- | --- |
| Same `request_id` retried | Return the prior committed response; do not apply twice. |
| Expected revision is current | Lock match, apply, recompute, commit. |
| Expected revision is stale | Apply nothing; return `score_conflict` with current revision/snapshot. Client replaces optimistic score state without losing unrelated notes/drafts. |
| Projector fails | New command rolls back completely. No raw input may commit without its canonical projection. |
| Reclip/media generation fails later | Score/structure remains committed; media readiness explains the failure. It does not roll back the human answer. |
| Old client direct write during compatibility | Trigger marks revision and recomputes. During shadow phase projection failure is logged and leaves the old write intact; after parity promotion, fail closed. |

## 8. Structural-action behavior matrix

| Action | Owner score | Server/game sequence | Timing ground truth | Clip/media | Undo/history |
| --- | --- | --- | --- | --- | --- |
| First winner while continuously playing | Set winner | Recompute from this position | Add eligible end observation only when identity/continuity checks pass | No immediate reclip | Ledger stores prior outcome/observation |
| Correct winner | Change winner | Recompute games and downstream serve where deuce/boundary changes | Preserve prior valid end | No reclip unless selection artifact changes | Reversible by revisioned mutation |
| Clear outcome | Clear winner | Recompute | Deactivate score-tap observation; retain history | No clip deletion | Undo can restore both |
| Mark let/skip | Clear winner and set skip | Point no longer advances score or serve | Deactivate score-tap end; manual structural marks remain | No automatic structural delete | Undo restores all fields |
| Split | Explicit outcome per resulting segment; no inherited accidental winner | Adds a visible position and can shift every later server | Split boundary is manual; retain source marks with parent/child lineage | Parent/child require fresh clips | Atomic and fully undoable while descendants unchanged |
| Join | Explicit survivor outcome | Removes positions and can shift every later server | Survivor end becomes selected manual end; merged observations archived | Survivor requires fresh clip | Preserve merged rows in mutation/archive so recovery is possible even if UI initially keeps confirmation |
| Adjust start only | Outcome unchanged | Refresh only if order can change | New manual start; invalidate old start observation, preserve valid end | Re-anchor and reclip | Restore prior window/revision |
| Adjust end only | Outcome unchanged | Score sequence unchanged | New manual end; invalidate old end observations, do not let a stale score tap shorten it | Reclip | Restore prior authority/observations |
| Insert | New point initially unscored unless owner answers | Adds position; clears later server anchors under current rule | Owner-selected source window is manual ground truth | Use existing source/media resolver until clip ready | Mutation records neighbor trims and new row |
| Delete | Point excluded | Renumber/recompute all downstream state | Human observations archived and associated with deleted point | Existing storage retention policy unchanged | Restore recreates projection from retained row |
| Restore | Point included at source position | Renumber/recompute | Reactivate only observations still valid for its timing revision | Reclip only if file stale/missing | Expected revision prevents overwriting later work |
| Reprocess automatic match | Preserve owner facts only through explicit identity/version mapping | Recompute against mapped active timeline | Never attach old observations to a different rally without a proven mapping | New media revision | Version audit records mapping |
| Publish manual cut | Outcomes optional by cut mode | Compute canonical score immediately | Persist manual start and end for every mark | Publish clips/cut as today | Publication is atomic from reader perspective |

## 9. Surface-by-surface implementation

### 9.1 Owner web: desktop and mobile web

| Area | Change | Preserve / verify |
| --- | --- | --- |
| Match loader | Fetch raw points plus canonical `point_score_state` and `match_score_state` at one revision. | Existing responsive layout and point ordering. Test desktop and 393×660 mobile. |
| Score cards / Keep Score player | Route every winner, skip, first-server, server override and game-boundary action through typed commands. | Button labels, keyboard shortcuts, autoplay, first-server prompt and optimistic responsiveness. |
| Score tap | Send playback identity/continuity evidence only on eligible first answer. | Corrections, Review, scrubbing, pauses and auto-pauses must not manufacture ends. |
| Scorecard / dividers | Render canonical before/after score, game boundary and server. | Existing colors and wording; no new explanatory UI in normal success. |
| Point detail | Use canonical score/server and source-clock timing resolver. | Point notes, stars, loss reasons and video behavior remain independent. |
| Modify sheet | Replace sequential Split/Join/outcome writes with atomic commands. | Current marker interaction and confirmation; errors keep the sheet open with committed truth. |
| Insert point | One command covers insert, neighbor trims, optional answer and reclip state. | Instant preview where source is available. |
| Undo | Send inverse mutation with expected result revision, not ad hoc field writes. | Undo restores all coupled fields and refuses visibly after a conflicting edit. |
| Match library | Read canonical summary counts/tally instead of re-folding a narrow point list. | Cards and filters remain visually unchanged. |

No customer-facing design change is required for the happy path. If a conflict message is needed, use an existing inline recovery/error component; render and obtain approval on desktop and 393×660 before publishing.

### 9.2 Native iOS

| Area | Change | Preserve / verify |
| --- | --- | --- |
| Models | Add revisioned projection decoders; keep backward-compatible optional fields while old backend responses exist. | Older server response must not crash the installed build. |
| Match detail | Read canonical score/server/game state rather than committing the Swift fold as truth. | Existing cards, sheets, haptics and scrolling. |
| Player takeover | Submit typed score commands and eligible observation metadata; reconcile from returned snapshot. | Continuous play rhythm, speed controls, voice scoring and background/foreground behavior. |
| Point actions | Replace direct `points.update` and standalone boundary writes. | Same user-visible actions and failure recovery. |
| Point extras | Replace Split/Join/Adjust/Insert RPC sequences with v2 atomic commands. | Same marker math and source preview, now server-validated. |
| First-server picker | One revisioned match command. | Existing prompt and detected suggestion remain; detected is not silently confirmed. |
| Statistics / placement | Read canonical resolved server and game number. | Unknown server keeps serve-based rows gated as today. |
| Coach workspace | Decode canonical narrow projection. | Coach remains read-only to owner score. |

Before SwiftUI changes, use the shipped counterpart named in `ios/AGENTS.override.md`; render every changed/error state in the simulator. A web screenshot does not verify native iOS.

### 9.3 Admin Upload Detail

| Concern | Required behavior |
| --- | --- |
| Owner score display | Read the canonical owner projection, including deleted raw cards as separate audit rows where needed. Never re-score independently in the browser. |
| Admin notes/themes/event corrections | Stay in admin tables and retain their current behavior. They do not increment owner score revision. |
| Worker evidence | Continue displaying worker server/bounce/table evidence, visibly separate from `resolved_server`. This is useful disagreement evidence. |
| Projection diagnostics | Add a compact read-only line in the existing diagnostics card: owner score revision, projection current/stale/error, active/answered counts. No owner score editing control is introduced. |
| Deleted/merged lineage | Admin can inspect why a card disappeared or was joined through mutation/archive data without treating it as active. |
| Access | Continue through admin-only SECURITY DEFINER detail RPC; do not broaden `points` RLS or expose projection errors to players. |

Any diagnostic UI addition requires the normal visual-reference gate and Adil's screenshots approval before web publication.

### 9.4 Admin/research full-match scorer

| Rule | Required behavior |
| --- | --- |
| Namespace | `fullmatch_labels` and associated research tables remain `admin_research`. |
| Winner terminology | A research `winner = me/opponent` describes the lab match coordinate system, not the uploader's confirmed winner. |
| Isolation | Inserts/updates/deletes never call the owner score projector and never affect `matches.score_revision`. |
| Research sequence | If a running research score is useful, derive it into a separately named `research_score_state` or in-page calculation keyed by `match_key`; never reuse `point_score_state`. |
| Promotion | Moving a research annotation into owner truth requires a future explicit owner/admin adjudication workflow with audit. It is not part of this design. |

### 9.5 Manual cutter

| Stage | Required behavior |
| --- | --- |
| Draft | `hand_cut_drafts` remains owner-only scratch work; edits do not touch match score revision because published points do not exist yet. |
| Submission freeze | Keep the current row lock, validation, job creation and frozen marks. Store a draft schema version so old/new mark shapes are distinguishable. |
| Worker build | Reuse current source-window/cut mapping and independent duration/anchor checks. |
| Publication | Replace row-by-row winner patches with `publish_hand_cut_v2`: points, outcomes, manual-cutter observations, projection and ready status become visible together. |
| Cut-only mode | Publish boundaries and unscored points; canonical progress correctly says unanswered. |
| Cut-and-score mode | Publish boundaries and owner outcomes; compute server only when first server is owner-confirmed. |
| Failure/retry | Preserve current recoverability. A failed publish leaves no partial projection; retry uses the same frozen draft. |
| Corpus | A normalized view exposes manual-cutter source boundaries with origin and reaction metadata. Do not derive them back from cut-clock fields. |

### 9.6 Worker and remote execution locations

| Area | Required behavior |
| --- | --- |
| Automatic point publication | Bulk publish points/evidence, then refresh once in the same database transaction/contract. Avoid one full-match projection per inserted point. |
| Processing versions | Keep existing active-version guards. Projection rows belong to the active owner timeline, not an obsolete processing version. |
| Reprocessing | Never overwrite owner `first_server_source = user`, owner outcomes or owner overrides with detection. Map preserved facts only where point identity is proven. |
| `points.server` | Keep as raw worker-frame evidence for diagnosis and first-server suggestion. Do not rename or reinterpret historical rows. |
| Mac / remote parity | Both execution locations call the same database publication contract and ship the same source revision. No separate projection logic in Python. |
| Jobs/admin processing | Projection refresh stays synchronous and is not a new user processing job. `/admin/processing` needs no lane/stage unless implementation later introduces an async repair queue. |

### 9.7 Coach, shares and public readers

| Reader | Required behavior |
| --- | --- |
| Active coach order/workspace | Read the owner's canonical revision and remain unable to mutate owner score. Refresh without losing a coach's draft finding. |
| Delivered findings | Store the point ID and score revision used for display. A later score correction updates contextual labels safely without changing authored text. |
| Match share | Narrow RPC exposes canonical score, game and server fields needed by the shared view; no mutation history, raw observations or projection errors. |
| Single-point share | Expose only that point's permitted derived context. Do not reveal other points to reconstruct the game. |
| Anonymous/public | New tables remain private by default. SECURITY DEFINER functions validate token scope before returning derived data. |

### 9.8 Statistics, placement, analysis and journal

| Consumer | Change |
| --- | --- |
| Match statistics | Use canonical outcome, game number and resolved server. A worker guess cannot enter confirmed serve win/loss rates. |
| Aggregate statistics | Read a private/scoped projection view, paginated and revision-consistent; remove independent serve walks after parity. |
| Placement maps | Join each bounce to canonical logical server/game, then use existing physical-side logic. Raw worker `server` remains available for diagnostics only. |
| Match analysis | Use canonical score sequence and boundary source; analysis-specific shot/serve attributes remain independent. |
| Journal/AI prompts | Read the same narrow canonical summary and point state so generated prose cannot disagree with the match header. Do not expose mutation history unless specifically needed. |

### 9.9 Highlights, reels and exports

| Artifact | Required behavior |
| --- | --- |
| Highlight membership | Record the score revision when winner/server/game-dependent selection runs. Generic rally quality is not invalidated by a winner label alone. |
| Score overlays | Manifest includes canonical score revision and per-point before/after values. |
| Reel/export request | Read one consistent revision; if match and point rows disagree, retry rather than render a mixed scoreboard. |
| Stale completion | A worker result built for an obsolete score revision may retain its media file but cannot be published as current metadata. Requeue only when the artifact's actual inputs changed. |
| Source selection | Continue to follow the playback-integrity media resolver; canonical score state does not prove footage availability. |

## 10. Compatibility and rollout

### Phase 0: freeze behavior in fixtures

- Build a single JSON corpus covering normal games, deuce, lets/skips, partial scoring, missing rallies, contradictory/agreed server anchors, manual/automatic boundaries, named incomplete-game winners, split children ordered by time and deleted cards.
- Generate expected output from the currently approved TypeScript walk.
- Assert exact parity in TypeScript, Swift and the new database projector.
- Add source-clock manual-cutter fixtures including reaction lead and cut-only mode.

### Phase 1: additive schema and shadow projection

- Add tables/columns/RLS with no reader switched.
- Backfill canonical state in bounded match batches and record parity differences; do not rewrite owner inputs.
- Recompute in shadow after old direct writes. During this phase, projection errors are logged for admin and do not block existing scoring.
- Compare every active scored match against current web logic, including time-order reconstruction rather than `idx` order.

Exit gate: zero unexplained semantic differences. A known malformed row must be classified and fixed/isolated explicitly, not waived as “close enough.”

### Phase 2: atomic commands, old readers

- Deploy typed RPCs and route web/iOS mutations through them behind a server-controlled capability.
- Continue rendering with existing calculations while comparing returned canonical snapshots in telemetry.
- Publish manual-cutter points through the atomic bulk path and begin retaining normalized manual boundaries.
- Keep legacy direct column grants for supported old app builds.

Exit gate: command retries, conflicts, offline/reconnect, undo and all structural operations pass on web and iOS; no projection mismatch in the canary cohort.

### Phase 3: reader migration

Switch in this order so internal evidence catches problems before broad public exposure:

1. Admin Upload Detail diagnostics and internal research readers.
2. Owner web desktop/mobile behind a reversible read flag.
3. Native iOS after backend backward compatibility and simulator/device verification.
4. Coach workspaces and delivered finding context.
5. Match library, stats, placement, journal/analysis.
6. Share RPCs, highlights, reels and exports.

Each reader keeps an emergency fallback to the existing raw-field calculation for one release window. Fallback use is measured and visible to admin; it must not silently persist indefinitely.

### Phase 4: enforcement and cleanup

- After supported old clients age out, revoke direct UPDATE grants on owner score fields and require typed commands.
- Remove duplicated committed-truth folds from UI surfaces; retain a small optimistic reducer and parity fixtures.
- Keep raw owner inputs, worker evidence, research labels, timing observations and mutation lineage.
- Do not drop legacy timing columns until every reader and archive/export has migrated and a rollback release has passed.

### Rollback

| Failure point | Rollback |
| --- | --- |
| Shadow schema/projector | Disable shadow refresh; existing clients continue on raw columns. |
| New commands | Disable capability; clients return to old write path while schema remains additive. |
| Reader migration | Flip affected reader back to existing calculation; no data reversal required. |
| Worker publication | Roll worker release to the prior package; additive DB accepts old writes. Manual draft remains recoverable. |
| Public/share projection | Restore prior RPC definition from migration; private tables remain inaccessible. |

No rollback deletes projection or mutation data. Destructive cleanup waits until after the rollback window.

## 11. Verification matrix

### Core parity cases

| Case | Assertions |
| --- | --- |
| 11–0, 11–9, 12–10, long deuce | Scores, boundary, server blocks and next-game first server exactly match current approved logic. |
| Let/misrecorded between serves | Same server repeats; score unchanged; display number retained. |
| Unscored visible cards | No score movement but serve position advances; later confirmed score remains consistent. |
| Positional boundary on unscored/skipped card | Game closes and next game's server alternates; point contributes no score. |
| `continue` then later `end` | Automatic closure remains suppressed; named winner attaches to the explicit closing point only. |
| Agreeing/contradicting server override | Agreeing pin preserves phase; contradiction restarts block and corrects downstream parity. |
| Deleted early point | All later display numbers, scores and servers recompute; archived human evidence remains. |
| Time-ordered split child with high `idx` | Child appears beside parent, not at end of match. |

### Mutation and structural cases

- Every command is tested for success, authorization failure, stale revision, duplicate request, network retry and server error.
- Split into two and three; fail after the first requested marker; Undo; split a previously adjusted point.
- Join two and three; conflicting outcomes; preserved notes/tags; recovery from archived merged rows.
- Adjust start, end and both; tight/full padding transitions; stale observation invalidation; source/cut anchor parity.
- Insert before first, between, after last, overlapping neighbors and in removed footage.
- Delete/restore scored, skipped, boundary-carrying and server-anchor points.
- Reprocess with exact point mapping, partial mapping and no mapping; owner truth is never attached speculatively.
- Manual cut-only and cut-and-score; 30/60 fps source; retryable and terminal failure; duplicate job delivery; one failed clip requiring reclip.

### Surface acceptance

| Surface | Required verification |
| --- | --- |
| Web desktop | Real `npm run build`; rendered owner scoring, Modify, admin diagnostics, coach and share states at desktop width. |
| Mobile web | Same flows at 393×660, including inline errors/conflicts and action touch targets. |
| Native iOS | Unit/parity tests plus simulator screenshots and functional run for score, Undo, first server, boundary, Split/Join/Adjust/Insert and coach read-only state. |
| Worker | Mac and remote package parity; automatic and hand-cut publication; old package against additive schema; new package rollback. |
| Database | Migration on a production-like copy, RLS/grant tests for owner/coach/admin/anon/worker, concurrent command tests and bounded backfill timing. |
| Public/export | Token-scope tests, no private provenance leakage, revision-consistent reel/highlight manifests and stale completion behavior. |

### Data-corpus verification

- Reconstruct a representative corpus from scored production matches using visible time order, not `idx` alone.
- Include matches with owner first server, detected-only first server, overrides, lets/skips, manual game ends, joins, splits, deleted points and manual cuts.
- Human boundary accuracy remains evaluated in source seconds. Score taps keep their measured uncertainty; manual-cutter start/end retains provenance, reaction metadata and structural authority.
- No experiment treats `points.server` as confirmed server or `fullmatch_labels` as owner score.

## 12. Observability and operational safety

| Signal | Where / action |
| --- | --- |
| Projection mismatch count | Admin-only metric by reader/runtime and rule case; must reach zero before a read switch. |
| Projection status/error | Upload Detail diagnostics; alert on any `error` or stale beyond a short transaction/backfill window. |
| Command conflict rate | By web/iOS build and action; a rise indicates stale state or double writers. |
| Idempotent retry rate | Confirms mobile reconnect behavior without duplicate mutations. |
| Command latency | p50/p95 by point count and action. Target keeps synchronous recompute comfortably below interactive latency. |
| Old direct-write rate | Used to decide when grants can be revoked, not guessed from release date. |
| Artifact stale discard/requeue | Ensures score corrections do not publish outdated overlays. |
| Manual-cutter corpus growth | Counts start/end observations, invalid rows and provenance; never reports them as score-button labels. |

The projection is a bounded fold over at most a few hundred point rows, so synchronous computation should be cheaper and more robust than an asynchronous worker stage. If measured p95 violates the interaction budget, optimize the database fold or return a cached snapshot; do not expose a new customer-visible processing job without a separate design.

## 13. Documentation and editor handoff

This is part of the feature, not cleanup after it.

| Durable location | Required update when implemented |
| --- | --- |
| `CLAUDE.md` | Canonical source of truth for authority, reconstructing cards, time ordering, score/game/server rules, manual-cutter ground truth, admin-research isolation, revisions and atomic commands. Restore/update the currently missing “Reconstructing production's cards” guidance. |
| `AGENTS.md` | Keep it as the short entry point, but add a highlighted pointer to the canonical scored-match section and state that manual-cutter marks are source-clock human ground truth. Do not duplicate the full algorithm. |
| This architecture document | Record approved decisions and later implementation references; update status and migration/build identifiers on completion. |
| Migration comments | Name authority on every new table/column/function, RLS intent, ordering rule and compatibility contract. |
| Shared fixture README | Explain how TypeScript generates the canonical fixture and how Swift/SQL/Python verify it. Claude and Codex must run the same parity suite before changing semantics. |
| Worker release manifest | List the DB migration floor, publication contract version and source commit. Both worker locations reject an incompatible package cleanly. |
| Release handoff note | State exact web build, iOS build, worker release, migrations, feature flags, verification performed and rollback switch. This is what concurrent Claude Code/Codex tasks reconcile before packaging. |

### Rules for future editors

1. Read `CLAUDE.md` before touching score, serving, game boundaries, point order, manual cutter, point timing or structural edits.
2. Change the reference rule and parity fixture first; never patch only TypeScript, Swift, Python or SQL.
3. Owner score, admin research and worker evidence are separate namespaces. Crossing them requires an explicit adjudication design.
4. A new score-affecting field must declare whether it increments score revision, timing revision, both or neither.
5. A new reader must consume a revision-consistent projection or document why it cannot.
6. A new public field must pass the anon allow-list/RLS review; private projection tables are not public shortcuts.
7. Concurrent worker releases must be reconciled into one package and one documented release manifest before restart.

## 14. Implementation boundaries and completion definition

### Included

- Canonical owner score/game/server projection.
- Source-clock timing observation normalization, including manual-cutter ground truth.
- Atomic score and structural mutations with revision/idempotency.
- Additive compatibility for old clients and old worker packages.
- All reader migrations and scoped public/admin contracts.
- Documentation, parity fixtures, monitoring and rollback.

### Not included

- Changing the body/ball algorithm, table calibration or cut thresholds.
- Automatically promoting worker/admin guesses into owner truth.
- Redesigning the scorekeeper or manual cutter.
- Reclassifying old ambiguous taps as precise labels.
- Solving all media-source/playback issues beyond the shared revision/observation boundary defined in the playback-integrity design.
- Bulk repairing historical owner scores without human evidence.

### Complete only when

1. Database, TypeScript and Swift produce identical outputs for the canonical fixture corpus.
2. All owner mutation paths use typed atomic commands on supported builds.
3. Manual-cutter publications retain source-time starts/ends and publish one canonical revision.
4. Admin research labels provably cannot affect owner score revision or downstream owner readers.
5. Every listed surface reads a consistent canonical revision or is explicitly confirmed score-independent.
6. Web desktop/mobile, native iOS, worker, RLS, coach, share, stats, placement and export acceptance suites pass.
7. `CLAUDE.md`, `AGENTS.md`, migration comments, fixtures and release manifest are current.
8. The rollout flag and prior worker/web definitions provide a tested rollback path.

## 15. Evidence map

| Topic | Current implementation evidence |
| --- | --- |
| Score/game walk | `src/app/match/[id]/gameScore.ts`; `ios/PongLens/PongLens/Core/GameScore.swift` |
| Serve rotation | `src/app/match/[id]/serving.ts`; `ios/PongLens/PongLens/Core/Serving.swift` |
| Owner web writes | `src/app/match/[id]/MatchView.tsx`; `Player.tsx`; `PointScorecard.tsx`; `ServerChipMenu.tsx` |
| Native writes | `MatchDetailScreen.swift`; `PlayerTakeover.swift`; `PointActions.swift`; `PointExtras.swift` |
| Split/Join/Adjust/Insert | migrations `023`, `026`, `027`, `20260906174457`, `20260906174620`; `modifyOps.ts` |
| Server override | migration `100_server_override_anchor.sql` |
| Game boundaries | migrations `021_game_end_override.sql`, `099_game_winner_override.sql` |
| Legacy timing/boundaries | migrations `067`, `089`, `117_point_boundaries.sql`, `138_tap_end_playback.sql` |
| Manual cutter | `handCut.ts`; migration `20260908143746_hand_cut.sql`; `20260909180000_hand_cut_draft_mode.sql`; worker `process_hand_cut` |
| Admin Upload Detail | migration `144_admin_upload_detail.sql`; `UploadView.tsx`; `PointCard.tsx` |
| Research labels | migrations `121`–`124`; `src/app/research/fullmatch/FullMatch.tsx` |
| Shares/coach | migrations `129`, `130`, `139`, `153`; `src/app/s/[token]`; web/iOS coach workspace models |
| Stats/placement | `matchStats.ts`, `src/app/stats`, `placementAggregate.ts`; native `StatsScreen.swift`, `Placement.swift` |
| Playback/media boundary | `2026-09-11-scorekeeper-playback-integrity-design.md`; `playhead.ts`; native `Playhead.swift` |

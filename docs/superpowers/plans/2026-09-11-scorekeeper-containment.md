# Scorekeeper correction and Undo containment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop winner corrections from overwriting point endings and make score Undo restore the complete coupled outcome on desktop web, mobile web and native iOS.

**Architecture:** A small pure scorer-state module defines outcome transitions and a playback-run eligibility tracker on each platform. Existing client owners apply coupled fields together, serialize their score writes per point, and restore only scorer-owned fields on failure; ordinary Undo carries both before/after state and the timing window it belongs to. This is the immediate containment allowed by the approved spec, not the later durable revision/idempotency or source-clock migration.

**Tech Stack:** TypeScript, React, Supabase client; Swift, SwiftUI, AVPlayer; Node test runner and Foundation Swift tests.

**Spec:** `docs/superpowers/specs/2026-09-11-scorekeeper-playback-integrity-design.md`, sections 3A, #1 and #3, first release group.

## Global Constraints

- **Current-baseline amendment, approved September 11:** local `main` was stale/divergent. The active branch is `codex/scorekeeper-current-app`, based on freshly fetched `origin/main` at `fd9e529c8a984155a763bf4dbb7ea7d5db284ce3`. Prior work remains on `codex/scorekeeper-playback-integrity` at `f3d16953`. Use current app code as the authority for unchanged behavior; never merge the old baseline or its broad build restorations into this branch. The source map and original baseline results below are historical, not proof of the current app.
- Preserve current serve switches on both web and iOS, current hand-cut/edit/refresh/highlight paths, and current Add geometry verbatim. The old audit's eight-second/no-edge description was from the wrong baseline; #5 stays outside this delivery rather than reverting current four-second/edge behavior.
- Re-run current-baseline actual screen checks before and after porting scorer behavior. Keep independent locked dependencies and build caches. No downgrade, bulk branch merge, shared-checkout reset, production write, merge, push, deployment or native upload.

- Missing-point access is investigated here as #5 but remains on hold, with no change to plus-button density authorized.
- Existing scoring controls, colours, gestures and layout are preserved. No JSX layout, SwiftUI view structure, styling or new copy in this containment. Existing scorekeeper components are the behavioral reference.
- Correct an already answered point, including after replay: change the winner; preserve the existing ending. Never substitute the current playhead position.
- Rejected observation: save the score normally; keep the prior valid ending or the existing conservative fallback. Do not block scoring or guess a replacement timestamp.
- Only a first answer for the target point, during active foreground, ready, uninterrupted playback that began at/before the rally start, may create a tap. No pause, seek into the rally, buffering/source error, auto-pause, review, stale target or virtual detour timestamp may create one.
- Clear or Skip deactivates `scored_at_cut_s`; Undo restores it together with winner and Skip, never separately.
- Do not change `effectiveEnd`, its buffers, detector flags, Add geometry, game boundaries, worker files, clip-source selection or historical rows in this containment.
- No production writes, merge, push, deploy, uploaded iOS build, or dependency upgrades. All files belong in the isolated worktree. Preserve other worktrees.
- Run the real `npm run build`; report desktop, 393×660 mobile web and native verification separately. Do not claim UI verification from pure tests.
- Read root `CLAUDE.md`, plus root checkout `src/AGENTS.override.md` and `ios/AGENTS.override.md` as applicable; those override files are not committed into the isolated baseline.

## Delivery boundary and later groups

| This plan | Remains in the approved program |
| --- | --- |
| #1 first-answer capture eligibility, correction preservation | Persistent source-clock observation schema, legacy-client server guard |
| #3 coupled score/Skip/Undo and failure handling within this client | Durable operation IDs, cross-device revision receipts and structural Undo transactions |
| Unchanged consumer ending rules tested against restored rows | #4 atomic game boundaries; #2/#6/#7 source proof, manual authority, clip revisions/citations; #8/#9/#10 playback crossing and reader parity |

### Task 1: Web scorer containment

**Files:**
- Create: `src/app/match/[id]/scorerState.ts`, `src/app/match/[id]/scorerState.test.ts`.
- Modify: `src/app/match/[id]/Player.tsx`, `src/app/match/[id]/MatchView.tsx`, `package.json`.
- Test integration: `src/app/match/[id]/scorerIntegration.test.ts` (execute production helper/callback behavior, not source-text assertions).

**Interfaces:**
- Consumes existing `Point`, `effectiveEnd`, `cut_t0`, `t0`, `t1`, `edited`, `tight_start`, `tight_end` and the active-video/seek/pause events.
- Produces exported `ScorerState = { confirmed_winner: 'user' | 'opponent' | null; is_let: boolean; scored_at_cut_s: number | null }`, `scorerState(point)`, `winnerState(before, next, observation?)`, `skipState(before, next)` and `sameScorerState(a,b)`.
- Produces `ScorePlaybackRun` with `invalidate(): void`, `observe({pointId,start,end,time,playing,ready,foreground,sourceKey}): void`, `observation({pointId,start,end,time,playing,ready,foreground,sourceKey}): number | undefined`. Re-arm only on a newly observed point at/before its start or after explicit replay landing at start, never a mid-rally resume. Use actual cut clock only here; detours are ineligible pending source mapping.
- Scorer-save callbacks return completion receipts (before, after and timing guard) or null for no-op/failure; the Player adds Undo only for successful mutations. Preserve request order in Undo despite network order. Undo while a tap is pending must await that receipt rather than lose it. Extend callbacks locally as needed, updating all call sites in these two files.

- [ ] **Step 1: Write failing transition and playback-run tests.** Include the following behavior and equivalent event-sequence tests for pause/resume, seek, replay, buffering, visibility, stale point/source, short serves and already scored correction:

```ts
const before = { confirmed_winner: 'user' as const, is_let: false, scored_at_cut_s: 60 };
assert.deepEqual(winnerState(before, 'opponent', 51), {...before, confirmed_winner: 'opponent'});
assert.deepEqual(winnerState(before, null), {confirmed_winner: null, is_let: false, scored_at_cut_s: null});
assert.deepEqual(skipState(before, true), {confirmed_winner: null, is_let: true, scored_at_cut_s: null});
const run = new ScorePlaybackRun();
const event = {pointId:'p', start:50, end:65, time:50, playing:true, ready:true, foreground:true, sourceKey:'cut'};
run.observe(event);
assert.equal(run.observation({...event,time:60}), 60);
run.invalidate();
run.observe({...event,time:59});
assert.equal(run.observation({...event,time:60}), undefined);
```

- [ ] **Step 2: Run focused tests and record RED.** `node --test --experimental-strip-types 'src/app/match/[[]id[]]/scorerState.test.ts'`. Failure must be missing behavior, not a broken fixture/import.
- [ ] **Step 3: Implement pure transitions and tracker.** The winner transition preserves a previous tap on corrections, creates only finite eligible first-answer observations, and clears on null. Skip clears winner and tap in one state. `invalidate` retires evidence until a fresh start, with source/point/window matching at capture. No duration minimum.

```ts
const correcting = before.confirmed_winner !== null || before.is_let;
return { confirmed_winner: next, is_let: next === null ? before.is_let : false,
  scored_at_cut_s: next === null ? null : correcting ? before.scored_at_cut_s
    : Number.isFinite(observation) ? observation! : before.scored_at_cut_s };
```

- [ ] **Step 4: Connect production callbacks with behavioral integration tests.** Centralize winner, Skip and scorer Undo writes in MatchView. Serialize commands per point; resolve against latest local state when executing, optimistic-update the coupled fields, then restore only those fields on failure if that operation still owns them. Never roll back a later timing change or another field. In Player record successful command receipts, preserve action order, and restore the complete snapshot through one callback, not winner then Skip. Reject stale Undo if current outcome or timing window differs from the receipt, using existing failure reporting; failed Undo retains its entry. Review, card, split-result winner assignment and Why preserve previous end observations. Structural Undo stays outside this patch. Add deferred-promise tests for failed clear, failed Skip, immediate Undo, rapid correction, failed first request followed by correction, and independent point requests finishing out of order. An existing timestamp of 60 must remain 60 through correction at 51 and Undo; `effectiveEnd` before/after must agree.

- [ ] **Step 5: Wire the tracker to actual playback.** Observe ready, foreground cut time updates; invalidate synchronously before seeks/pauses and on media/visibility failures. A direct media `seeking` event also invalidates. Score capture rechecks `paused`, `seeking`, `readyState`, document visibility, actual point identity and detour absence rather than cached React state. App auto-pause never creates evidence. Start/replay navigation may re-arm at the actual start once seek completes; a mid-point seek may not. Use `cut_t0` (padded beginning) as the conservative start in this legacy containment.
- [ ] **Step 6: Run focused integration tests, `npm run test:match-structure`, `npm run test:scorecard`, and real `npm run build`.** Add `test:scorer` script for both new files. Report baseline/environment failures separately. Do not change unrelated build code.
- [ ] **Step 7: Self-review and commit only task files.** `git add` exact new/changed task files, then `git commit -m 'fix: preserve score endings and complete web scorer undo'`.

### Task 2: Native scorer containment and parity

**Files:**
- Create: `ios/PongLens/PongLens/Core/ScorerState.swift`, `ios/Tests/ScorerStateTests.swift`.
- Modify: `ios/PongLens/PongLens/Screens/MatchDetailScreen.swift`, `ios/PongLens/PongLens/Screens/PlayerTakeover.swift`, `ios/Tests/run.sh`, `ios/Tests/main.swift`.

**Interfaces:**
- Consumes existing `MatchPoint`, `Winner`, `effectiveEnd`, AVPlayer time/seek/play lifecycle; no dependency on the web implementation.
- Produces Foundation `ScorerState` for winner/isLet/scoredAt, pure winner/Skip transitions, and `ScorePlaybackRun` with native equivalents of invalidate, observe and observation. Use Swift naming conventions and the same field semantics and event sequences as Task 1.
- Native callbacks return success/receipt for scorer operations; preserve existing other callers via discardable results. Undo restores only fields owned by its operation, guarded by the expected outcome and timing window. Do not restore stale starred/deleted state during score Undo.

- [ ] **Step 1: Add RED tests using the native test runner's existing assertion helpers.** Include correction with prior tap 60 and new playhead 51; clearing and Skip then complete Undo; no-op Why; invalid/NaN tap; paused, scrubbed, automatic-end pause, resumed mid-rally, source/point mismatch; ordinary continuous first answer and a sub-second rally. Read the actual helper signature before adding test calls.

```swift
let before = ScorerState(winner: .user, isLet: false, scoredAt: 60)
let after = before.settingWinner(.opponent, observation: 51)
expect(after.scoredAt == 60, "correcting winner preserves ending")
expect(before.settingWinner(nil).scoredAt == nil, "clear deactivates ending")
expect(before.settingSkipped(true).scoredAt == nil, "skip deactivates ending")
```

- [ ] **Step 2: Run `CLANG_MODULE_CACHE_PATH=/private/tmp/ponglens-scorekeeper-swift-cache bash ios/Tests/run.sh` and record RED.** Three pre-existing InsertGeometry failures correspond to held #5; do not change their tests or threshold.
- [ ] **Step 3: Implement native state transitions and tracker.** Same semantics as the web contract: prior answered points never acquire a new observation; capture only a continuously watched first answer on proven actual cut footage. Use active player's actual time and readiness/playing status, foreground scene status, and explicit seek invalidation. Treat own-clip detours as ineligible until later source mapping. Do not use only `phase == .play` or cached `currentT`.
- [ ] **Step 4: Integrate with the model and Undo.** Serialize scorer commands per point, base each on current model state, write coupled fields atomically, return receipt/success, and scope failure restoration so it cannot overwrite later edits. Change only scorer-specific save paths, not the generic patch behavior for unrelated controls. Record Undo only for successful work and preserve invocation order; immediate Undo awaits pending work. Before restoration require matching outcome/timing. Existing star/delete Undo remains valid and independent.

```swift
// A scorer rollback is a field-scoped merge, never points[i] = before.
points[index].confirmedWinner = before.winner
points[index].isLet = before.isLet
points[index].scoredAtCutS = before.scoredAt
```

- [ ] **Step 5: Add deferred-command behavioral tests for serialization/failure/Undo, then run focused native tests and the full Foundation runner.** Preserve the known three held tests and report them explicitly. Compile the actual iOS target in a separate derived-data directory; do not claim SwiftUI/AVPlayer integration verified solely from Foundation tests.
- [ ] **Step 6: Self-review and commit exact task files.** `git commit -m 'fix: preserve score endings and complete native scorer undo'`.

## Controller verification and handoff

| Check | Evidence required |
| --- | --- |
| Independent task review | Every task receives spec and quality verdicts, then fix review if needed |
| Final integration review | Whole branch review of callback lifetimes, queue semantics and event wiring |
| Web | Real production build, scorer and match/scorecard tests; desktop and 393×660 interaction checks when local authenticated fixtures are available |
| Native | Foundation tests plus actual target compile; simulator interaction check separately, never inferred from web |
| Downstream | Corrections preserve effective endings; clearing/Undo restores them; outcome-only changes still recompute score and serving; no worker policy or coach authorization changes |
| Release | Leave local branch intact, no merge/push/deploy; name unverified runtime states and remaining approved groups |

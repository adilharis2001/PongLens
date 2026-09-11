# Scorekeeper fixes: review brief

The approved direction separates who won, where the point ended, and which video contains it, across player and coach experiences. Implementation has started with correction and Undo containment for desktop web, mobile web and native iOS. The remaining fixes retain their own downstream acceptance gates; #5 stays on hold.

## The ten recommendations

| Priority | Proposed fix | What the user gains |
| --- | --- | --- |
| 1 · High | Correcting a winner preserves the existing ending; only eligible first-time live scoring can record new end evidence. | A corrected answer no longer makes part of the rally disappear on future playback. |
| 2 · High | Verify that the chosen video actually contains the point; use its own clip or the authorized original window when the match cut does not. | The card, the footage, the coach's point jump and the exported rally agree. |
| 3 · High | Undo and failed-save recovery restore score and ending together, with protection against newer edits. | Recovery actually returns to the previous state. |
| 4 · High | Move a game boundary in one complete save; explicitly resolve a manually named winner. | No half-moved divider or silently lost game result. |
| **5 · On hold** | Keep today's plus-button density unchanged. Later compare an Add entry in existing tools, a temporary insertion mode, and more inline offers. | A considered route to adding missed short serves without default buttons between every rally. |
| 6 · Medium | Keep manual endings authoritative after Split/Join and after the new clip finishes. | An edit does not appear to work and then revert during later playback. Adjust's existing correct clearing is preserved. |
| 7 · Medium | Refresh cached video when the actual clip revision changes, swapping at a safe moment. | The next replay shows the new clip without a page refresh or a mid-rally restart. |
| 8 · Medium | Track natural playback separately from deliberate seeking when deciding to pause. | Delayed updates do not miss the score prompt; deliberate navigation does not trigger unwanted pauses. |
| 9 · Lower | Allow temporary inspection when someone deliberately seeks into a trimmed ending. | Players and coaches can inspect it without fighting the automatic skip. This does not change saved timings. |
| 10 · Conditional | Fetch and carry all required ending metadata through native, coach and share readers. | Consistent behavior where trimming is enabled, without turning the feature on as a side effect. |

## What changes across the product

| Activity | Intended effect | What stays unchanged |
| --- | --- | --- |
| Watch and point videos | Correct footage, reliable revised clips, stable endings after score correction and controllable inspection. | Original recordings and detector-created cards are not rebuilt by a viewing fix. |
| Future scorekeeper sessions | Saved corrections and Undo remain consistent after reopening; pauses target the right point. | No new mandatory end-tapping step. |
| Coach orders and findings | Current scores and point jumps agree with the match; evidence behind a finding needs protection from later structural edits. | Order price, deadlines, status and the coach's written/audio feedback. |
| Highlights and exports | Use verified sources and trustworthy endings; regenerate only when relevant footage, selection or score-overlay inputs change. | Automatic quality criteria and intentional differences in tail length. Existing downloaded files cannot be rewritten. |
| Point-by-point breakdown | Real score/boundary changes update running scores, games, serve rotation and related statistics together. | Playback-only fixes do not change winners, point counts, notes or measured ball coordinates. |

## Decisions the spec makes explicit

| Decision | Recommendation |
| --- | --- |
| First work to implement | #1 and #3 together, then the independent game-boundary fix. Continue with shared media-source and manual-ending work. |
| A score entered after the app paused | Save the score, but do not treat the app's own estimated pause as new human end evidence. Some points may retain more context or lack enough evidence for an automatic highlight. |
| A coach's cited point is later joined or retimed | Adil approved preserving the cited clip revision instead of silently changing the evidence. Citation storage, access and retention work follows the immediate scorekeeper containment. |
| Existing possibly incorrect timestamps | Prevent new errors first; review a read-only candidate list before any historical repair. No blanket deletion or speculative backfill. |
| Missing-point controls | Keep #5 on hold. Evaluate an explicit Add entry in existing point tools first when the discussion resumes. |

## Evidence and detailed specifications

| Item | Record |
| --- | --- |
| Full design | [Individual specifications, downstream contracts, acceptance tests, rollout gates and source links](/Users/adil/Desktop/Projects/PongLens/docs/superpowers/specs/2026-09-11-scorekeeper-playback-integrity-design.md) |
| Verified for this draft | Repeated targeted reproductions; 131 match-structure tests, 15 scorecard tests and 27 highlight/review tests passed. Read the code paths through coaching, public sharing and renderers. |
| Not verified | Live desktop/mobile/native interaction sequences, production configuration or actual rendered-video comparisons. Those are explicit implementation acceptance gates. |
| Status | Adil approved implementation in an isolated worktree, including the three product decisions. No production repair, merge, deployment or uploaded build has occurred. |

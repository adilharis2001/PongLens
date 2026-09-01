# Audio Impact Point-First Labeling Design

**Date:** 2026-09-01
**Status:** Approved

## Problem

The production audio-impact labeler emphasizes an individual detected sound without establishing that the reviewer is working through several detected sounds inside one game point. The point selector is visually secondary, the sound progress is detached from point progress, and completion does not clearly describe the transition to the next point. A reviewer can therefore believe several sounds belong to one point while navigating among different points.

The current `shoe` class also combines ordinary footsteps, shoe squeaks, and serving stomps even though these are acoustically and semantically distinct.

## Approved interaction model

The research task is point-first. A reviewer enters one game point, watches its full context, labels every marked sound in that point, reviews the completed set, and explicitly advances to the next point.

### Point introduction

Opening a new point presents a clear context stage before event labeling:

- `Point N of 30` is the dominant progress label.
- Match name, venue, research round, and original source-point index are visible together.
- The page states how many marked sounds the point contains.
- The primary action is `Watch full point, then start labeling`.
- Event classification is unavailable until the full point has been played at normal speed.

The context stage is shown once per point per browser session. A reviewer can return to the full-point view at any time.

### Sound labeling

The persistent hierarchy is `Point N of 30 → Sound M of K in this point`.

- A numbered step rail shows completed, current, and unanswered sounds.
- The current prompt says `Label sound M` and explains that the short loop centers the sound at the pink marker.
- Selecting a class saves the answer and advances only within the current point.
- It must never cross into another point as a side effect of labeling a sound.
- The point queue remains available for deliberate navigation, subject to existing failed-save guards.
- Keyboard shortcuts remain available but are visually secondary to class names and descriptions.

### Point review and completion

After the last marked sound is labeled, the page shows a point summary with the selected class for every sound.

- `Finish Point N and open Point N+1` is enabled only when every marked sound has a class.
- The reviewer can reopen any sound before finishing.
- Completion sets `sequence_complete`, submits the assignment, and then explicitly opens the next point.
- `Add missed sound at playhead` remains available and adds the new sound to the same point.

## Label taxonomy

The study classes are:

- `paddle`: Ball contacting either visible match player's paddle.
- `table`: Ball contacting the visible match table.
- `floor`: The visible match ball bouncing on the floor.
- `shoe`: An ordinary footstep or non-squeaking shoe movement.
- `shoe_squeak`: A distinct friction or squeaking sound from a shoe.
- `stomp`: A strong, heavy foot strike, commonly associated with a serve.
- `net`: Ball contacting the visible net or net assembly.
- `background`: Paddle or table contact from another game.
- `other`: Voice, catch, body contact, clap, or another unrelated transient.
- `no_impact`: No distinct impact is audible at the marker.
- `unsure`: A real sound is present but its class is unclear.

Suggested shortcuts retain the familiar existing keys and avoid collisions:

- `P` paddle, `T` table, `F` floor
- `H` shoe/footstep, `Q` shoe squeak, `S` stomp
- `N` net, `B` background, `O` other, `X` no impact, `U` unsure

The new taxonomy must be accepted consistently by the UI types, validation helpers, database trigger, export normalization, trainer class list, metrics, documentation, and tests. No model has been frozen, so adding the two distinct classes does not invalidate a released model artifact.

## Data integrity and navigation

- Autosave remains durable before any event or point navigation.
- Failed saves continue to block navigation and preserve the retryable answer on screen.
- Media must remain verified playable before review controls are enabled.
- Frozen and sealed rounds retain their existing read-only lifecycle constraints.
- Event navigation functions gain a point boundary; cross-point movement is performed only by the explicit point-completion or queue actions.
- A completed point cannot be submitted with unanswered events.

## Production reset

After the corrected application and database taxonomy are deployed, reset only the review work created during the confusing session in batch `audio-impact-labeling-recent-v1`:

- 14 labeled events across seven Round A assignments
- assignment status, `human_label`, review metrics, and start/submission timestamps for those seven assignments

The reset preserves the batch, reviewer, source rows, protected media, frozen detector proposals, event markers, assignment IDs, sequence order, lifecycle state, and all untouched assignments. The reset is an exact targeted update, not a deletion of the study corpus.

The reset is intentionally performed after deployment so the next review session begins with the point-first flow and expanded taxonomy. Counts are verified before and after the transaction.

## Verification

Automated tests cover:

- label taxonomy and keyboard mappings
- within-point event advancement and point-boundary behavior
- point-introduction gating
- complete/unanswered point states and explicit next-point transition
- progress hierarchy and summary rendering contracts
- database acceptance of `shoe`, `shoe_squeak`, and `stomp`
- trainer/export recognition of all trainable classes
- existing save failure, media failure, lifecycle, and sealed-round safeguards

The production release is verified with a clean application build, the full relevant TypeScript/route test matrix, audio-impact worker tests, migration verification, and a browser smoke test of the authenticated desktop flow.

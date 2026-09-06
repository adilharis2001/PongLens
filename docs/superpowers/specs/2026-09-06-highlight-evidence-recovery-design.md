# Highlight evidence recovery design

## Outcome

Automatic reels should contain only rallies with measurable back-and-forth play, without trying to fill a duration target. Existing scored matches for Adil and Anton must regain eligibility without replacing point rows or disturbing manual scoring.

## Qualification contract

A point qualifies only when it is playable, unchanged, has at least two detected table contacts, and has a rally end observed by the card assembler or derived from the final event in a connected rally chain.

It must also satisfy at least one independent five-exchange path:

1. five dwell-confirmed connected net crossings;
2. five alternating table-side landings; or
3. five credible hit detections corroborated by at least two connected crossings or three alternating table-side landings.

Missing optional signals do not make the whole receipt unavailable. A receipt is unavailable only when the pipeline cannot establish an evidence-backed rally end or has no geometric evidence. The evidence and manifest contracts advance to version 2 so version 1 reels cannot be mistaken for current output.

## Selection and rendering

Rank eligible rallies by the strongest measured exchange count, then measured rally span. Select under a 150-second ceiling and restore match order before rendering. Never add a weaker rally merely to fill the ceiling. Existing timestamp normalization, single encode, fixed frame rate, audio resampling, and crossfades remain the playback contract.

## Historical recovery

Historical work updates only `points.highlight_evidence` among player-authored and match data. It invalidates the derived automatic-reel row so the next request can render the recovered receipt set. It must preserve point identity, order, source/cut bounds, winner, score, server, edits, deletions, lets, tags, notes, and match rows. Evidence is reconstructed in this order:

1. retained diagnostics;
2. retained raw video;
3. retained cut video with cut-to-source clock mapping.

The runner is dry-run by default, requires explicit canaries before a write rollout, snapshots all non-highlight point fields, and aborts if any protected field changes. Adil and Anton can be represented by a backward-compatible multi-user feature-gate value.

## Acceptance checks

- Four-exchange rallies never qualify.
- Each of the three five-exchange paths qualifies only with the shared bounce/end requirements.
- End-on footage can derive a bounded rally end from a connected event chain.
- The 150-second value remains a ceiling, not a target.
- Evidence-only backfill tests prove all non-highlight point fields are byte-for-byte unchanged.
- Worker tests, web highlight tests, iOS highlight model tests, and the full web production build pass.

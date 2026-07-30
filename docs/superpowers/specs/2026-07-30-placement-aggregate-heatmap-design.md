# Production Placement Heat Map

**Date:** 2026-07-30

## Goal

Ship the tested match-level nine-zone placement heat map inside the existing
`Where the ball landed` production section. The current exact landing map
remains the first view. A player can move to the heat map with a horizontal
swipe on mobile or the equivalent pager controls and trackpad gesture on
desktop.

This is an explicitly conservative production preview. It shows only placement
evidence that passes a 70% trust gate and does not generate coaching advice.

## Selected Experience

The existing placement card becomes a two-page viewer:

1. **Landings** — the existing exact trusted landing dots.
2. **Heat map** — the same observations grouped into a nine-zone table.

The two pages occupy the same card footprint. Shared controls remain stable
while changing pages:

- game filter: `All match`, `Game 1`, `Game 2`, and so on;
- landing filter: `My serves`, `Their serves`, `My rally shots`,
  `Their rally shots`;
- coverage: trusted landing count and contributing point count.

On mobile, the table page follows the finger in a horizontal scroll-snap
carousel. Two visible page indicators communicate that another page exists.
Tapping an indicator also changes the page.

On desktop, one page remains visible at a time to preserve the current match
analysis hierarchy and card size. `Landings` and `Heat map` pager controls are
always visible, and horizontal trackpad gestures update the same pager. The
interaction is not hidden behind gesture-only discovery.

The visual language reuses the existing table, surface, border, typography,
cyan, and amber primitives. It does not introduce a new dashboard style or a
large warning panel.

## Event Semantics

The four filters are mutually unambiguous:

- **My serves:** the serve's second bounce on the opponent's half.
- **Their serves:** the serve's second bounce on the user's half.
- **My rally shots:** non-serve landings struck by the user.
- **Their rally shots:** non-serve landings struck by the opponent.

The serve's first bounce, paddle-contact positions, terminal net markers, and
out-of-table markers never enter the aggregate heat map.

The exact landing view and heat map are built from one observation collection.
Changing pages therefore cannot change the count, filter semantics, confidence
gate, or orientation.

## Trust Gate and Sparse Data

An observation is included only when all of these are true:

- placement schema is v3;
- the hypothesis selected from the live scored server is `ready`;
- hypothesis confidence is at least `0.70`;
- the hypothesis has no hard suppression reasons;
- the shot has a valid table landing;
- shot confidence is at least `0.70`;
- landing confidence is at least `0.70`;
- shot ownership agrees with serve order: odd shots belong to the server and
  even shots to the receiver.

Points that fail the gate do not contribute a dot or heat cell.

The UI reports both accepted evidence and coverage. Fewer than three trusted
observations in the selected filter shows `Not enough trusted landings in this
view yet.` Three or more observations render the heat map. No coaching
recommendation is inferred from sparse samples.

## Orientation Invariant

Every aggregate table is rendered from the uploader's normalized viewpoint:

- the user is always at the bottom;
- the opponent is always at the top;
- the user's left is always map-left;
- the user's right is always map-right.

Before normalization, the physical user side is derived per point from
`user_side` and the scored game index. Odd-numbered games reverse the physical
ends. The live serving walk, including `first_server`, per-point server
overrides, game-boundary overrides, skipped points, and deuce rotation, selects
the server hypothesis.

One pure TypeScript transformation owns coordinate normalization and zone
classification. Both the exact dots and heat cells consume it. No component
may independently mirror CSS, SVG coordinates, or zone labels.

The first release uses `left`, `middle`, and `right` from the user's normalized
view. It does not label the opponent's forehand or backhand. The user's
handedness may supplement incoming-ball labels later without changing the
underlying zones.

## Heat Map Rendering

The receiving half is divided into:

- `short`, `medium`, `deep` from the net toward the receiver;
- `left`, `middle`, `right` from the user's normalized viewpoint.

Each of the nine cells shows relative intensity using the existing cyan
palette for the user's shots and amber for the opponent's shots. Intensity is
normalized within the selected filter. A cell may show its count, but the
exact landing page remains the source for precise positions.

The table labels the user and opponent explicitly. Filter-specific helper copy
states what is being counted, including `Second bounce` for both serve views.

## Architecture and Data Flow

The worker remains responsible for reconstructing physical table coordinates,
shot sequence, phase, hitter side, and event confidence. It is hardened with
tests that guarantee its v3 output is heat-map ready:

- shot sequence and hitter side obey server/receiver parity;
- a serve exposes the receiver-half second bounce separately from its first
  bounce;
- coordinates retain canonical camera-frame winding;
- confidence fields needed by the trust gate are finite and bounded.

The worker does not persist a rendered heat-map image or a stale match-level
aggregate. The application derives the aggregate from point placement plus
the user's live scoring, server corrections, side choice, and game-boundary
corrections. This means a correction immediately updates both aggregate pages
without rerunning vision.

Production UI work is isolated into:

1. a pure trusted-observation and zone-classification module;
2. a nine-zone SVG heat-map renderer;
3. a responsive two-page placement viewer;
4. the existing match view integration.

No database migration is required.

## Production Rollout

After deployment, rerun placement generation for two existing user-owned
matches with retained source media:

- one relatively straight/full-table camera;
- one meaningfully oblique or different-venue camera.

Use the normal placement-generation/backfill boundary so per-point placement
and lifecycle fields remain authoritative. Do not create duplicate matches,
research-only rows, or separate heat-map artifacts.

Verify both matches in production on a narrow mobile viewport and desktop:

- swipe/pager behavior;
- all four filters;
- exact-dot and heat-map count parity;
- serve second-bounce semantics;
- user bottom/top identity;
- game-end orientation changes;
- left/right against point video;
- honest sparse and unavailable states.

## Alternatives Rejected

### Color the current dots without changing selection

This is faster but preserves low-confidence points and duplicates orientation
logic. Dot counts and heat counts could disagree, so it is rejected.

### Persist a worker-generated heat-map image or summary

This becomes stale when the player corrects the server, score, game boundary,
or physical side. It also prevents interactive filters. The worker supplies
evidence; the app renders the live aggregate.

### Ship coaching insights in the same release

The current evidence is sufficient for exploratory patterns, not prescriptive
coaching. Advice and won/lost tactical cards remain a later, separately
validated feature.

## Acceptance Criteria

1. The existing placement map is page one, not replaced.
2. Mobile users can swipe naturally between exact landings and the heat map.
3. Desktop users have visible pager controls and trackpad-compatible paging.
4. All four landing filters use the exact semantics in this document.
5. Both pages share one strictly gated observation set at `0.70`.
6. Serve aggregates use only the second bounce.
7. User-left and user-right remain stable across camera sides and game-end
   swaps.
8. Sparse filters show an honest empty state.
9. Worker, TypeScript, UI-contract, and orientation regression tests pass.
10. Two existing production matches are regenerated and verified without
    duplicate or auxiliary production data.

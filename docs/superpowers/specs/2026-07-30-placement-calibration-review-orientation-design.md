# Placement Calibration Review Orientation

## Goal

Make every Current-versus-OpenAI landing comparison understandable without
requiring the reviewer to infer who served or which end of the drawn table
belongs to each player.

## Design

Each calibration-sensitive shot card will show three independent facts:

1. **Scored server** — the server resolved by PongLens's existing first-server,
   per-point override, game-boundary, and ITTF rotation rules.
2. **Physical orientation** — the player on the near/bottom and far/top ends for
   that point. The initial `user_side` is flipped after each scored game
   boundary.
3. **Validation target** — the exact real-world event represented by the dot:
   the serve's second bounce, or the first table bounce after a return/shot.

Both the Current and OpenAI mini-maps use identical labels:

- player name above the table with `far / top`;
- player name below the table with `near / bottom`;
- landing zone described as receiver-relative.

Only the physical-server hypothesis matching the scored server is eligible for
the review. Alternate-server hypotheses are counted as excluded diagnostics but
are not rendered as cards, maps, or videos. A reviewer must never be asked to
validate a hypothetical serve that contradicts the scored server.

The validation instruction uses table-tennis language:

- serve: `Validate Chris's/your serve · second bounce on the receiver's side`;
- shot sequence 2: `Validate your/Chris's return · first table bounce after
  contact on the receiver's side`;
- later shot: `Validate your/Chris's shot · first table bounce after contact on
  the receiver's side`.

## Data and provenance

The renderer will derive the point context only from the frozen experiment
manifest:

- `truth.first_server`
- `truth.user_side`
- ordered point `server_override`, `is_let`, `confirmed_winner`, and
  `game_end_override`

It will reproduce the app's serve-rotation and game-boundary semantics. It will
not infer a player from shirt color or modify the underlying reconstruction.

If the server or initial side is unavailable, the report will say it is
unresolved rather than guessing.

## Testing

Automated tests will cover:

- first-server rotation and matching physical hypothesis;
- player-side swap and first-server alternation after a game boundary;
- visible server, orientation, provenance, and validation-target labels;
- complete exclusion of alternate-server hypotheses from review cards;
- sanitization of private identifiers.

The regenerated report will then be checked in the browser at desktop and
mobile widths, including media and console-error checks.

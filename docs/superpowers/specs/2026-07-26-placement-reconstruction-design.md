# Placement Reconstruction and Honest Rendering

Date: 2026-07-26

## Summary

PongLens currently builds placement maps from a flat list of local image-y
maxima that are projected onto the table and then labeled as serve, rally, or
final bounces. Five narrated points from the Vaibhab match show that this
model fails in several independent ways:

- airborne balls are projected onto the table and become false bounces;
- a missing event shifts every later player and phase label;
- the worker guesses the server independently from the app's confirmed serve
  rotation;
- racket contacts behind an end line are rejected;
- a wide visual reversal window merges nearby bounce/contact events;
- terminal shots that never land on the table have no representation;
- the renderer makes the first surviving event look like a serve and can draw
  arrows from filtered-out origins.

This change replaces the flat-bounce interpretation with a small,
confidence-scored point reconstruction. It also makes the renderer refuse to
present an incoherent sequence as a confident trajectory. The first
implementation is intentionally usable without audio, while accepting
optional impact timestamps from the separate audio project.

## Goals

1. Materially improve the five narrated Vaibhab points and use them as a
   regression benchmark.
2. Separate observed event candidates from inferred shot roles.
3. Make confirmed server rotation and per-point overrides affect the actual
   placement reconstruction, not only arrow colors.
4. Represent terminal net, out, and no-return outcomes without inventing a
   table landing.
5. Detect incoherent or incomplete maps and render them honestly.
6. Accept optional audio impact candidates without depending on audio surface
   classification.
7. Produce local current-versus-improved renderings before any production
   backfill.

## Non-goals

- Replacing BlurBall or training a new ball detector.
- Solving table calibration for every camera in this tactical pass.
  Calibration confidence and manual corner adjustment remain a follow-up
  project; the Vaibhab calibration used by these fixtures is already good.
- Building the full uploader impact-editing interface in this pass.
- Treating audio as authoritative or requiring audio to classify paddle,
  table, net, or floor.
- Updating production placement rows before local evaluation is reviewed.

## Ground-truth benchmark

The first benchmark is the existing Vaibhab match, points 1–5, using the
original video, BlurBall detections, calibration, and the uploader's narrated
ground truth.

### Point 1

Vaibhab serves, the uploader returns to the far middle, and Vaibhab attacks
long. The existing worker recognizes only the serve and return because the
far-end contact is just below the visual leg threshold and projects beyond
the end line.

Expected map: Vaibhab serve, uploader return landing, Vaibhab terminal out.

### Point 2

The uploader serves, Vaibhab returns a high ball, and the uploader attacks
into the net. BlurBall loses the cross-table serve bounce, reacquires a false
object, and later turns net motion into fake bounces.

Expected map: uploader serve, Vaibhab return landing, uploader terminal net.

### Point 3

The uploader serves, Vaibhab returns, the uploader attacks, Vaibhab blocks,
and the uploader attacks for the winner. An airborne local-y maximum becomes
a false bounce and shifts the remaining rally; the winner bounce occurs
during a visual gap.

Expected map: a legal five-shot sequence with the final uploader winner.

### Point 4

Vaibhab serves, the uploader pushes, Vaibhab loops wide, and the uploader
touches the ball out. A false pre-serve track causes the worker to infer the
wrong server even though the app's rotation knows Vaibhab served.

Expected map: Vaibhab serve, uploader push landing, Vaibhab third-ball
landing, uploader terminal out.

### Point 5

Vaibhab serves, the uploader returns high, Vaibhab attacks down the line, and
the uploader does not return the ball. The serve's receiver-half bounce and
the nearby return contact are merged; the far-end attack is rejected.

Expected map: Vaibhab serve, uploader return landing, Vaibhab winner landing.

## Architecture

Placement processing is split into three bounded stages.

### 1. Candidate extraction

Candidate extraction reports observations without deciding the rally:

- visual table-bounce candidates;
- visual direction-change/contact candidates;
- continuous track segments and gaps;
- projected table coordinates only where a table-plane event is plausible;
- terminal motion near the net or beyond a table boundary;
- optional audio impact timestamps with confidence.

Every candidate carries its evidence and confidence. A contact location may
remain in image coordinates because projecting an airborne racket contact
through the table homography is invalid.

Candidate extraction must reject impossible track jumps before those jumps
can seed server inference, winner classification, or placement roles.

### 2. Legal point reconstruction

The reconstructor consumes candidates and evaluates legal point sequences:

1. serve contact;
2. bounce on the server's half;
3. bounce on the receiver's half;
4. alternating paddle contact and opponent-half table landing;
5. a terminal table landing, net, out, or no-return event.

It evaluates both physical server hypotheses (`near` and `far`) and returns a
confidence-scored reconstruction for each. The frontend selects the hypothesis
using the server computed from `matches.first_server`, game rotation,
`points.server_override`, and `points.is_let`.

When the server is not confirmed, the higher-scoring hypothesis may be shown
only when it wins by a clear confidence margin and has no hard contradiction.
Otherwise the map asks for server confirmation instead of guessing.

Changing the first server or a point override selects a different stored
hypothesis immediately. It does not rerun BlurBall.

The reconstructor must not assign ownership by the array index of surviving
bounces. Each shot owns its contact, landing or terminal outcome, player,
phase, and confidence.

### 3. Honest rendering

The renderer consumes reconstructed shots, not raw bounces.

- A server-origin arrow is drawn only for a valid serve shot with a
  receiver-half landing.
- A filtered visible arrow never starts at an invisible point. Required
  context is rendered faintly, or the view switches to landing-only marks.
- Net and out endings use a terminal dashed arrow and `X`; they do not reuse
  the previous player's landing as the final shot.
- A no-return winner ends at the winner landing and is labeled as no return.
- Low-confidence partial sequences are visibly marked "Needs review."
- Hard-invalid sequences are not rendered as trajectories.
- Phase filters show how many events they hide and default to all phases on
  each point.

## Placement v3 data contract

The worker emits a versioned placement object with server-independent
evidence and two server hypotheses:

```json
{
  "v": 3,
  "status": "ready",
  "candidates": [
    {
      "id": "e1",
      "t": 12.862,
      "kinds": ["table_bounce", "paddle_contact"],
      "u": 0.74,
      "v": 2.31,
      "visual_confidence": 0.61,
      "audio_confidence": null
    }
  ],
  "hypotheses": {
    "near": {
      "status": "ready",
      "confidence": 0.82,
      "reasons": [],
      "shots": []
    },
    "far": {
      "status": "unavailable",
      "confidence": 0.24,
      "reasons": ["serve_second_bounce_on_server_half"],
      "shots": []
    }
  }
}
```

Candidate `u` and `v` are nullable. They are present only for plausible
table-plane events. The serialized candidate also carries a singular `kind`
machine discriminator (`bounce`, `contact`, `impact`, `net`, or `out`) beside
the descriptive `kinds` array; consumers should use `kind` for dispatch and
may use `kinds` for diagnostics.

Each reconstructed shot contains:

```json
{
  "seq": 1,
  "hitter_side": "far",
  "phase": "serve",
  "contact_t": 12.3,
  "confidence": 0.88,
  "landing": {
    "t": 12.86,
    "u": 0.74,
    "v": 0.63,
    "confidence": 0.81
  },
  "terminal": null
}
```

`terminal` is mutually exclusive with `landing` for a shot that dies in the
net or misses the table. It records `kind`, time, approximate direction, and
confidence without pretending the airborne ball touched the table.

Existing v1 and v2 placement rows remain readable. No migration is required
for the tactical evaluation.

## Tactical reconstruction rules

The first pass uses explicit, testable rules before considering a learned
sequence model.

### Server evidence

- The confirmed app server is authoritative for hypothesis selection.
- Pre-serve detections outside the calibrated activity/table region cannot
  seed the server.
- A serve hypothesis is hard-invalid when its `serve_2` landing is on the
  known server's half.
- A `serve_1` followed by later rally evidence but no `serve_2` is incomplete,
  not a valid one-bounce serve.

### Contact timing

- A visual reversal window proposes an interval, not its center frame as the
  final contact time.
- The selected contact time is the strongest velocity discontinuity inside
  the interval.
- Contacts beyond an end line remain eligible when the outgoing track heads
  back across the table.
- Optional audio impacts narrow the interval but do not determine the event
  type by themselves.

### Bounce timing

- A bounce candidate is not automatically discarded merely because a broad
  contact interval overlaps it.
- Nearby bounce/contact candidates can both survive when their best times are
  distinct and form a legal sequence.
- An airborne local-y maximum with weak table-plane and sequence evidence is
  penalized.
- Track gaps produce uncertainty; they do not justify inventing a coordinate.

### Terminal events

- `final` belongs to the terminal shot, never automatically to the last
  surviving bounce.
- Continued high-speed motion or later supported impacts contradict an
  earlier proposed final.
- A tracked shot that crosses the table but has no landing becomes an out
  candidate.
- A track that dies in the net band after a contact becomes a net candidate.

## Audio integration boundary

Audio is optional input:

```json
{
  "impacts": [
    { "t": 35.114, "confidence": 5.906 }
  ]
}
```

The placement pipeline does not require audio event labels. It uses an impact
as timing support when visual evidence exists nearby or when the legal
sequence predicts a missing event. Visual tracking and table geometry remain
responsible for landing coordinates.

This boundary lets the audio project change detectors independently. The
tactical placement work can ship with `impacts: []`.

## Confidence and failure handling

Each hypothesis receives positive evidence and contradiction penalties.
Transition rewards are weighted by the candidate's visual/audio evidence,
rather than by event count alone. Hard-invalid hypotheses are capped below
ready confidence and are never rendered or included in aggregate maps, even
when the app-confirmed server selects that physical-side hypothesis.
Results use three states:

- `ready`: coherent sequence with no hard contradiction;
- `review`: useful partial sequence, but a server, landing, or terminal event
  is uncertain;
- `unavailable`: calibration or sequence evidence is too weak to render
  honestly.

Hard contradictions include:

- known-server mismatch;
- `serve_2` on the server's half;
- a terminal event before a legal serve;
- a proposed final contradicted by later supported play;
- an impossible track jump used as a bounce or contact;
- a displayed first shot that is not a reconstructed serve.

The UI must prefer a clear review/unavailable message over a confident but
incorrect map.

## Server correction behavior

The current app correctly computes serve rotation and allows first-server and
per-point overrides, but `PlacementMap` uses that value only for frontend
ownership alternation. Placement v3 changes this behavior:

1. the worker stores both physical server hypotheses;
2. the app selects the hypothesis matching `computeServing`;
3. changing `first_server` or `server_override` immediately selects and
   rerenders the matching hypothesis;
4. if a matching hypothesis is hard-invalid, the map shows `Needs review`
   rather than recoloring the invalid sequence.

Coordinates remain independent of player identity. Server confirmation affects
serve roles, shot ownership, and sequence interpretation.

## Evaluation and testing

### Regression fixture

Create a compact fixture containing the calibrated Vaibhab point tracks,
candidate events, optional current audio impact timestamps, and the expected
shot-level assertions above. Do not commit the original match video or raw
upload.

### Unit tests

- legal serve role assignment for both server sides;
- selection of the confirmed-server hypothesis;
- invalidation of a serve landing on the server's own half;
- separation of nearby bounce/contact candidates;
- contact acceptance beyond an end line when the outgoing path crosses the
  table;
- terminal net and out representation;
- no automatic `final` assignment to the last bounce;
- no server-origin arrow for a non-serve first event;
- phase filtering never creates a floating segment.

### Local visual evaluation

Generate current and placement-v3 maps for Vaibhab points 1–5 and compare them
side by side. The local review must happen before any database update or
production backfill.

### Acceptance criteria

- All five maps either show the correct shot ownership and ordering or
  explicitly show `Needs review`; none confidently shows an impossible serve.
- Points 1, 2, 4, and 5 represent their terminal out/net/winner behavior
  separately from the preceding landing.
- Point 3 no longer promotes the known airborne candidate to a confident
  table bounce.
- Changing the confirmed server changes the selected reconstruction, not only
  its colors.
- No visible arrow begins at a filtered-out or fabricated origin.
- Existing v1/v2 maps continue to render.
- The test suite and type checks pass.

## Rollout

1. Implement and validate locally against the five-point fixture.
2. Review side-by-side renderings.
3. Run the full PongLens test and type-check suite.
4. Enable placement v3 for new local worker runs.
5. Backfill only the Vaibhab match in a non-production artifact first.
6. Decide separately whether to backfill production matches.

No production data is mutated as part of the initial implementation or visual
evaluation.

## Follow-up work

- Match-level calibration confidence and a four-corner correction wizard.
- A low-confidence point editor that pauses at proposed impacts and asks the
  uploader to confirm paddle, table, net, floor, or unrelated sound.
- Training-data capture from accepted manual corrections.
- Learned event classification after the rule-based benchmark and audio
  labels are large enough to evaluate.

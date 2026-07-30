# Placement Shot-Owner Parity Correction

## Goal

Make every calibration prompt obey table-tennis shot order and prevent
predictions attached to an impossible hitter from entering the experiment.

## Authoritative identity rule

The confirmed effective server owns odd-numbered shots: 1, 3, 5, and so on.
The receiver owns even-numbered shots: 2, 4, 6, and so on.

- Shot 1 is the serve.
- Shot 2 is the return.
- Later shots alternate deterministically.
- Physical hitter and receiver sides are derived from the effective server,
  the user's physical side, and shot-number parity.
- A detector-provided `hitter_side` is evidence, not authority.

## Existing pilot behavior

The immutable source proposal remains stored for audit reproducibility. The
review UI always derives the effective hitter and receiver from the
authoritative identity rule, even when the reviewer has not corrected the
server.

If the source proposal's stored hitter contradicts the derived hitter:

- show the corrected hitter, receiver, and target side;
- label the prompt discreetly as corrected from serve order;
- hide every prediction tied to the inconsistent source identity;
- allow the reviewer to save and submit human truth normally;
- export a specific prediction incompatibility reason;
- exclude that row from every model denominator.

Server-corrected assignments continue to use the same safety behavior.

## Future pilot generation

The pilot manifest builder rejects event candidates whose stored hitter does
not match the hitter derived from scored server, physical user side, phase,
and shot parity. This prevents impossible identities from being selected in a
new batch.

## Production audit

The current batch contains five inconsistent sources and seven assignments
including repeats: items 7, 14, 20, 25, 28, 32, and 37.

Only item 7 has a human answer. Reset item 7 from its in-progress exclusion to
an unanswered assignment after the corrected UI is deployed. Do not mutate
any other human answer.

## Data and scoring

No schema migration is required.

Exports add a nullable `prediction_incompatibility_reason`:

- `server_corrected`
- `shot_owner_inconsistent`
- `null`

The existing `prediction_compatible` boolean remains the primary scorer gate.
The scorer records incompatible rows separately as:

- `server_corrected_prediction_stale`
- `shot_owner_inconsistent_prediction_stale`

These rows do not enter observability, placement eligibility, system coverage,
distance, zone accuracy, or mirror-rate denominators.

## Tests and verification

- Pure tests cover serve, return, odd rally, and even rally ownership.
- A regression test reproduces Vaibhav serving while shot 4 was incorrectly
  attributed to Vaibhav.
- Builder tests reject impossible candidate identity.
- UI contract tests require corrected serve-order copy.
- Export and scorer tests distinguish both incompatibility reasons.
- Run the full worker suite, research tests, UI tests, lint, production build,
  a read-only production audit, and a narrowly guarded item-7 reset.

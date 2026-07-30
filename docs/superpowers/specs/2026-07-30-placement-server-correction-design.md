# Placement Calibration Server Correction

## Goal

Let the reviewer correct a wrongly attributed server without labeling the
wrong physical event or contaminating the placement comparison.

## Reviewer experience

- The server badge becomes an explicit correction control.
- It shows the server currently assumed by the experiment and offers the other
  player as a one-tap correction.
- Correcting the server updates the named hitter, receiver, table side, and
  validation instruction for the same semantic phase:
  - serve: corrected server's second bounce on the receiver's side;
  - return: corrected receiver's return, first bounce on the corrected
    server's side;
  - rally: preserve the shot sequence while swapping the alternating hitter
    and receiver implied by the corrected server.
- A server correction clears any existing placement answer because the target
  event may have changed.
- The UI states that the computer comparison is unavailable until predictions
  for the corrected server hypothesis exist. The reviewer can still mark and
  submit the human truth.
- The reviewer never needs to exclude an otherwise valid point merely because
  the scored server was wrong.

## Data contract

The JSONB human label gains:

- `corrected_server`: `"user" | "opponent" | null`
- `server_corrected`: boolean audit state derived from whether
  `corrected_server` differs from the proposal's `scored_server`

The proposal remains immutable. The original scored server and predictions
stay attached to the frozen source for reproducibility. A helper derives the
effective proposal used by the UI from the immutable proposal plus the human
server correction.

No database migration is needed because the label is already JSONB.

## Comparison and scoring safety

- The comparison API returns a server compatibility flag.
- Predictions are shown only when the effective server matches the proposal's
  scored server.
- A corrected-server label is exported as valid human truth together with
  `corrected_server` and `prediction_compatible: false`.
- The scorer records corrected-server rows under
  `server_corrected_prediction_stale` and excludes them from every prediction
  accuracy, coverage, zone, and mirror denominator.
- When corrected-hypothesis predictions are regenerated later, the proposal
  can expose an explicitly keyed compatible variant and the same human label
  becomes scoreable without relabeling.
- Repeated assignments for the same source inherit a saved server correction
  in the client so the reviewer is not asked to rediscover it.

## Error handling

- Changing the server requires confirmation if an answer already exists,
  because the mark will be cleared.
- A correction can be reversed; reversing it also clears the current answer.
- Corrected points can be completed without revealing stale predictions.
- Existing labels without the new field hydrate with `corrected_server: null`.

## Tests

- Effective proposal derivation for serve, return, and rally.
- Changing server clears answer fields and comparison reveal state.
- Corrected-server labels validate and submit without comparison.
- Comparison API does not return stale predictions.
- Export marks corrected rows as prediction-incompatible.
- Scorer excludes corrected rows from all model denominators.
- Existing uncorrected assignments retain current behavior.

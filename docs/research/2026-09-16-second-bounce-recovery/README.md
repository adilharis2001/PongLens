# Reviewed second-bounce recovery

The 24-point owner review contained 18 real serves and six dead-play, warm-up,
or pass clips. Some of those six clips were still present as scored cards, so
the production recovery must refuse them rather than assuming scoring removed
them.

Of the 18 real serves, ten placements were accepted exactly, five were moved,
one withheld occluded landing was manually estimated, and two service errors
had no legal receiver-side second bounce. Both points recovered in the offline
experiment because their first bounce was missing were accepted exactly.

The production rule is intentionally narrower than the exploratory rule. A
receiver-side bounce may replace a later or invalid serve pair only when:

1. the point has a serve anchor;
2. the bounce is on the receiver's half;
3. it occurs 0.25 to 1.35 seconds after that anchor;
4. the receiver's first detected paddle contact follows it by 0.05 to 0.45
   seconds; and
5. the current reconstruction has no earlier valid receiver-side serve
   landing; and
6. a physically valid existing placement is never replaced. If the current
   placement has no physical contradiction, the point must also contain at
   least two detected hits so a one-stroke pass cannot become a serve.

The recovered hypothesis contains only the serve shot. Later shots assembled
from the rejected serve pair are discarded. A service error with no
receiver-side bounce remains unavailable, and an occluded landing without a
receiver contact remains withheld.

Reviewed examples:

- Chris point 5: recovered far-side bounce at 39.0315, accepted.
- Julian point 11: recovered far-side bounce at 139.7248, accepted.
- Chris point 14: earlier far-side bounce at 130.3385 precedes the far
  receiver's return; the existing solver instead used a later rally pair.
- Christine point 30: no receiver contact supports the occluded candidate;
  keep withheld.
- Julian points 7 and 17: service errors never reach the receiver half; keep
  withheld.
- Yu Yu Lin point 4: the bounce and reversal imitate a serve, but the owner
  identified a pass/dead clip and the point has only one detected hit; keep
  the existing review result rather than promoting it.

## Scored-corpus replay

The final rule was replayed through the same placement aggregation used by the
product on the first game of seven recently scored matches. It increased
renderable placements from 64/129 to 74/129 (49.6% to 57.4%). The ten additions
were six Lester, one Yu Yu Lin, one Chris, one Louis, and one Julian point.

All nine changed first-game points from the hard-angle Lester and Louis videos
were inspected from the source footage and were genuine serves. The Yu Yu Lin
addition was also inspected and is a rally; the user-rejected Yu point 4 was
unchanged. Existing ready placements, occluded landings without a receiver
contact, and service errors were unchanged.

Verification:

- `python3 -m unittest worker.tests.test_placement_reconstruction worker.tests.test_placement_second_bounce_recovery` — 48 passed.
- `worker.tests.test_placement_serve_seed` under the worker venv with inert
  fixture environment values — 9 passed.
- Chris point 5's recovered production payload passed `_validate_v3_placement`.
- `replay.py /private/tmp/adil-serve-eval` changed 25 selected physical-server
  hypotheses across all games; the product-level first-game aggregation added
  ten renderable placements and removed none.
- The 103 placement aggregation/rendering tests passed.
- The full `npm run build` passed with the repository's existing warnings.

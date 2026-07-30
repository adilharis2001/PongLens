# Latest Placement Label Analysis and Exclusions

## Goal

Make the placement calibration pilot analyze the reviewer’s latest saved answer,
including corrections made after predictions are shown. Add an explicit way to
exclude unusable source points from every analytical denominator.

## Analysis contract

- The latest saved answer is the sole human truth used for scoring.
- A historical blind snapshot may remain in stored assignment JSON for audit
  compatibility, but scoring and analytical exports must never read or expose
  it.
- Post-reveal edits are eligible. `post_reveal_edited` is audit metadata only
  and is not an exclusion criterion.
- Analytical exports expose a normalized `analysis_label` made from the latest
  result, coordinates, visibility, confidence, and exclusion reason.
- The scorer prefers `analysis_label` and may fall back to the current fields
  in `human_label` for older exports. It must ignore `blind_snapshot` in both
  cases.

## Reviewer experience

- Replace blind-oriented copy with “Save answer & show comparison.”
- Predictions remain hidden until the reviewer first saves an answer, avoiding
  accidental anchoring while preserving the existing comparison workflow.
- Corrections after reveal update the mark and comparison distances normally.
  The UI states that the latest saved answer is used in analysis.
- Add `Exclude this point` as an answer with one required reason:
  - `net_contact`
  - `not_a_point`
  - `wrong_clip_or_event`
  - `other`
- An excluded point can be completed without revealing predictions.
- Existing `no_table_bounce` remains distinct: it describes a valid requested
  event that did not bounce on the table. `excluded` means the source is
  unsuitable for evaluating either system.

## Data shape

The JSON label contract adds:

- result value `excluded`
- nullable `exclusion_reason`

Choosing any non-excluded result clears `exclusion_reason`. Choosing any result
other than `landed` clears coordinates, visibility, and confidence. An excluded
label is complete only after a valid exclusion reason is selected.

No database migration is needed because human labels are stored as JSONB and
the existing assignment update policy already permits this field.

## Scoring

- Excluded points are counted under exclusion reasons only.
- Excluded points do not enter observability, placement eligibility, system
  coverage, distance, zone accuracy, or mirror-rate denominators.
- Non-excluded `landed` labels remain eligible unless incomplete or marked
  `unsure`.
- Repeat assignments remain outside the primary accuracy calculation.
- Rename the report field from `eligible_blind_landings` to
  `eligible_landings` and increment the report schema version.

## Compatibility and testing

- Previously saved labels continue to hydrate.
- Previously revealed assignments continue to show their comparisons.
- Unit tests cover current-answer scoring after a post-reveal edit, explicit
  exclusion behavior, required exclusion reasons, export normalization, and
  removal of blind language from the UI.
- Run research tests, scorer tests, the full worker suite, lint, and a
  production Next.js build before deployment.

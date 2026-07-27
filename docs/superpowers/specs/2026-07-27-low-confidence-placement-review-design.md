# Low-confidence placement review and quiet production notices

## Goal

Make uncertain placement output easy for the developer to inspect without
making uncertain output look authoritative to app users.

## Review report

The local placement review report will:

- default to showing hypotheses below 70% confidence;
- provide an “All points” control so the rest of the match remains available;
- render the raw shot trajectory for low-confidence hypotheses even when
  `hard_reasons` or `unavailable` status would suppress it in production;
- label the map as a raw, suppressed hypothesis and retain confidence,
  warnings, and the point-scoped rally video;
- show an honest empty state when a suppressed hypothesis contains no usable
  shot geometry.

This behavior is local-review-only. It must not weaken production suppression.

## Production UI

Production continues to hide hard-invalid and unavailable trajectories.
The current amber title/subtitle cards will be removed.

- Hard-invalid or unavailable: show one quiet centered line:
  “A placement map couldn’t be generated for this point because the ball path
  was difficult to track.”
- Review status with a rendered map: show one quiet line:
  “This placement map may be less accurate because the ball path was difficult
  to track.”
- Do not use an amber border, amber background, title/subtitle hierarchy, or
  extra explanatory paragraph.

The existing server-confirmation prompt is unchanged because it asks for a
specific user action rather than reporting tracking uncertainty.

## Verification

- Python report tests prove the under-70 filter metadata and raw suppressed
  trajectory behavior.
- Placement-model tests prove the notice decision for ready, review,
  unavailable, and hard-invalid hypotheses.
- Generate the Vaibhab report from existing reconstruction artifacts without
  rerunning model inference.
- Visually verify the local report and the production component in the app
  theme.

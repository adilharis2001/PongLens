# Serve Contact Ground Truth Design

## Goal

Make the 100-point temporal serve research cohort collect the first visible paddle-ball contact of the serve as its primary ground truth. Keep the existing model motion-onset timestamp as a navigation hint, not as a contact prediction.

## Label contract

- A completed label is either an exact first serve paddle-contact time or `not_visible`.
- The contact time must be inside the point clip.
- Existing version-1 onset reviews remain intact as `legacy_onset_review`; they do not count as completed contact labels.
- When one of those points is relabeled, the new version-2 contact label carries the old onset review with it.
- No fixed two- or three-second rewind is treated as motion onset or ground truth.

## Review experience

- Start playback at the model motion-onset estimate at 0.25× to reduce seeking.
- Label that jump clearly as a motion-onset hint.
- Ask the reviewer to move frame-by-frame to the first paddle-ball contact and mark it, or choose that contact is not visible.
- Remove “model onset correct,” onset-error, and timing-error language because there is no model contact prediction yet.
- Show progress as exact contacts, not-visible contacts, and remaining points.
- Keep match/model-outcome filters, notes, protected video loading, and JSON export.

## Research interpretation

These labels create training and evaluation truth for a future contact predictor. A later experiment can combine contact timing with player identity, audio, pose, and bounce timing. Motion onset remains useful secondary evidence but is not the target of this pass.

## Verification

- Unit-test version-1 preservation, version-2 validation, review filtering, and progress.
- Run the research test suites, lint, and the production build.
- Deploy to `main`; verify the Vercel check and the protected route.

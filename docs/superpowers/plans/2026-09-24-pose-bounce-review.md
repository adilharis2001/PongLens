# Pose-assisted last-bounce review

User authorized corpus recommendations and production publication. Admin web only; existing PointEndingReview.tsx and RallyPredictionReview.tsx are the rendered/source visual references.

1. Freeze recording-held-out primary pose model and generate 479 recommendations without using target point annotations. Explicit ball-only fallback where pose is absent or sparse. Preserve prior winner experiment separately.
2. Define last playable table bounce consistently across long, wide, net, winner and double-bounce endings. Add optional explicit no-live-bounce/uncertain review outcomes. Preserve prior labels and prior experiment history.
3. Version suggestions; validate finite scores, time windows, ids and provenance. Test legacy reviews, correction persistence, no silent acceptance, and importer immutability.
4. Run research tests, full production build, desktop and 393×660 mobile rendered checks against existing page. Independent review.
5. Append immutable research predictions only, verify labels/history untouched; publish main and verify deployment. No worker, player scoring or native changes.

Evidence: primary 32/50 marked last bounces vs ball-only 28/50. These are exploratory recording-held-out results on existing labels, not new-corpus accuracy. Ranking margin is not calibrated probability. Preserve variable old labels for the user to correct rather than rewriting them.

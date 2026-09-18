# Persistent point-ending labels

Adil approved a single ending-reason dropdown and optional custom reason/note across all 479 study points. This replaces the local review batches and isolated experiments. Target web desktop and mobile only; reference the rendered Serve spin page and SpinReview.tsx.

1. Freeze the cohort and import explicit earlier causes with original annotations and hashes. Bind each point to its original video clock and saved score/tap reference. Verify all media and identities; never overwrite scores.
2. Add private research tables with immutable source records, revisions and label history. Seed idempotently; retain existing annotations outside the cohort in the import archive. Test access restrictions and concurrent saves.
3. Add /research/point-endings and dashboard entry. All points accessible; first unfinished by default; one reason dropdown, reusable custom reasons, optional notes, autosave status, next point and frame controls. Signed source video windows, not expiring stored URLs.
4. Test import identity/clock/causes, validation, save serialization and frame movement. Run full npm run build in this worktree. Verify actual DB persistence and render desktop plus 393x660 mobile, including custom reason and save error behavior.
5. Present screenshots for the mandatory AGENTS.md approval gate. Publish after approval, then verify the production research route. Keep automation focused on this task; no detector tuning.

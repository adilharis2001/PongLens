# Persistent point-ending labels

All 479 frozen study points are available under Admin → Research → Point-ending labels. Thirty-two earlier ending labels are imported; all 40 original reviews are archived in the database. One ending dropdown, reusable custom reasons and optional notes build the cause dataset without changing match scores.

| Check | Result |
| --- | --- |
| Corpus | Lester103, Prabhas53, Ishan69, Chris88, Julian75, YuYuLin91 |
| Original scores/taps vs live | No differences across 479 points |
| Sources | All six original objects available; recording/version identity unchanged |
| Imported causes | Long14, missed return12, net5, double bounce1 |
| Provenance | Five complete hashed import archives; source snapshots and original annotations retained |
| DB migration | 20260918220000 applied; admin-only reads and label updates; immutable source columns |
| Save QA | Transaction rollback tested update/history/custom choices, stale revisions, source write denial and non-admin/anonymous denial |
| Browser save | Re-saved Lester37's existing long answer; DB revision1; labels unchanged32/479 |
| Tests | 235 research tests passed; frame stepping, input validation, resume and serialized/retry writes included |
| Full build | npm run build passed on current main plus this feature; pre-existing lint warnings remain |
| UI reference | Production Serve spin, SpinReview.tsx |
| UI verification | Desktop1024×900 and mobile393×660; one-frame advance twice; custom draft; imported label; phone actions ≥44px, no horizontal overflow |
| Review | Independent read-only review; two save-recovery/navigation findings fixed and re-reviewed |
| Native / worker | Not affected or changed |

The user explicitly requested immediate production publishing after checks, then confirmed placement under Admin → Research. Production must be a push to main, never a branch CLI deployment. Source-clock taps are human timing references, not exact physical end labels. Yu Yu Lin's original video offset uses the prior frame-verified 241.96666666666667 seconds, not the nominal trim value.

Private inputs stay outside git. Re-running scripts/research/seed-point-ending-labels.py with the original artifact directory verifies immutable source values and never overwrites existing labels. Contact-only annotations remain notes/provenance, not inferred ending causes. Brian's original reviews are archived but are not part of this six-recording cohort.

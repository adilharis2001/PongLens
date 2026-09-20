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

## Ball evidence addition

User requested trail and bounce access on this page and approved the page
screenshots on September 18. The overlay uses the shipped Serve accuracy
player (`ServeAccuracy.tsx`, inspected rendered on production) as its visual
reference: a half-second yellow trail and timed bounce rings, with controls
immediately below the same video. Numbered bounce buttons seek while paused.

- Frozen evidence: 479 points, 80,835 observations, 3,604 bounce candidates.
- `point_ending_evidence` stores immutable snapshots separately from labels;
  admin SELECT only, no authenticated writes. Migration applied and seeded.
- Prabhas/Ishan use the earlier cached full-frame research detections; other
  matches use stored production tracks. Bounce candidates come from the
  frozen placement record. Lineage is disclosed in the page references.
- Observations remain in processed-match time. Playback subtracts the raw
  offset exactly once; bounce seek adds it once (Yu Yu Lin: 241.9666667 s).
- Trail breaks at missing observations and large jumps; no gap interpolation.
- All 239 research tests pass, including offset, gaps, timed rings and fit.
- Database isolation verified: admin reads 479, non-admin reads zero,
  anonymous denied, admin evidence update denied. Labels remain 32/479 and
  revision sum 3 before and after seed.
- Source review found no actionable findings. This changes desktop and mobile
  web only; no worker pipeline, detector, score, or native iOS changes.

Final overlay verification: full production build passed after the responsive
width fix. Desktop 1024×900 and mobile 393×660 have no page overflow. Rendered
Lester trail/ring alignment, both toggles off/on, bounce seeking, repeated frame
advance, and Yu Yu Lin raw 254.266966 s / match 12.30 s checked. Screenshots:
`/private/tmp/point-ending-overlay-desktop.png`,
`/private/tmp/point-ending-overlay-mobile.png`. Native iOS not changed or tested.
Rebased onto main `6a6fe1bf`; the only intervening main change is iOS source.

## Publication

Adil explicitly approved the updated overlays and requested production testing.
The complete feature was pushed to remote main as `8bb9dd16`. Vercel did not
create a deployment or commit check for that push; its latest production build
still pointed at `6a6fe1bf`. This documentation update retries the normal
main-branch Git trigger without changing the verified application source.

Production verified at 2026-09-18 22:04 UTC: Vercel deployment
`dpl_G8XUfWvHrwUwpbN8Ufm7ELCHUTww` is READY for exact remote main
`e37223d48ac72279f3e5a1796a80921dd50534ef`, with www.ponglens.com and
ponglens.com aliases. The delayed normal Git deployment succeeded; no fallback
API deployment was performed and no fallback approval is needed. Authenticated
production Research contains Point-ending labels; the page loads all 479 rows,
32 prior labels, signed video and ball evidence. Bounce jump, visible trail/ring,
frame advance and autosave checked live. Re-saved Lester37's existing long
answer unchanged, with UI Saved / All answers saved. Research labels only;
match scores unchanged. Live URL: https://www.ponglens.com/research/point-endings

## Optional bounce annotations, 2026-09-20

Owner requested five optional capabilities and explicitly instructed immediate
production publishing without any further questions; screenshot review is
waived for this change. The shipped Point-ending labels screen is the rendered
and source visual reference. No separate design language or required fields.

- Collapsed Bounce details beside player controls. Add a missed bounce at the
  current raw-video frame; classify as table/serve/rally, paddle, floor, or
  non-playing table bounce; optionally record near/far side; choose one last
  rally bounce. Clear individual annotations or remove additions.
- Detected indices remain stable. Added events retain UUIDs and raw timestamps;
  no guessed image position. The overlay shows classifications and timed added
  event captions. Original detector evidence is immutable.
- Optional `label.bounceReview` uses the existing audited revisioned JSON store.
  No migration, scoring change, worker change or native iOS change. Old clients
  omitting annotations preserve them; retries compare the whole normalized label.
  Server validates all detector references, times, kinds and last-bounce state.
- 244 research tests passed; full `npm run build` passed (existing unrelated
  lint warnings). Independent review caught playback-end timestamp overshoot;
  timestamp clamping fixed and regression covered.
- Browser QA uses the real component with two isolated local fixtures, real
  signed Lester/Yu video and built CSS. No invented production labels. All event
  types, last-bounce reassignment/clearing, add/remove, reload persistence, one
  frame seek, failed save plus newer edit/retry, and Yu raw offset checked.
- Desktop1024×900 and mobile393×660 rendered; no page overflow, mobile action
  buttons/selects361×44px. Screenshots `/private/tmp/bounce-annotations-mobile.png`
  and `/private/tmp/bounce-annotations-desktop.png`. Native iOS not tested.
- Existing database transaction verified optional JSON and matching history;
  rollback verified all479 labels and revisions unchanged.
- Recurring study remains paused. No hypothesis testing or label reinterpretation.

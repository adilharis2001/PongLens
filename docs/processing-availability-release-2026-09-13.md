# Processing availability release preparation

This release is being prepared, not deployed. It keeps the existing serve-opening worker and adds clear waiting messages, quiet retries of the initial match-ready email, and a rough queue-aware completion estimate. Web and iOS screenshots require Adil's approval before publication.

| Ownership | Record |
| --- | --- |
| Task | Harden Worker Release Process,01a08feb-e1c3-7251-b343-975cc2f7858b |
| App | .worktrees/processing-availability,base49a82643 |
| Worker | .worktrees/processing-availability-worker,base6aebfd66 |
| Live release to preserve | caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92 |
| Algorithm scope | No model,point,serve,ending or timing changes |
| Other task | ScoreKeeper's early-outcome work owns Player.tsx,ScoreLogic.swift,PlayerTakeover*. No overlap permitted |

| Item | Preparation state |
| --- | --- |
| Availability database | e191aacb;16 real PostgreSQL tests; independent review clean. Trusted worker receipts only, never jobs.updated_at as proof of life |
| Web | Availability review clean at8f13fa1e; estimates atd14b149c.36 focused checks; full production build passed. Desktop1280×800 and mobile393×660 primary-screen previews captured; completed-upload/import and all native states not yet fully rendered |
| iOS | Availability review clean at8f13fa1e; estimates atd14b149c. Full simulator build,1115 core checks,47 availability checks and13 estimate checks passed. Optional-estimate decoding/manual-retry review fixes pending; full-screen harness preparation pending |
| Email | Worker5965a5f7, migrations in app3843d0b6.77 tests +14 subtests; scoped review clean. Only initial deadspace_cut ready mail retries; no historical replay, no outage/recovery/reclip/placement mail. Existing explicit export emails unchanged |
| ETA | Server0cd5a0f0/app migration424bc590;25 estimator/database tests and66 related checks. Review corrections for active delivery transitions, receipt ordering and queue-only expiry in progress |
| Package/activation | No new package sealed or activated |

| ETA handoff authority and evidence | Record |
| --- | --- |
| Source task | Improve upload sanity checks,01a0965f-30c8-77f1-a3d8-957d50f9b141 |
| Adil's handoff instruction | “Can you please pass it to one of them and then have them take over once you're done?” |
| Inclusion instruction | “I am going to go to sleep so please take over this and make sure that it gets included as part of one of the chats' work so that when the package release comes we have it included.” |
| Accepted expectation | A labelled broad baseline accounting for eligible uploads ahead plus ownprocessing. Sparse exactrelease data doesnot automatically removeallnumbers; no invented coefficients orguaranteeddeadline |
| Priority | Availability beforeETA. READYtime differsfromcapacityRELEASEDtail. No linearprogresspercentageprediction |
| Prior measurements | /private/tmp/ponglens-eta-feasibility-20260912: fourrecentbodiescompletions,13.0–26.2minREADY,83.8–127.5s postreadyoccupancy. Needrawrecordprovenance beforeusingcoefficients |
| Opening-task benchmark |763.65ssource cachedtail144.607s excludesinference/download/publication; NOTfulljobtime |
| Design handoff | .worktrees/upload-processing-feedback/docs/queue-aware-eta-handoff-2026-09-13.md; receivingtask ownsallimplementation/release; source taskmakingnocompetingedits |

| Release gates | Status |
| --- | --- |
| Database privacy,performance,realqueuefixtures | Availability complete; estimator delivery-transition fixtures in progress |
| Mail restart/dedup/suppression tests | Passed, including real PostgreSQL ambiguous-send retry and cost-write failure |
| ETA timedreplay,baselineprovenance,expiry | Baseline recorded;18 multi-release bodies/no-placement runs, chronological holdout7/8 coverage.60fps upper-bound extrapolation explicitly uncalibrated; receipt/expiry fixes pending |
| Fullwebbuild+desktop/393×660renders | Partiallyverified |
| Nativebuild+simulatorscreens | Build passed; full-screen visual gate pending |
| Independentreviews | Inprogress |
| Sealedpackageall8offlinechecks+integrity | Pending |
| Screenshotapproval | Not requested yet; no publication |

| Operational contract | Required at release |
| --- | --- |
| Migrations | Apply060000 availability,061000 mail outbox,062000 estimates in order; mail capture defaults disabled |
| Email cutover | Drain/stop old main+fast, select verified new bundle, enable mail capture only when old senders cannot complete more jobs; independent monitor uses new source |
| Rollback | Stop monitor delivery and disable capture before restoring exact caeb launchers; keep sent/expired records, never replay historical jobs |
| Current fallback verification | caeb package integrity reverified locally Sep13 during preparation; unchanged runtime anchor paths, bodyv2 and behavior inputs confirmed |
| Preview | Local-only scripts/qa/processing-availability/serve.mjs, port8774; /review is the screenshot gallery. Fixtures have no production transport or credentials |
| Handoff record | Plan ledger under .superpowers/sdd/2026-09-13-processing-availability, per-task reports/reviews; this tracked table is the durable publication checkpoint |

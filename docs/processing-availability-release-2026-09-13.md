# Processing availability release preparation

This release is being prepared, not deployed. It keeps the existing serve-opening worker and adds clear waiting messages, quiet retries of the initial match-ready email, and a rough queue-aware completion estimate. Adil approved the reviewed web and iOS wording and layout on September 13, 2026; remaining verification gates still apply.

| Ownership | Record |
| --- | --- |
| Task | Harden Worker Release Process,01a08feb-e1c3-7251-b343-975cc2f7858b |
| App | .worktrees/processing-availability,base49a82643 |
| Worker | .worktrees/processing-availability-worker,base6aebfd66 |
| Live release to preserve | caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92 |
| Algorithm scope | No model,point,serve,ending or timing changes |
| Other task | ScoreKeeper's approved early-outcome fix is on origin/main as5f88a45140c3770bbc0013d0155d8418f5ef8453, reported by its owner and verified locally. Preserve Player.tsx,ScoreLogic.swift,PlayerTakeover.swift/PlayerTakeoverScore.swift and its tests/docs at integration. Root dirty checkout untouched |

| Item | Preparation state |
| --- | --- |
| Availability database | e191aacb;16 real PostgreSQL tests; independent review clean. Trusted worker receipts only, never jobs.updated_at as proof of life |
| Web | Production fixes through208c57e9; fixture through990622ef. Full npm run build passed. Desktop1280×800/mobile393×660 actual components rendered; fake upload events exercise in-flight, saved and queued states. Upload27, processing50 and matches10 regression checks passed |
| iOS | Production fixes93adf763/c7e81a55; isolated full-screen harnessa14f8953. Simulator build and1127 core checks passed, plus47 availability/13 estimate/7 import-observation checks. Home, Matches, Match, Upload and Export rendered; unknown, maintenance, hand, mixed-lane and overdue states inspected |
| Email | Workerf9aad58d; migrations in app3843d0b6.79 tests +14 subtests; final scoped review clean. Only initial deadspace_cut ready mail retries; no historical replay or outage/recovery/reclip/placement mail. Existing legacy YouTube and explicit export emails preserved |
| ETA | Serverc7997bb6/app migration8cac8418;36 estimator/database tests and66 related checks. Receipt attempt/order, queue visibility races, active-slot cap and queue-only expiry corrected; server and UI reviews clean |
| Package/activation | Candidate e9c3cd9cb3bd536dc689bc3214e63085ec6e3d1de129c30cf3202a75d44e9552 sealed fromf9aad58d; not activated. Earlier85137860 candidate is superseded |

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
| Database privacy,performance,realqueuefixtures | Availability and estimator checks complete; actual pgmq.read race fixtures included |
| Mail restart/dedup/suppression tests | Passed, including real PostgreSQL ambiguous-send retry and cost-write failure |
| ETA timedreplay,baselineprovenance,expiry | Baseline recorded;18 multi-release bodies/no-placement runs, chronological holdout7/8 coverage.60fps upper-bound extrapolation explicitly uncalibrated; receipt/expiry reviews clean |
| Fullwebbuild+desktop/393×660renders | Passed; synthetic transfers, no real upload or production writes |
| Nativebuild+simulatorscreens | Build and main-screen renders passed. In-flight recording transfer/background-resume not exercised end to end; remains a device-check gate |
| Independentreviews | Whole-branch review found one legacy YouTube mail regression; fixedf9aad58d and scoped rereview clean. No other Critical/Important findings |
| Sealedpackageall8offlinechecks+integrity | Final e9c3cd9c candidate passed8/8: imports, native, pose, table, ball, frozen parity and side changes twice; integrity checked after inference. Main/fast check-only verified, not started. Initial sandbox pose run failed on CoreML service access; same unchanged code passed with accelerator access, network denied |
| Screenshotapproval | Approved by Adil September13,2026: “Yeah I think that's fine. It looks good”, in response to the web/iOS gallery http://127.0.0.1:8774/review. Approval covers the shown wording/layout, not a claim that remaining checks or deployment are complete |

| Operational contract | Required at release |
| --- | --- |
| Migrations | Apply060000 availability,061000 mail outbox,062000 estimates in order; mail capture defaults disabled |
| Email cutover | Drain/stop old main+fast, select verified new bundle, enable mail capture only when old senders cannot complete more jobs; independent monitor uses new source |
| Rollback | Stop monitor delivery and disable capture before restoring exact caeb launchers; keep sent/expired records, never replay historical jobs |
| Current fallback verification | caeb package integrity reverified locally Sep13 during preparation; unchanged runtime anchor paths, bodyv2 and behavior inputs confirmed |
| Candidate location | /private/tmp/ponglens-availability-package-a1mPjl/packages/e9c3cd9cb3bd536dc689bc3214e63085ec6e3d1de129c30cf3202a75d44e9552; temporary, not installed in live release directory |
| Candidate preservation | body_model/runtime/behavior_env/adapters equal preceding verified85137860 candidate, whose fields matched livecaeb. Processing algorithm and model files unchanged |
| Preview | Local-only scripts/qa/processing-availability/serve.mjs, port8774; /review is the screenshot gallery. Fixtures have no production transport or credentials |
| Handoff record | Plan ledger under .superpowers/sdd/2026-09-13-processing-availability, per-task reports/reviews; this tracked table is the durable publication checkpoint |

| Decisions and test limits | Record |
| --- | --- |
| Email volume | One existing ready email, retried with a stable provider key only inside the deduplication window; no maintenance-start, recovery or backlog digest emails |
| Suppression rule | Preserve canonical fail-open lookup. Successful suppression blocks sending; lookup failure can still permit mail, matching existing product policy |
| Rough60fps range | Keep measured lower bound; expand upper byfps/30 for30–60fps, labelled extrapolated. Can be broad or miss unusual workloads; not a calibrated promise |
| Native fixture isolation | First harness attempt likely issued one synthetic-token thumbnail read to production; stopped and corrected. Final harness seeds only in-memory fake auth, mocks API/Supabase/thumb transports, uses loopback and denies unhandled network.19 isolation assertions passed; no real credentials or writes used |
| Not verified | No production migration/cutover, provider delivery, real video processing, native background transfer or physical-device run in this task |

| Cross-task inclusion audit, September13 | Evidence |
| --- | --- |
| Upload-sanity app changes | App baseline49a82643 is an ancestor ofb31a8623; includes camera warnings, short-handheld guidance, trim-aware hiding, primary processing stages, owner-only feedback and removal of90-minute promise |
| Upload-sanity worker changes | Combinedd11e1796 is an ancestor off9aad58d; camera_view_check.py, upload_feedback.py and all five associated regression files exactly match handed-overf8fa3309. Worker retains camera-check call sites and claimed/profile/stage/progress/ready/released receipts |
| Later ETA request | Explicit handoff docs/queue-aware-eta-handoff-2026-09-13.md implemented by receiving task; estimator/server/UI included in this release, not a separate pending package |
| Prior rally/serve work | Worker baseline6aebfd66 retains combined rally preservation, measured playback mapping and guarded serve-opening adjustment; no algorithms changed in this candidate |
| Delivery boundary | One coordinated rollout has worker package, three database migrations, web deployment and a new iOS build. The sealed worker package alone does not install customer UI on phones |
| Final smoke evidence | /private/tmp/ponglens-availability-package-a1mPjl/e9c3cd9cb3bd536dc689bc3214e63085ec6e3d1de129c30cf3202a75d44e9552 and sibling ending-native-access contain results/logs; final six modes all exit0, first two exit0 in initial run |

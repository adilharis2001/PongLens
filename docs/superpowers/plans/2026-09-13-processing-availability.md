# Processing availability implementation plan

Adil approved customer-visible, lane-specific availability on web and iOS, while preserving queued work and the deployed serve-opening worker. No outage/recovery emails or routine clip-update emails will be added; failed match-ready delivery may retry without duplicating accepted mail. Screenshots require approval before web or TestFlight publication; production workers remain unchanged during preparation.

> For agentic workers: use superpowers:subagent-driven-development task-by-task. The approved design is the parent task's Sep 13 discussion; this record fixes its interfaces for implementation.

| Global constraint | Contract |
| --- | --- |
| App baseline | origin/main 49a82643, isolated processing-availability worktree |
| Worker baseline | 6aebfd66, isolated processing-availability-worker; current package caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92 |
| Algorithms | No point/model/serve/timing changes; retain all packaged inputs and runtime settings |
| Privacy | Authenticated sanitized status only; never expose pulses, job IDs belonging to others, hostnames, errors or release paths |
| Availability | main/fast/hand separately, fresh <=90s, unknown if never reported; stale previously reported is unavailable unless that lane has genuinely advancing work in last180s; fresh blocked/drained unavailable even though alive. Fresh healthy busy worker is available |
| Cloud | Do not count disabled cloud as fallback; no new routing or cloud activation |
| Copies | Saved upload: Video processing is temporarily unavailable. Your video is saved and queued. Processing will resume automatically when service is restored. You can leave this page. We'll email you when your match is ready. |
| Upload safety | Before completed upload, say requests will wait; never say saved or safe to leave. YouTube queued import says request queued, not video saved |
| Email | Existing initial completed-match notification only. No outage/recovery/reclip/placement email, no historical backfill. Provider idempotency key per delivery, durable attempts, suppression respected; never retry an uncertain send outside provider deduplication window |
| Rendering | Existing RawMatchView processing card / UploadCard and native MatchDetail rawSection; inline notice within existing cards, not nested cards. Desktop,393x660 web,native simulator screenshots before publishing |

## Task 1: Database availability contract

| Item | Exact scope |
| --- | --- |
| Files | New supabase/migrations/20260913060000_processing_availability.sql and src/lib/processingAvailability.database.test.ts in app worktree |
| Interface | authenticated RPC processing_service_status() -> JSON {main,fast,hand,clip_lane,observed_at}; lane strings available,unavailable,maintenance,unknown. clip_lane reflects actual main/fast reclip routing. Private helper processing_lane_status(text) produces lane state |
| Match interface | Extend my_match_processing_feedback(uuid[]) add service_state and lane; preserve all existing ten fields/owner filtering/100 limit. Primary content_check,youtube_import,deadspace_cut main; hand_cut hand. Service read covers fast independently of primary match query |
| Planned maintenance | Existing fresh drained -> maintenance; release_invalid -> unavailable. No new admin switch |
| Stale protection | Ignore old retained stage when heartbeat stale; use recent processing progress as positive evidence only for lane-routed kinds. DB server now; missing or unavailable RPC fails unknown in clients |
| Tests | Real isolated PostgreSQL fixtures test queued/no job pulse+dead main; healthy busy main; each lane independently; both down;90s/180s edges; drained/invalid; never reported; recent genuine progress; disabled cloud; owner/otherowner/anon/service privileges |

- [ ] Write database tests with hand-derived expected states; run RED against missing RPC.
- [ ] Add migration, run GREEN plus existing upload feedback database checks.
- [ ] Commit only task files and report evidence; no production database access/migration.

## Task 2: Web and native integration

| Item | Exact scope |
| --- | --- |
| Files | src/lib/processingAvailability.ts + tests and hook; extend processingFeedback.ts; existing upload,YouTube,Home,library,RawMatchView,share actions. iOS Core/ProcessingFeedback.swift,new service store,Home/Matches/MatchDetail/upload/share views + parity tests |
| Web interface | ServiceState union and ProcessingServiceStatus interface; availabilityNotice(state,context) -> {title,body} or null; context saved_match,uploading,import,fast; polling15s,no overlapping requests,clear stale results after failed refresh/background |
| Rendering | Baseline inspect before edits; show notice on appropriate unavailable/maintenance only. Unknown never asserts outage. Suppress false processing bar for unavailable; unaffected lane continues normally |
| Native | Same JSON and hand-derived fixtures; refresh on foreground/current polling and expiry; queue-safe message only after upload registered |
| Test | node --test --experimental-strip-types src/lib/processingAvailability.test.ts src/lib/processingFeedback.test.ts; Swift Foundation fixtures, simulator build/render; npm run build in isolated .next |

- [ ] Inspect source and rendered shipped reference on web and simulator.
- [ ] Write RED behavior tests for lane-specific,context-safe notices and recovery/failure handling.
- [ ] Implement shared mapping/store then integrations, run GREEN.
- [ ] Render desktop/mobile393x660/native states, capture screenshots; retain approval gate.

## Task 3: Quiet match-ready retry

| Item | Exact scope |
| --- | --- |
| Files | worker/match_ready_delivery.py,new tests,worker.py narrow integration,processing_health.py periodic retry if suitable; separate SQL outbox migration in app worktree if required |
| Interface | Preserve notify_job_done(conn,job_id,user_id) call contract; persist delivery intent before network, send with stable provider idempotency key, bounded retries only; no uploader email expansion |
| Evidence | Real isolated persistence/restart tests plus fake transport; success then repeat attempts sends once,uncertain acceptance safe retry,suppression,noemail,no outage/recovery messages,no old-job replay |
| Failure boundary | Email outage must not fail a completed video. Retry independent of long main job; notification records admin-only; no shared credentials or production sends |
| Persistence | Private transactional outbox for new deadspace_cut completions; stable full provider payload before first attempt. No scans/backfills of old done jobs |
| Cutover | Outbox capture/delivery starts disabled. Enable only after old main/fast workers are drained/stopped and new package selected, so old best-effort sender and new outbox cannot both send. Disable before rollback; do not edit live controls during preparation |
| Retry boundary | Resend documents24h idempotency. Use a23h first-attempt window with persistent sent/expired/suppressed state, stablekeyandpayload, bounded attempts/lease/batch. An uncertain send never retries after the window |
| Reference | https://resend.com/docs/dashboard/emails/idempotency-keys verified Sep13. Initialmatch completion only; preserve existing separately requested export email behavior |

- [ ] Inspect existing sender and completion call lifecycle; write RED for lost failed send and duplicate send.
- [ ] Implement bounded durable retry with deduplication limits; run GREEN and existing email/worker checks.
- [ ] Commit worker changes separately, record exact algorithm-file identity against6aebfd66.

## Task 4: Verify and prepare handoff

- [ ] Independent scoped reviews for DB,UI,mail and final combined diff; fix concrete blockers.
- [ ] Full web build, native build and screenshots; no production outage simulation.
- [ ] Seal new worker source using existing release inputs, all eight offline smoke modes plus post-inference integrity; explicit caeb rollback. Do not activate before UI release approval/coordination.
- [ ] Record commits,package IDs,migration order,screen approvals,tests and remaining first-upload check in handoff; update root CLAUDE pointer narrowly.

## Task 5: Queue-aware estimate (authorized addition, execute before sealing Task4)

| Item | Contract |
| --- | --- |
| Authority | Adil delegated implementation here through Improve upload sanity checks on Sep13; durable handoff in its docs/queue-aware-eta-handoff-2026-09-13.md. He requested inclusion in one coordinated package while he sleeps |
| Scope | One sanitized server estimator reused by web/mobile/iOS/admin. Ready range = eligible work ahead + own processing; label sparse-data benchmark baseline and widen it rather than suppressing all numbers |
| Availability | No completion clock while relevant capacity unavailable, paused or unconfirmed; outage notices take precedence |
| Evidence | Actual queue order/capability/retries, READY distinct from RELEASED, actual trim/frame workload. Tail-only cached benchmark is not full job time. No linear percent-progress prediction |
| Quality | Time-ordered replay coverage/error/width; mixed6-upload queue, unknownmetadata, longactive tail, cancellation, sparse newrelease, expiry/recovery, owner/anon isolation and bounded query costs |
| Release | Astra implementation/Sol tests. Same visual gates and package authority. No extra email kinds |

- [ ] Inspect existing admin estimator and benchmark/telemetry evidence; record a bounded numerical baseline with provenance.
- [ ] Implement and test shared estimator before adding sanitized output to existing feedback contract.
- [ ] Add calm estimated-ready range within existing cards and admin, render all surfaces; merge into combined release checklist.

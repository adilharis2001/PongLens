# Upload choice and readiness correction

This change hides internal video-check estimates and preserves explicit processing choices when the player changes the upload type. iOS persists and retries processing requests using a server receipt that prevents duplicate claims after lost replies. Implementation is verified locally; publication is awaiting the required screenshot approval or explicit waiver.

| Contract | Implementation |
| --- | --- |
| A readiness estimate means the finished match | `_fresh_processing_estimate` exports only active, fresh match/import ranges or overdue estimates, with `ready_scope: match`; web and iOS require that scope. Internal checks still count toward queue occupancy. |
| Video checks remain internal | `ProcessingFeedback` hides standalone check stage labels; a check inside requested processing says “Processing your match”. No new email types. |
| Explicit upload choices survive type selection | `UploadProcessingChoice` applies type defaults only until the corresponding toggle has been explicitly chosen. |
| Lost processing replies are safe | `RecordingQueue` saves request identity, owner, match, placement and trim before sending. `claim_upload_processing` locks the owner/request identity, calls unchanged `claim_processing`, and stores its receipt in the same transaction. Replays return the receipt even after the original job finishes. |
| Transient failures do not erase intent | Bounded backoff, foreground/relaunch recovery, same-account guards, and no automatic processing of historical completed uploads. Force-quitting iOS does not guarantee background execution; reopening resumes pending requests. |
| Registration uncertainty is not permanent failure | Reconcile exact owned storage path, never filename. Retry unavailable lookups. After eight failed completions with a successful owner-matched lookup proving no registration exists, retain the existing failure/Retry path and local footage. |
| Unchanged | Worker release, rally/serve algorithms, Scorekeeper, existing email policy and canonical funding rules. No worker restart required. |

| Verification | Evidence / limit |
| --- | --- |
| Full web production build | `npm run build` passed in the isolated worktree. |
| Web regressions | 23 estimate/feedback checks, 27 upload tests, 42 Scorekeeper tests passed. |
| Native core | Existing suite: 1,139 checks passed; added processing-choice and persisted-request executable passed. |
| Native build | Full Debug simulator build passed after final owner guards. |
| Database | Seven disposable-local-Postgres tests passed: concurrent claims, committed replay, changed payload, ownership, private access, refusal rollback, estimate scope. Canonical billing is stubbed in this harness; no live billing claim was made. |
| Actual native queue | Fake transport exercised lost completion plus failed lookup with automatic recovery, persisted processing replay across termination with the same identity and trims, and confirmed-missing registration returning an actionable failure. |
| Native interaction | Turn processing ON, then choose Match, then Done: actual controls and persisted queue kept processing ON. |
| Visual | Actual components rendered on desktop web (1280×800), mobile web (393×660) and native iOS simulator; no real uploaded media in fixtures. Screenshots are local QA artifacts, not production evidence. |
| Review | No remaining Critical or Important findings in the scoped review. |

| Rollout order | Gate |
| --- | --- |
| 1. Visual approval | Required before web publication or iOS upload, unless explicitly waived. |
| 2. Reconcile current main | Preserve concurrent changes; rebuild if production sources overlap. |
| 3. Database | Apply only `20260913120000_upload_processing_requests.sql`; verify permissions and read boundary without creating a production job. |
| 4. Web | Publish reviewed source and verify exact deployment plus production alias. |
| 5. iOS | Reserve next unused build number, archive and upload; do not claim installed until device confirmation. |

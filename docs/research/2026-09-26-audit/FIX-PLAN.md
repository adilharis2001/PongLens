# Post-rollout audit: fix plan (2026-09-26)

Audit of the hand-cut / Cut again rollout (production, code, cross-surface), verified against the live
database and code at cc2b96d8. Owner decisions recorded 2026-09-26. Paths are repo-relative.

## Already done
- Worker email NameError (`send_email_payload`, `bcc_list`): fixed in 93857d5e; release to all lanes + twin in
  progress (see `docs/research/2026-09-25-cut-again/RELEASE.md`, "Email fix release").

## Player-visible bugs
| # | Problem | Fix | Touches | Ships via |
|---|---|---|---|---|
| A | Marker, "Keep marking" on a prefilled draft: plays past the selected point; selection and chip never follow playback (web too). The cue-and-stop fires once; `beginCutting`/`markBeginCutting` only press play; iOS `markWhenReady` gives up after 20 s. | Keep marking = `playMark(firstUnscored)` (stop at its padded end). Follow rule: when a point is selected and nothing is being adjusted/answered/marked, playback crossing into the next point's window selects it and stops at its end. Cue on first ready, no give-up. | iOS `Screens/PlayerTakeoverMark.swift` (markGate, markRailAction, markBeginCutting, markTick, markWhenReady), `Core/HandCut.swift` (pure follow rule), `Core/MarkLandscape.swift` (railPair); web `src/app/match/[id]/MarkPoints.tsx` (beginCutting, landChrome.onPair, ClipPlayer onTime), `handCut.ts`, `markLandscape.ts`; tests both sides | web + TestFlight |
| B | Gate gives no hint what Keep marking / Start again do. | Owner-approved in principle; copy below needs screenshot approval. | web `MarkPoints.tsx`, `markLandscape.ts`; iOS `PlayerTakeoverMark.swift`, `Core/MarkLandscape.swift` (MarkerCopy, PairTile.detail) | web + TestFlight |
| C | Deleting a match during a Replace or phone cut: job survives, auto Replace minutes not refunded (`fail_auto_recut` needs the version row), bell/email point at a deleted match, admin [Action needed]. | Trigger `_cancel_followups_of_deleted_match` also cancels queued `hand_cut`/`match_reprocess` and phone-held hand cuts, calls `_refund_auto_recut(job)` (idempotent); `jobs_notify_failed` returns early when the match is gone. Worker failure reporter re-reads job + match and stays silent when cancelled/missing. | migration; `worker/worker.py` ~1270-1312 (notify_*), tests `test_failure_emails.py`, `test_hand_recut.py`, `test_auto_recut.py` | migration + worker release |
| D | Hand Replace loses the serve map (636f3f37: 50 mapped -> 0, `keypoint_calibration_declined`). Hand-cut match.json has no table; the rescue fallback reads only the new version's match.json. | Reuse the replaced version's table (or the original match's for a Keep copy) before detecting, only keypoint/vision tables of the same upload and frame size; carry it into the hand-cut match.json. Re-run placement on 636f3f37 after. | `worker/worker.py` load_placement_attempt_record (~3370), placement branch (~3883-3945), hand-cut match.json writer (~8505); `worker/hand_cut_analysis.py`; tests `test_hand_cut_analysis.py`, `test_placement_retry_job.py` | worker release |
| E | Highlights reels ring "Starred points ready ... Tap to download it" (79 in 30 days). | `match_reels_notify`: no bell for scope `highlights`; per-scope labels (Full match, Starred points, Tagged points). | migration | migration |
| F | Point notes of a replaced cut still in Journal, Home, Coaching, Ask (`note_feed`). | Filter to notes whose point is on the active version (or no point). | migration | migration |
| G | iOS: failed-cut and "Upload failed" bells open nothing (link-only, no match_id; handler lacks /match/ and /upload). | Trigger sets match_id when the match exists; iOS parses /match/<id> and /upload, fetches a match missing from the library. | migration; iOS `Core/AccountStore.swift`, `App/MainTabView.swift`, `App/CoachTabView.swift`, `MatchPointLinkTests.swift` | migration + TestFlight |
| H | Phone cut: a locked screen during upload goes silent, handoff after 15 min throws the upload away; upload ignores Wi-Fi only. | `_hand_over_stale_device_hand_cuts`: 60 min when last stage is `device_upload`, else 15. `DeviceCutSession.send` sets `allowsCellularAccess` from the setting; Wi-Fi only with no Wi-Fi at upload hands over at once. | migration; iOS `Core/DeviceHandCut.swift`, `Core/DeviceCutJob.swift`, `Core/RecordSettings.swift`; contract doc; `processingView.ts` comments | migration + TestFlight |
| I | Share page analysis treats a hand cut as automatic (no Point length card without a side; different numbers). | Pass `handCut` from `page.tsx` (cut_source loaded at :705) into `ShareAnalysis.tsx`. | web `src/app/s/[token]/ShareAnalysis.tsx`, `page.tsx`, share test | web |
| J | Single-point share links of a replaced cut keep playing the old clip; the 30-day sweep then breaks them. | On activation re-point `share_links.point_id` to the new point with >= 50% overlap; otherwise protect the old clip in `media_keys_in_use`. | migration (`_activate_hand_recut`, `_activate_auto_recut`, `media_keys_in_use`; consider `admin_publish_match_version`) | migration |
| K | Automatic Keep = copy then `/api/process`; a refusal leaves an unprocessed duplicate. | One call: `claim_auto_recut(p_replace := false)` (live, copies and claims atomically). | web `recut/MoreOptions.tsx`, `recutView.ts` + test; iOS `Core/CutAgainModel.swift`, AutoRecutParams, `CutAgainTests.swift` | web + TestFlight |
| L | A coach review can be submitted during a Replace. | `submit_review_order` raises `recut_in_progress` while a Replace job/candidate exists; order page message "This match is being cut again. Send it once the new cut is ready." | migration; web `src/app/orders/[id]/OrderView.tsx` | migration + web (together) |
| P | Kept phone recordings, now for everyone (approved: 14 days). | Delete the app's copy 14 days after keeping it unless a server draft or the phone's draft has a mark, a hand-cut job exists, a phone cut uses it or the marker is open; a failed read counts as marked. | iOS `Core/LocalVideoIndex.swift` (LocalVideoReconcile.doomed), `Core/LocalMatchVideos.swift` reconcile, `Core/HandCutSession.swift` | TestFlight |
| Q | 2277efbd: empty draft after "Start again" (confirmed from API logs, not a bug) leaves the match reopening empty. | `start_recut` resumes a draft only when it has marks; update `src/lib/cutAgainMigration.test.ts:188`. | migration | migration |

## Security
| # | Problem | Fix | Ships via |
|---|---|---|---|
| M1 | anon/authenticated can execute `cloud_worker_decision(boolean)` (SECURITY DEFINER, writes processing_control). Legit callers: Modal dispatcher and supervisor over DATABASE_URL (postgres/service_role), `set_cloud_worker_mode` internally. | `revoke execute ... from anon, authenticated` after confirming Modal's role. | migration |
| M2 | `hand_cut_drafts` insert/update check only user_id, not match ownership; signed-in insert includes `submitted_at`. | Policies require the match's owner; drop client insert on `submitted_at`/`prefilled`; claims/start_recut set user_id when overwriting. | migration |

## Copy
| # | Problem | Fix | Ships via |
|---|---|---|---|
| N | "Report a problem" opens a page titled "Processing"; rows say "Processing". | Page, heading and every row: "Report a problem"; right side shows a request status only when one exists; keep the job-status pill. Web `feedback/page.tsx`, `MatchFeedback.tsx`, `matchFeedbackView.ts`(+test, wire it); iOS `MatchProcessingFeedbackScreen.swift`, `Core/MatchIssue.swift:175`. | web + TestFlight |
| O1 | iOS "Unsaved marks on this phone were replaced." | "Newer marks from another device replaced the unsaved ones here." (`Core/HandCutSession.swift:90`) | TestFlight |
| O2 | iOS "Not enough minutes. You have 20." vs web "...20 minutes." | Shared helper, "You have {n} minutes." (`BreakItIntoPoints.swift:246`, `Core/CutAgain.swift`) | TestFlight |

## Housekeeping
- R1 CLAUDE.md "Current pairing" paragraph (live: main/fast 69915d26 -> email-fix release, hand 1af85388 -> email-fix release, twin paired).
- R2 Stale specs: marker inventory (scoring gate, "Reset"), ios-hand-cut design (Reset, "Cut on the Mac after 24 h"), `processingView.ts:49,133` + test ("72 hours" -> 15 min / 60 min upload).
- R3 Wire unlisted tests (feedback, highlights route, share, processing availability/feedback/estimate, matchIssues, admin issues; iOS UploadProcessingRecoveryTests + sub-runners); run first.
- R4 Demo capture scripts clicking removed "Placement maps" / "Process when the upload finishes".
- R5 `ball_recrop` label: "Finding the ball again, closer in".
- R6 Remove merged worktrees (list in the audit), deleting their copied `.env.local`.

## Watch (fix while in there)
- S1 Processing notices read the main lane for content checks (fast) and hand-cut follow-ups (hand): copy `job_queue_name` routing into web `processingAvailability.ts` and iOS `ProcessingAvailability.swift`.
- S2 /admin/processing: label a player's Replace distinctly; hand-lane wait threshold ~2 h (admin-only).
- S3 iOS offers Automatically regardless of commerce (`Core/CutAgain.swift:125`).
- S4 Balance unknown: web disables Process, iOS enables; allow on both (server refuses if short).
- S5 Point added after a hand cut: web plays padded clip, iOS plays the marks; web follows iOS (`playhead.ts`).

## Release plan
1. Migration now: M1, M2, C (trigger + bells), E, F, G (bell), H (60 min), J, Q, S2 field. L with the web deploy.
2. Web deploy: A, B, I, K, L message, N, S1, S2 page, S4, S5, R2 comments, R3, R5 (B and N after screenshot approval).
3. TestFlight 247: A, B, G, H, K, N, O1, O2, P, S1, S3, iOS test wiring.
4. Worker release (all lanes + twin): C (silent on cancelled/deleted), D (reuse replaced table). Shadow replay 636f3f37's placement; then re-run placement on 636f3f37.

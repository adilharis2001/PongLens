# Cut again: release plan (database + hand lane only)

Cutting a match again needs hand-lane release #4, then migration
`20260925124616_cut_again.sql`, in that order; main, fast, the health
monitor and the cloud twin are not touched. The release is safe on today's
database and from the moment it runs every published hand cut queues its
own detailed analysis and highlights; the migration then adds the four
calls web and iOS are building against, and Replace works end to end.
Nothing below has been executed; every step is for the owner to run or
approve.

## What moves

| Piece | Today (2026-09-25) | After |
| --- | --- | --- |
| Hand lane (`com.adil.ponglens-worker-hand`) | Release 3, `20d1aaa79c77…` from `b7589b3c` | Release #4 from `codex/ca-server` (worker = `b7589b3c` plus this work only) |
| Main, fast, health monitor, cloud twin | `a8b08902…` / `bb39d41f…` | Unchanged. None of them reads `jobs_hand` |
| Database | 20260925105830 | `20260925124616_cut_again.sql` |
| Web / iOS | | Ship after the migration: before it, the four calls do not exist |

`git diff b7589b3c <release commit> -- worker` is only this work:
`worker.py` (candidate hand cuts, version-scoped rollback, the re-cut
sweep, queued analysis, the re-cut failure email), `email_templates.py`
(one template) and tests.

## What each half does

| | Hand release #4 | Migration |
| --- | --- | --- |
| Every published hand cut (Mac, phone-checked, re-cut made live) | Queues detailed analysis (`request_placement_generation` as the owner), then highlights (`enqueue_reel`, the highlights route's manifest) when the match type allows, `highlights_enabled` passes and 75% is scored | |
| Failed hand cut | Deletes only its own version's points; never undoes a published match | `_hand_cut_hand_back` the same |
| Re-cut that replaces | Cuts into the candidate (`versions/<version>/`), publishes through `publish_hand_recut`, retries the swap for about two minutes, then leaves it to a one-minute sweep | The candidate version, the claim, the publication, the swap |
| Public match link | | The serve map reads the live cut only; `resolve_share_link` also returns `cut_source` (dropped and made again: a new column changes its return type; grants restored) |
| Storage | | Replaced cut and clips stop counting when the new cut is live; a shared original stays counted once |

## Why this order

| If this ran first | What would happen |
| --- | --- |
| Release #4 before the migration (the plan) | Nothing new can reach it: no candidates exist. Queued analysis works (it uses calls already live). The sweep finds no function and stays quiet |
| Migration before release #4 | No data is lost, but a Replace claimed in that window reaches release 3, which refuses it ("This match already has points."), sends the old hand-cut failure email and leaves its candidate open, so that match's More options reads "processing" until the candidate is cleared (SQL under Rollback). Only admins can hand cut today and no client calls the claim yet, so the window is harmless if short |

## Steps

`OPS` = `~/Library/Caches/PongLens/cut-again-<date>/`, `PY` =
`/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python`, every
Python touching a staged or live release runs with `-B`.

| # | Step | Command or check | Pass when |
| --- | --- | --- | --- |
| 1 to 9 | Build, inspect, verify, compare, test, smoke, stage | `docs/research/2026-09-24-hand-cut-analysis/RELEASE-PLAN.md` steps 1 to 9, from a clean tree at the release commit | As there. Step 4: `files` differ from release 3 only in `worker/worker.py`, `worker/email_templates.py` and `worker/tests/`. Step 5: 1,277 tests, the 18 errors that predate this work and no others |
| 10 | Check only | RELEASE-PLAN step 10 | Prints the worker command with `drain-hand` |
| 10b | The re-cut paths inside the sealed package | From the staged release directory: `$PONGLENS_PIPELINE_PY -B -m unittest worker.tests.test_hand_recut worker.tests.test_hand_cut_device worker.tests.test_hand_cut_clock worker.tests.test_email_templates` | All pass (30 + 40 + 6 + 12) |
| 11 to 14 | Quiet release 3, back up the plist, switch, open | RELEASE-PLAN steps 11 to 14, with release 3's state (`20d1aaa7…`) as the old one | `mac:hand` pulses the new id idle; main and fast still `a8b08902` |
| 15 | First hand cut after the switch | Any admin hand cut (Mac or phone) | Its match is ready as before, then `/admin/processing` shows "Detailed analysis" on the hand row, then "Share video" if the match is scored past 75% and not practice. `select kind, status from jobs where options->>'match_id' = '<match>' order by created_at` lists `hand_cut done`, `placement_generate`, then `reel` |
| 16 | Pre-checks for the migration (read only) | See "Checks before the migration" | All as listed |
| 17 | Apply the migration | `supabase/migrations/20260925124616_cut_again.sql` through the Supabase MCP as version `20260925124616` | Applies; its own postcondition block passes |
| 18 | Checks after the migration (read only) | See "Checks after the migration" | All as listed |
| 19 | Web and iOS | Merge their Cut again work; TestFlight | Their More options sheet reads `recut_options` |
| 20 | First Replace | On an admin practice match: More options, Mark the points yourself, Replace, Cut the match | The match keeps playing; the hand row shows "Hand cut" through "Saving the match" (and "Making the new cut live" if other work was running); the match switches to the new cut; one "Match ready" bell; the ready email; then detailed analysis queued |
| 21 | First Keep | Same match, Keep this match and add a new one | A new match in Matches, processing, then ready; the first is unchanged |

Placement for a hand cut took 4.5 to 29 minutes on release 1 and the hand
lane is one process, so a hand cut submitted right after another one
published can wait behind that analysis.

## Checks before the migration

| Check | Query | Pass when |
| --- | --- | --- |
| The live functions are the ones the migration was written from | `select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('sync_active_match_processing_version','activate_match_processing_version','resolve_share_placement','resolve_share_link','_hand_cut_hand_back','normalize_manual_cut_observations','jobs_notify_failed','admin_start_match_reprocess','ledger_on_match_delete') order by 1` | `_hand_cut_hand_back 8c28ff85…`, `activate_match_processing_version 95b4230f…`, `admin_start_match_reprocess 1c7cf9a4…`, `jobs_notify_failed 1ed4168f…`, `ledger_on_match_delete 4256144b…`, `normalize_manual_cut_observations 36bb7503…`, `resolve_share_link 2b6afa29…`, `resolve_share_placement a43b1237…`, `sync_active_match_processing_version c399203f…` (2026-09-25). Any other value: stop, the live function changed; pull it and redo that part |
| The one-open-candidate index can be built | `select match_id from match_processing_versions where status in ('candidate','ready') group by 1 having count(*) > 1` | No rows |
| The hand lane is release #4 | `select code_version, beat_at from worker_pulse where worker_id = 'mac:hand'` (or the hand row on `/admin/processing`) | The new release, beating |

## Checks after the migration

| Check | Query | Pass when |
| --- | --- | --- |
| Versions record how they were cut | `select v.status, v.cut_source, count(*) from match_processing_versions v group by 1, 2` and `select count(*) from matches m join match_processing_versions v on v.id = m.active_processing_version_id where v.cut_source <> m.cut_source` | Active versions split like `matches.cut_source` (9 manual on 2026-09-25); the second query 0 |
| The switch | `select value from app_config where key = 'recut_auto_replace'` | `off` |
| The four calls are the owner's only | `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') a, has_function_privilege('anon', p.oid, 'execute') n from pg_proc p where p.proname in ('recut_options','start_recut','claim_hand_recut','copy_match_for_recut','publish_hand_recut','activate_hand_recut','activate_pending_hand_recuts','_hand_cut_hand_back')` | `a` true only for the four contract calls, `n` false for all |
| Options answer for a real match | `begin; select set_config('request.jwt.claims', '{"sub":"<admin user id>","role":"authenticated","email":"<admin email>"}', true); select public.recut_options('<an admin match id>'); rollback;` (`is_admin()` reads the email claim) | `available` true (or a reason that is true of that match), `replace_by_hand` true, `replace_automatic` false |
| The worker's sweep finds the function | Hand lane log (`worker-hand.log`) | No "hand re-cut sweep failed" lines |

The migration's final block also fails the whole migration if any guard it
depends on is missing.

## What was verified before release (2026-09-25)

| Check | Result |
| --- | --- |
| Migration on a throwaway Postgres 17 (stubs from production definitions): `supabase/tests/cut_again.sql` | Every check passes: options and all four reasons, A (coach review) and C (support request, both ways), Replace and Keep claims and every refusal code, the prefill (winners, lets, stars, trim offset, clamping), the copy and storage counted once whichever match is deleted first, publication, observations, the swap, cut_source projection, share placement, reels, the replaced cut's storage, a swap refused by running work then made live by the sweep, a stale candidate handed back, a failed re-cut leaving the live match byte-identical, deferred constraints |
| Rollback on the same database, then the migration again | Rollback restores all nine functions with checksums identical to production's; re-applying the migration passes every check again |
| Worker suite from the tree root | 1,277 tests, the 18 errors that predate this work, no others (1,246 before) |
| `worker/tests/test_hand_recut.py` | 30 tests: candidate paths, publication, retry, sweep, rollbacks, queued analysis (both / only placement under 75% / none on practice or drills / rollout switch / nothing twice / never fails the cut), dispatch, the re-cut failure email |
| Node | `npm run test:handcut` (96) and `test:processing` (62) pass; `tsc --noEmit` shows the same 18 errors as a clean copy of the base commit, none in changed files |

## Rollback

| Situation | Do this |
| --- | --- |
| Checks fail before step 13 | Nothing is live. Discard the package |
| Release #4 misbehaves, migration not applied | RELEASE-PLAN's lane rollback: `touch <new state>/drain-hand`, wait for `drained`, `bootout`, restore the plist from `$OPS/launcher-backup/`, `bootstrap`, remove release 3's `drain-hand`. Pulse returns to `20d1aaa7…`. Queued analysis stops with it |
| After the migration | Database first, so no new candidate is created: see what is in flight with `select v.match_id, v.status, j.status from match_processing_versions v join jobs j on j.id = v.job_id where v.issue_id is null and v.source_version_id is not null and v.status in ('candidate','ready')`, then run `rollback-20260925124616.sql` (this folder, one transaction: in-flight re-cuts discarded and their marks handed back, the nine functions restored exactly, the new calls, trigger, index and switch removed; the `cut_source` column stays). Then roll the lane back as above if needed. Web and iOS calls then fail as "function does not exist" |
| One match stuck on "processing" after a Replace reached release 3 | `update match_processing_versions set status = 'failed' where id = '<candidate>' and status = 'candidate'; update hand_cut_drafts set submitted_at = null where match_id = '<match>';` |
| Cloud twin | Nothing, in any case |

## Contract notes for web and iOS

The four calls are as `docs/superpowers/specs/2026-09-25-cut-again-contract.md`
says. Details it left open, as built:

| Where | As built |
| --- | --- |
| All four | Another account's match (a coach's view) raises `not_found` |
| `recut_options` | `has_coach_review` counts every review order on the match except `declined` and `cancelled` (so an order awaiting payment or submission counts). `reason` order: `processing`, `not_ready`, `support_request`, `no_source`. A support request means a `reprocess` or `refund` request in `pending`, `reprocess_queued`, `reprocessing` or `candidate_ready` |
| `start_recut` | Also raises `not_enabled`, and the same reason codes as `recut_options` when the sheet would be unavailable. Resumes an unsubmitted draft only if it was saved after the live cut came to be (the latest of its version's creation, completion and activation); an older one (marks left on the raw page before automatic processing, or of a replaced cut) is rebuilt from the live points. Mark `t0`/`t1` are rounded to 3 decimals; `id` is the point's id |
| `claim_hand_recut` | Also raises `invalid_request` when `p_replace` is null, and `bad_state` for a match that is not processed. `support_request` and `already_processing` refuse Keep as well as Replace (the sheet is unavailable then). Keep deletes the original match's unsubmitted draft: the marks moved to the new match |
| `copy_match_for_recut` | Raises the `recut_options` reasons and `duration_unknown`. The copy's `content_checked_at` is the original's, or now for the 79 processed matches that predate the stamp |
| While a Replace runs | `my_match_processing_feedback` already returns the running re-cut (its job pick prefers a queued or processing hand cut on the match; proved against its live definition): `job_id`, `job_kind` `hand_cut`, `lane` `hand`, and the hand lane's `stage`. The job is the owner's (`user_id`), so `jobs` rows by `options->>'match_id'` read it under RLS too; its options carry `recut: 'replace'`. `matches.job_id` moves only at the swap |
| A Replace waiting for other work | Its job reads `done` while the match still shows the old cut and `recut_options` says `processing`, for up to a minute after the match's reclip, analysis or share video finishes |
| Failure bell (Replace) | Title "The new cut didn't finish.", body "Your marks are saved.", link to the match. The email: "The new cut of your match didn't finish" / "Your match hasn't changed. The points you marked are saved, so you can open the match and cut it again." |
| Success (Replace) | The ordinary "Match ready" bell for the owner (coaches are not told of a new match; it is not one) and the ordinary ready email |
| `resolve_share_link` | New last column `cut_source`: the match's for a match link, the point's own cut's for a point link |

## Phase 2 release (2026-09-25): automatic Replace and the retired-cut sweep

Main, fast and the health monitor now run sealed release `69915d26…` from
`9e21c10e`, the cloud twin is its Linux build `44611008…`, and migration
`20260925170532` is applied; `recut_auto_replace` is still `off` and the cloud
switch still Off, so no player can start an automatic Replace yet. Every
sealed check matched the live hand release, and the candidate path now runs
the body-first assembler on both machines within the accepted T4 tolerance.
The hand lane (`1af85388…`) and the web app were not touched.

### What moved

| Piece | Before | After |
| --- | --- | --- |
| Main, fast, health monitor | `a8b089021d26…` (source `f78a93f7`) | `69915d2650f76f395dafcb865bd1d1a951f4f5a0753475b78cb9850d4a54deab` (source `9e21c10e`), opened 2026-09-25 18:30:21 UTC |
| Cloud twin | `bb39d41fce2d…`, pipeline `53910535…` | `44611008404c9f27b6b34527ba05ecdccbba403cfe6a4c5707a839fc60da9301`, pipeline `31244efe1cb0998612f5e1d64c0977c11694a280c51e06e4b1833e239920ba26`, registered 18:28:10 UTC |
| Database | `20260925145751` | `20260925170532_cut_again_auto_replace.sql` (the file formerly `20260925200000`), applied 17:05 UTC |
| Hand lane, web, `recut_auto_replace`, `cloud_mode` | | Unchanged (`1af85388…`, not deployed, `off`, `disabled`) |

### Order, and why the migration went first

| Question | Answer |
| --- | --- |
| Safe before the worker? | Yes. With the switch off, `claim_auto_recut(replace)` refuses `not_enabled` before any write, clients still cannot write a `match_reprocess` job, and a Keep job is an ordinary upload to both the old and the new worker (neither reads `recut`/`recut_from_match_id`). The other replaced functions change behaviour only for rows that could not exist yet |
| Needed before the worker? | Yes: the new main lane's cut sweep reads `match_processing_versions.media_swept_at`, which only the migration adds (the file's header, "apply after", predates that) |
| Before applying | The six replaced functions' live checksums equalled the rollback file's; nothing queued or running |
| Applied | Through the Supabase MCP, recorded byte-identical to the file (md5 `acb6a1b3…`, 57,062 bytes) as `20260925170532` |
| After | `recut_auto_replace` = `off`; `recut_options` on an admin match: `available` true, `replace_by_hand` true, `replace_automatic` false; a Replace claim refused `not_enabled` (rolled back); `claim_auto_recut` executable by `authenticated` only, every other new call by `service_role` only; retired versions: 1 (today's hand Replace), due 2026-10-25, none due now |

### Checks on the Mac release

Ops folder: `~/Library/Caches/PongLens/cut-again-phase2-20260925/`.

| Check | Result |
| --- | --- |
| Build tree | Clean detached worktree `.worktrees/phase2-release` at `9e21c10e` |
| Runtime inputs | `inspect-local.json` byte-identical to hand release 4's; every runtime anchor, `behavior_env` and body model equal to live `a8b08902`'s manifest |
| Manifest vs `a8b08902` | adapters, behavior_env, body_model, database, runtime, schema identical; files differ only in `worker/` (hand-cut and Phase 2 source and tests); models and `bin/` identical |
| Manifest vs hand `1af85388` | Only `worker/worker.py`, `email_templates.py`, `tests/test_auto_recut.py`, `tests/test_email_templates.py`, `tests/test_match_reprocess.py` |
| `test_match_release` | 30 tests, OK |
| Worker suite from the tree root | 1,315 tests, 18 errors, the same 18 as release 4 (`suite-errors.txt`) |
| Sealed smoke, `prabhas-diag/clip24.mp4` | imports, native, pose (CoreML), table (ok, 16 of 16 frames), ball, parity (17 passed), side changes twice: all exit 0, every result identical to release 4's |
| Staged and re-verified; check-only main and fast | Pass; no bytecode inside the staged release |

### Linux twin

| Check | Result |
| --- | --- |
| Requirements lists | Not changed: the Mac runtime is identical to `a8b08902`'s |
| Probe (`modal run modal_app.py`) | Release verified, `pipeline_id` recomputes, `mac_release_id` = `69915d26…`, Tesla T4 visible, FFmpeg n8.1.2, BlurBall on CUDA |
| Deploy, register | No image rebuild at deploy; `cloud_mac_release_id` = `69915d26…`; after the switch the dispatcher reads `release_match = true`, reason `disabled` |

### Shadow replays of the candidate path

The runbook's `shadow.py` replays an upload with its own job options, which
cannot run a candidate. `shadow_candidate.py` (ops folder) is that script fed
the options a claim writes, with the worker's own
`processing_pipeline_settings` and candidate step order; it publishes
nothing (outputs under `parity/7488bb14…/<label>/`). The cloud side ran it as
an ephemeral app on the deployed image plus that one file
(`cloud/shadow_candidate_app.py`). Footage: upload `7488bb14…` (match
`ce466d23…`, 234 s, 4K 60 fps, keypoint table, published with the body
assembler). Modal: $1.74 for the two cloud replays and $0.28 for the probe; the month stands at $30.90 of the $42.50 cap.

| Replay | What it is | Body assembler | Mac vs twin |
| --- | --- | --- | --- |
| A | A player's automatic Replace, trimmed 20.0 to 220.0 s | Ran on both ("15 cards replace 17 ball cards"), `pipeline: bodies` | 15 Mac points all matched, 1 extra on the cloud; 6/15 boundaries within 0.35 s; 12/15 same winner, 11/15 same reason; cut segments 11 vs 12; table corners within 1 px; ball presence agrees on 97.5% of frames, median 0.4 px; identical crop box |
| B | A support reprocess, 130.0 s to the end | Ran on both ("8 cards replace 12 ball cards") | 8 Mac points all matched, 1 extra on the cloud (one rally split in two); 6/8 within 0.35 s; 8/8 same winner, 7/8 same reason; corners within 3 px; ball presence 97.6% |
| C (Mac only) | A support reprocess of the whole window, against what production published for that upload | Ran | Exact: 15/15 points, 0.00 s on every boundary, 15/15 winner and reason, 12/12 cut segments, corners 0 px |

Accepted T4 tolerance (cloud-twin RELEASE.md): about 3% of ball detections
differ, roughly half the boundaries move more than 0.35 s, about one winner
in five changes. Over A and B together: 11 of 23 boundaries moved, 20 of 23
winners agree, 2.4 to 2.5% of frames differ on ball presence. C shows the
candidate path on the Mac is the upload path, byte for byte in its decisions.

### Activation (`activate.sh`, log `activation.log`)

| Step | UTC |
| --- | --- |
| Idle check: nothing queued or running on `jobs`/`jobs_fast` | 18:28:26 |
| Old main and fast drained (`drain-main`, `drain-fast` in `a8b08902`'s state; they stay for rollback) | 18:28:37 |
| Launchers backed up to `launcher-backup/`, new state pre-drained, bootout, plists copied (differ only in the release id), bootstrap (first try each) | 18:28:41 |
| New lanes pulse `69915d26…` drained, then opened | 18:30:21 |
| Verified | Pulses `mac:main`/`mac:fast` exact new id, idle; monitor ran 18:29:58 on the new release; main lane housekeeping ran its new tier ("retired versions older than 30d, 0 version(s), 0 object(s) removed"); no new errors; hand lane same process, same release |

### Rollback

| Situation | Do this |
| --- | --- |
| The worker misbehaves | `~/Library/Caches/PongLens/cut-again-phase2-20260925/rollback-mac.sh`: drains `69915d26…`, boots out main, fast and monitor, restores the backed-up plists, bootstraps, lifts `a8b08902…`'s drain files. Pulses return to `a8b08902…`. Works with the migration left in place |
| The twin after a Mac rollback | Cloud stays off with `release_mismatch` (it is Off anyway). To pair it again: in `.worktrees/cloud-twin/worker/cloud_release`, `PONGLENS_CLOUD_SOURCE_RELEASE=".../match-releases/a8b089021d264ef68c90d42735b1f128dd3a254aee8e0f5e65d257137cf516c9"`, `modal deploy modal_app.py`, then `modal run modal_app.py --command register` |
| The database | Switch `recut_auto_replace` off first, then run `rollback-20260925170532.sql` (this folder, one transaction). The new worker tolerates it: its re-cut sweep is silent without the functions, and `media_swept_at` stays |

## Email fix release (2026-09-26): every lane on one release again

Main, fast, the health monitor and the hand lane now all run sealed release
`ab887b32…` from `93857d5e`, whose only change is the email recipient count
that made every worker email fail after Resend had accepted it. The Linux twin
`108528fd…` is built and probed but not deployed, because Modal disabled the
workspace mid-release when the month's $30 credit ran out, and Adil approved
switching the Mac first as a recorded exception. The $400 cost alert went out
once, the $300 alert is marked sent without a new copy, and the retry loop has
stopped.

### What moved

| Piece | Before | After |
| --- | --- | --- |
| Main, fast, health monitor | `69915d2650f7…` (source `9e21c10e`) | `ab887b32c11f415248553ff825a70b02eba463147a6c57950968304f3aae97f7` (source `93857d5e`), opened 2026-09-26 13:54:14 UTC |
| Hand lane | `1af85388c9f9…` (source `7cede901`) | The same `ab887b32…`; it also gains main/fast's `acfaa94a` (automatic Replace, retired-cut sweep; the sweep runs on the main lane only) |
| Cloud twin | `44611008…`, paired with `69915d26` | Unchanged. `108528fd3b8a85c17dca2a6b680ca29187a222589c663a212019b44f70e1c98d`, pipeline `43daa62396471d663204ff6c48c8bbcd078d6d28f538a94a29ccac31b5d3b5a1`, is built and probed, not deployed or registered |
| `cloud_mode`, database, web, iOS | | Unchanged (`disabled`; no migration) |

### The fix

| | |
| --- | --- |
| Defect | `send_email_payload` counted recipients with `bcc_list`, a name that exists only in `send_email`. The NameError came after Resend accepted the message, so each worker email was delivered but recorded as failed |
| Effect since 2026-09-19 | The $300 cost alert was retried about once a minute (10,339 claims) and, as Resend forgets an idempotency key after 24 hours, reached the admin once a day (19 to 26 Sep, eight copies). The $400 alert was never claimed, because each failed $300 attempt ends the run |
| Change | `recipients=1 + len(payload.get("bcc") or [])`, plus `worker/tests/test_send_email_payload.py` |

### The exception to the release order

| Question | Answer |
| --- | --- |
| The rule | Deploy and register the twin before activating the Mac release (cloud-twin README, "Packaging a new release for the cloud") |
| What happened | The twin built and probed; the shadow replay of upload `fcb21bbc` stopped during ball detection with "workspace … is disabled" at about 13:36 UTC. Modal billing: $30.14 metered this month against a $30.00 credit, $0.07 billed. This release spent $0.27 (build and probe) and $0.19 (partial replay). The deployed dispatcher has made no decision since 13:41:39 UTC |
| Decision | Adil approved (relayed by the coordinating session, 2026-09-26) switching all four Mac launchers first and pairing the twin after he re-enables Modal |
| Why it is safe | The dispatcher only starts a cloud worker when the registered twin's `cloud_mac_release_id` equals the Mac's pulse. It is now `69915d26…` against `ab887b32…`, so `release_match` is false: the cloud reports `disabled` while Off and would report `release_mismatch` on Standby or Run once, until `108528fd` is deployed and registered. The pipeline is unchanged (the diff is one metering line), so nothing about a match differs between the two |

### Checks on the Mac release

Ops folder: `~/Library/Caches/PongLens/email-fix-20260926/` (README.txt there lists every file).

| Check | Result |
| --- | --- |
| Build tree | Clean detached worktree `.worktrees/email-fix-release` at `93857d5e` |
| Runtime inputs | `inspect-local.json` byte-identical to Phase 2's |
| Manifest vs live `69915d26` | adapters, behavior_env, body_model, database, runtime, schema identical; files: `worker/worker.py` changed, `worker/tests/test_send_email_payload.py` added; models and `bin/` identical |
| Manifest vs hand `1af85388` | The above plus Phase 2's `email_templates.py`, `tests/test_auto_recut.py`, `tests/test_email_templates.py`, `tests/test_match_reprocess.py` |
| `test_match_release`, `test_send_email_payload` | 30 OK, 2 OK |
| Worker suite from the tree root | 1,303 tests, 24 errors: the same 18 as Phase 2, plus 6 in `test_queue_estimates_db` and `test_lesson_cloud_fallback_db`, which need the local Supabase in Docker (ports 54322/55322 time out; Docker Desktop's API returns 500). The live source `9e21c10e` fails the same 6 identically today |
| Sealed smoke, `prabhas-diag/clip24.mp4` | imports, native, pose, table (16 of 16), ball, parity (17 passed), side changes twice: all exit 0, every result identical to `69915d26`'s apart from timings |
| Staged and re-verified; check-only main, fast and hand | Pass; no bytecode inside the staged release |
| Launchers | Four new plists, each differing from the live one only in the release id |

### Linux twin (built, not live)

| Check | Result |
| --- | --- |
| Requirements lists | Not changed: the Mac runtime is identical |
| Probe (`modal run modal_app.py`) | Release verified, `pipeline_id` recomputes, `mac_release_id` = `ab887b32…`, Tesla T4, FFmpeg n8.1.2, BlurBall on CUDA 76 of 600 frames (as `44611008`'s probe) |
| Shadow replay | Not completed (workspace disabled). No parity numbers exist for this twin |

### Activation (`activate.sh`, log `activation.log`)

| Step | UTC |
| --- | --- |
| Idle check: nothing queued or running on `jobs`, `jobs_fast` or `jobs_hand`; no pulse holding a job | 13:52:24 |
| Old main, fast (`69915d26`) and hand (`1af85388`) drained; their drain files stay for rollback | 13:52:35 |
| Four launchers backed up to `launcher-backup/`, new state pre-drained, bootout, plists copied, bootstrap (first try each) | 13:52:39 |
| New lanes pulse `ab887b32…` drained, then opened | 13:54:14 |
| Verified | `mac:main`, `mac:fast`, `mac:hand` pulse the full new id, idle; the monitor ran on the new release at 13:53:49; main-lane housekeeping and cost reconciliation ran without errors |

### What the fix sent

Read from Resend's own log (`resend-recent.txt`) and the database (`email-state-*.txt`).

| Email | Outcome |
| --- | --- |
| $300 alert | Row `sent` at 13:53:58 (attempt 10,339). No new copy: Resend returned the copy of 2026-09-26 00:04:39 UTC, still inside its 24-hour key window |
| $400 alert | Sent once at 13:54:01, delivered; row `sent` at attempt 1 |
| "cost alert delivery failed" | None on the new release. The previous release logged 1,104 of them between 25 Sep 18:30 and 13:52:05 UTC today (and `a8b08902` 3,732 before that) |
| Ready email for upload `1f5be46c` (Adil's own 25 Sep match) | Delivered on the first try, 2026-09-25 21:18:14 UTC (Resend `01a0da6e…`); the NameError only recorded it as failed. Every retry since has been refused by Resend (stored as `RuntimeError`, which the worker raises when Resend answers with an error; the text is not kept), including the first retry on this release at 14:35:18 (attempt 22). The fix does not change that path and nothing was re-sent. The row stops by itself after attempt 24 (about 16:35 UTC) and is marked expired. Worth a separate look: a durable ready-email retry appears never to succeed |
| Processing-incident alerts | Nothing waiting; unchanged |

### Rollback

| Situation | Do this |
| --- | --- |
| The worker misbehaves | `~/Library/Caches/PongLens/email-fix-20260926/rollback-mac.sh`: drains `ab887b32…`, boots out all four, restores the backed-up plists, bootstraps, lifts the old drain files. Main, fast and monitor return to `69915d26…`, hand to `1af85388…`, and the email bug returns with them |
| The twin | Nothing to undo: `44611008` is still registered and matches `69915d26` again after a rollback |

### Still to do: pair the twin once Modal is re-enabled

Superseded the same day by the audit worker release below: the Mac moved on to `93a881aa…`, so the twin to pair is one built from that release, not `108528fd`.

In `.worktrees/cloud-twin/worker/cloud_release`, with `MODAL_PROFILE=adilharis2001` and
`PONGLENS_CLOUD_SOURCE_RELEASE="/Users/adil/Library/Application Support/PongLens/match-releases/ab887b32c11f415248553ff825a70b02eba463147a6c57950968304f3aae97f7"`:

| # | Step | Pass when |
| --- | --- | --- |
| 1 | `modal run modal_app.py --command shadow --job-id fcb21bbc-e6e3-4395-86d8-cf9d1825ff98` (61 s upload, no table, about $0.30) | Exits 0 |
| 2 | `python -B compare_parity.py --job-id fcb21bbc-e6e3-4395-86d8-cf9d1825ff98 --label modal-108528fd` (copy in the ops folder) | Within the accepted T4 tolerance; `44611008` gave 7 of 8 points matched, 7/7 same winner and reason on this upload |
| 3 | `modal deploy modal_app.py`, then `modal run modal_app.py --command register` | `cloud_mac_release_id` = `ab887b32…`; the dispatcher reads `release_match = true` |

The build reuses the cached image unless the staged release changed, so no rebuild is expected. `cloud_mode` stays Off throughout.

## Audit worker release (2026-09-26): silent on deleted matches, hand cuts keep their table

Main, fast, the health monitor and the hand lane now run sealed release
`93a881aa…` from `7d0279fa`, which adds the audit's worker fixes C and D
(`dc3ccd4a`) to the email fix release. A hand Replace or Keep copy now
reuses the table an earlier cut of the same upload already found: re-run for
real on 636f3f37, it went from 0 mapped serves to 44 of 50 with the replaced
cut's own table and no new detection. The cloud twin stays unpaired until
Modal is re-enabled, under the same recorded exception as the email fix.

### What moved

| Piece | Before | After |
| --- | --- | --- |
| Main, fast, health monitor, hand | `ab887b32…` (source `93857d5e`) | `93a881aafe06dfa06604dda262d52773fa0dd48b5d1d09e20cb3341423b06298` (source `7d0279fa`), opened 2026-09-26 15:02:34 UTC |
| Worker source | | `git diff 93857d5e 7d0279fa -- worker` is exactly `dc3ccd4a` (FIX-PLAN C, worker half, and D) |
| Cloud twin, `cloud_mode` | `44611008…` registered, paired with `69915d26`; Off | Unchanged. `108528fd` (built for `ab887b32`) is now out of date as well |
| 636f3f37 serve map | `retry_available`, 0 mapped, `keypoint_calibration_declined` | `ready`, 44 of 50 points mapped (owner's Try again, 15:03:16 UTC) |

### Checks on the Mac release

Ops folder: `~/Library/Caches/PongLens/audit-worker-20260926/`.

| Check | Result |
| --- | --- |
| Build tree | Clean detached worktree `.worktrees/audit-worker-release` at `7d0279fa` |
| Runtime inputs | `inspect-local.json` byte-identical to the email fix release's |
| Manifest vs live `ab887b32` | adapters, behavior_env, body_model, database, runtime, schema identical; files: `worker.py`, `hand_cut_analysis.py`, `placement_retry_calibration.py` and five test files changed, `tests/fixtures/prior-table-636f3f37.json` added; models and `bin/` identical |
| `test_match_release` | 30 OK |
| The changed test files (hand-cut analysis, retry calibration, failure emails, hand recut, auto recut, email payload) | 179 OK |
| Worker suite from the tree root | 1,354 tests, exactly the 18 known errors (Docker was back, so the six database tests passed) |
| Sealed smoke, `prabhas-diag/clip24.mp4` | All eight modes exit 0; every output identical to `ab887b32`'s once timings are masked |
| Staged and re-verified; check-only main, fast and hand | Pass; no bytecode inside the staged release |
| Launchers | Four new plists, each differing from the live one only in the release id |

### Shadow proof on the Mac (the twin could not replay)

`shadow_placement.py` runs the staged release's own `placement_for_match`
inside the sealed environment (launched like the hand plist), with a
read-only database connection, every R2 upload captured locally, metering
captured, and the lifecycle, points and `match.json` writes captured instead
of made. The match row is presented as the app's request would leave it;
only the authorisation fields change.

| Run | Release | What happened | Result |
| --- | --- | --- | --- |
| 636f3f37, hand version `19bf2994`, the Try again attempt, table detection forbidden | `93a881aa` | Log: "reusing the saved hand-cut tracking (50 windows)", then "reusing the vision table of replaced 8bdf5aad (same upload, 1920x1080)". No table detection, no ball detection | `ready`, 44 of 50 mapped; corners and length axis identical to `8bdf5aad`'s; 62 s |
| 4923bbef, a hand cut with no earlier cut and never analysed, the Generate attempt | `93a881aa` | No reuse; ball tracked and the keypoint table detected as before | `ready`, 9 of 9 mapped |
| The same, on the live release | `ab887b32` | The same | Output `match.json` byte-identical to the new release's; the tracking bundle differs only in its header timestamp |

The first 636f3f37 run stopped at the commit step on a harness fault (its
read-only connection was not in autocommit, as the worker's is); fixed and
re-run, log kept as `shadow-new-636f-stronger-attempt1-harness-autocommit.log`.

### Activation (`activate.sh`, log `activation.log`)

| Step | UTC |
| --- | --- |
| Idle check: nothing queued or running on `jobs`, `jobs_fast`, `jobs_hand` | 14:59:57 |
| All four drained on `ab887b32` (its drain files stay for rollback) | 15:00:18 |
| Launchers backed up, bootout, plists copied, bootstrap (first try each) | 15:00:22 |
| New lanes pulse `93a881aa…` drained, then opened | 15:02:34 |
| Verified | `mac:main`, `mac:fast`, `mac:hand` pulse the full new id, idle; monitor ran on the new release at 15:02:10; main-lane housekeeping ran; no warnings or errors in any lane log |

### The real re-run on 636f3f37

| Step | Result |
| --- | --- |
| Owner | `e84a6675`, `aber97@gmail.com`, one of the two admin addresses in `is_admin()` |
| Request | `public.request_placement_retry` as the owner, exactly what `/api/placement-retry` calls (`request_retry_636f.py`); job `b93169c8…`, `placement_retry` on `jobs_hand`, 15:03:16 |
| Hand lane log | "reusing the saved hand-cut tracking (50 windows)", "reusing the vision table of replaced 8bdf5aad (same upload, 1920x1080)", "placement retry done: … succeeded=True mapped=44", 15:04:47 |
| After | `placement_status` `ready`, 44 mapped, retry used; all 50 points carry placement; published corners and every point's placement identical to the shadow's; no OpenAI call |

### Rollback

| Situation | Do this |
| --- | --- |
| The worker misbehaves | `~/Library/Caches/PongLens/audit-worker-20260926/rollback-mac.sh`: drains `93a881aa…`, boots out all four, restores the backed-up plists, bootstraps, lifts `ab887b32…`'s drain files. All four return to `ab887b32…` (the email fix stays) |
| 636f3f37's new map | Nothing to undo: the map is the replaced cut's own table and a normal placement run |

### Still to do: pair a twin once Modal is re-enabled

Same order exception as the email fix release, approved by Adil for this
release too (relayed by the coordinating session). The dispatcher cannot
start the cloud: the registered twin is paired with `69915d26` and the Mac
reports `93a881aa`, so `release_match` is false (reason `disabled` while Off,
`release_mismatch` on Standby). When Modal is back, in
`.worktrees/cloud-twin/worker/cloud_release` with `MODAL_PROFILE=adilharis2001` and
`PONGLENS_CLOUD_SOURCE_RELEASE="/Users/adil/Library/Application Support/PongLens/match-releases/93a881aafe06dfa06604dda262d52773fa0dd48b5d1d09e20cb3341423b06298"`:
`modal run modal_app.py` (build and probe), `modal run modal_app.py --command shadow --job-id fcb21bbc-e6e3-4395-86d8-cf9d1825ff98`, compare with
`compare_parity.py --label modal-<new twin id prefix>`, then `modal deploy modal_app.py` and `modal run modal_app.py --command register`.
`cloud_mode` stays Off throughout.

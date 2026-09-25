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

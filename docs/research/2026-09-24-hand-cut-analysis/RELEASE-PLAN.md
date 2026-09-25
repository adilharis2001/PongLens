# Hand-cut analysis: release plan (hand lane only)

Detailed analysis and highlights for hand-cut matches need one new sealed
release on the Mac's hand-cut lane, then migration `20260925025504`, then the
web deploy, in that order. Main, fast, the health monitor and the cloud twin
keep their current releases and are not touched. Nothing below has been
executed; every step is for the owner to run or approve.

## What moves and what does not

| Piece | Today (2026-09-24) | After |
| --- | --- | --- |
| Hand lane (`com.adil.ponglens-worker-hand`) | `18c66c589723…` from source `762ea2c0` | New release built from `codex/hc-worker` (worker code = main's `f78a93f7` plus this work) |
| Main and fast lanes, health monitor | `a8b089021d26…` from `f78a93f7` | Unchanged |
| Cloud twin (Modal) | `bb39d41fce2d…`, paired with `a8b08902` | Unchanged. It never reads `jobs_hand`, and `cloud_worker_decision` no longer counts anything routed there |
| Database | Hand cuts refused by both placement requests; all placement and reels go to `jobs` | `20260925025504_hand_cut_analysis.sql`: refusals gone, hand-cut placement and highlights reel go to `jobs_hand` |
| Web | Highlights route refuses hand cuts | Refusals removed; end rule knows the hand-cut pad |

The worker source the new hand release carries: `git diff f78a93f7 <commit> -- worker`
is only this work (`worker/` at the branch base `db8b56a0` is byte-identical
to `f78a93f7`). Compared with the live hand release it also brings the six
worker commits main already runs (`762ea2c0..f78a93f7`: table crop ladder,
starred-selection reels, admin serve attribution), none of which touch the
hand-cut job.

## Why the order matters

| If this ran first | What would happen |
| --- | --- |
| Migration before the hand release | Hand-cut placement jobs reach the old hand worker, which still refuses hand cuts and finishes each one as `final_failed`, spending the owner's only attempt |
| Web before the migration | A hand-cut highlights request goes to the main lane, whose old code skips the evidence refresh for hand cuts; the reel comes back empty |

## Steps

Ops files go in `~/Library/Caches/PongLens/hand-cut-analysis-<date>/`
(`OPS` below), never `/private/tmp`. `PY` is
`/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python`. Every Python
that touches a staged or live release runs with `-B`.

| # | Step | Command or check | Pass when |
| --- | --- | --- | --- |
| 1 | Build tree | A clean worktree at the release commit (the branch head after review, or its merge into `main`), no uncommitted files | `git status` clean |
| 2 | Inspect the runtime | `$PY -B -m worker.match_release inspect-local --repo <tree> --output $OPS/inspect-local.json` | Runtime anchors equal the live hand manifest's (`18c66c58…/manifest.json`); diff them as in `brew-rebuild-20260922` |
| 3 | Build and verify | `build --repo <tree> --commit <sha> --config $OPS/inspect-local.json --output $OPS/packages`, then `verify <dir> --expected-id <id>` | New id printed; manifest `adapters.blurball_original_sha256` is `cb2e1af4…` (the wrapper `blurball_windowed.py` pins) |
| 4 | Compare manifests | New manifest against `a8b08902…` | Runtime, models, `behavior_env`, body model identical; `files` differ only in `worker/` source |
| 5 | Unit tests | `$PY -B -m unittest worker.tests.test_match_release`, then the worker suite from the tree root: `$PY -B -m unittest discover -s worker/tests -t . -p 'test_*.py'` | Release tests pass; suite shows the 18 errors that predate this work and no others (1,195 tests at `5000c725`) |
| 6 | Offline smoke | `~/Library/Caches/PongLens/brew-rebuild-20260922/run_checks.sh` pattern against the new package: modes `imports native pose table ball parity side-changes` and `side-changes` again on the same state, video `prabhas-diag/clip24.mp4` | Every mode exits 0 |
| 7 | Windowed tracking on the sealed package | With `prepare_run(<release>, <state>, 'hand')`'s environment: `$PONGLENS_PIPELINE_PY -B <release>/worker/blurball_windowed.py --video <hand-cut original> --out win.jsonl --windows windows.json` and `$PONGLENS_PIPELINE_PY -B $PONGLENS_BLURBALL_INFER --video <same> --out full.jsonl`; then `windowed_equality.py full.jsonl win.jsonl` (this folder) | Exit 0: zero differing lines inside the windows. Use a real hand-cut original (04f1b393's, 236 s, is what was measured) |
| 8 | Placement dry run | `<release>/worker/placement_backfill.py reconstruct … --frame-times win.jsonl.frames.json --clip-pre 1.2` against the same match's points, then again with `full.jsonl` | Both succeed; placements identical |
| 9 | Stage | `$PY -B -m worker.match_release stage <dir> --destination "~/Library/Application Support/PongLens/match-releases"` | Re-verified on copy |
| 10 | Check only | `run <staged> --state ~/Library/Caches/PongLens/match-runtime/<id> --lane hand --check-only` | Prints the worker command with `drain-hand` in the new state directory |
| 11 | Quiet the old hand worker | `touch ~/Library/Caches/PongLens/match-runtime/18c66c58…/drain-hand`; wait for the `mac:hand` pulse to read stage `drained` with no job; `jobs_hand` empty on `/admin/processing` | Old lane idle |
| 12 | Back up and write the launcher | Copy `~/Library/LaunchAgents/com.adil.ponglens-worker-hand.plist` to `$OPS/launcher-backup/`. Write the new one with the same launcher code `macos27-rebuild/make_plists.py` uses, label `com.adil.ponglens-worker-hand`, lane `hand`, new id (that script only writes main, fast and health; do not edit it, copy its `launcher()` into `$OPS/make_hand_plist.py`) | New plist differs from the backup only in the release id |
| 13 | Switch | `touch <new state>/drain-hand`; `launchctl bootout gui/$(id -u)/com.adil.ponglens-worker-hand`; copy the new plist in; `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.adil.ponglens-worker-hand.plist` | `mac:hand` pulses the new id, stage `drained`, within a minute |
| 14 | Open the lane | Remove `<new state>/drain-hand` | Pulse idle on the new id. Main and fast pulses unchanged (`a8b08902`) |
| 15 | Apply the migration | `supabase/migrations/20260925025504_hand_cut_analysis.sql` | Read-only checks: `select public.job_queue_name('placement_generate', jsonb_build_object('match_id','04f1b393-f16f-4242-9f51-a853a276bae8'))` is `jobs_hand`; the same for an automatic match is `jobs`; `select public.cloud_worker_decision(false)` returns the same `reason` as before |
| 16 | Deploy the web | Merge to `main`; Vercel deploys | Highlights GET on a hand cut no longer answers `unavailable` |
| 17 | First real job | On a practice hand cut (04f1b393), request detailed analysis | Hand row on `/admin/processing` shows "Detailed analysis", then "Finding the ball"; placement ready; `hand-tracking.jsonl.gz` beside its `match.json` |
| 18 | First highlights | On a scored hand cut past 75% (623c09c6 or 7ba06eb1), generate highlights after its detailed analysis | Hand-lane log says "reusing the saved hand-cut tracking"; reel renders; each rally ends at the rally's end, not 1.2 s early |

The ready email change (no "Score it" for a hand cut scored while marking)
reaches players with step 14, because the hand lane is the one that sends it.

## Rollback

| Situation | Do this |
| --- | --- |
| Checks fail before step 13 | Nothing is live. Discard the package |
| New hand worker misbehaves, migration not applied | `touch <new state>/drain-hand`, wait for `drained`, `bootout`, restore the backed-up plist, `bootstrap`, remove the old state's `drain-hand`. The pulse returns to `18c66c58…` |
| After the migration | Database first, so no new hand-cut analysis job is created: run `rollback-20260924210000.sql` (this folder; the live definitions from 2026-09-24, one transaction). Let the hand lane finish or cancel anything already in `jobs_hand` (`select kind, status from jobs where status in ('queued','processing') and job_queue_name(kind, options) = 'jobs_hand'` before the rollback). Then roll the lane back as above. The web deploy can stay: without the migration a hand-cut request is refused by the database again |
| Cloud twin | No action in any case; it never ran any of this |

`18c66c58…` stays staged and runnable throughout; do not remove it until the
new release has run real hand-cut jobs. The runnable main/fast rollback
(`a30742f6…`) is unaffected.

## Measured before release (2026-09-24)

| Check | Result |
| --- | --- |
| Windowed tracking vs full run, real hand-cut original 04f1b393 (7,084 frames, clip windows of all 20 points) | 4,630 frames inside the windows, 0 differing lines; warm-up frames also identical; one pass; frame times identical to a separate decode |
| Same video, 30 short windows with warm-ups forced down to 0.05 s then 0.5 s | 1,800 in-window frames, 0 differing, through three passes (the later-pass plan and the last resort both exercised) |
| Placement on 04f1b393 with the hand-cut path | 20 of 20 points drawable; identical whether fed the windowed or the full-video tracking |
| Share of frames the model runs on, the eight live hand cuts | The four matches 59 to 77%; the practice and untyped clips 6 to 73% (3 s warm-up included). Decoding every frame costs about 6% of a full run. Less saving than the spec's "roughly halves" on dense matches |
| Variable frame rate, 62 recent originals (46 distinct videos) | 8 drift more than one frame from seconds x rate, 3 by more than 0.5 s; all 8 hand-cut originals within 2 ms. Method and rows: `measure_vfr.py`, `vfr-2026-09-24.json` |

## Rolled out (2026-09-25, about 02:55 UTC)

| Step | Result |
| --- | --- |
| 1 to 10 | Release `8d11ea7ee075a24375d6b31805120041d9272c9081954c40a770f8c5842948f3` built from `88092c90`, verified, smoke and windowed-equality checks passed (0 differing lines in 4,630 in-window frames on 04f1b393), staged |
| 11 to 14 | Old hand lane drained, launcher backed up in `~/Library/Caches/PongLens/hand-cut-analysis-2026-09-24/launcher-backup/`, switched (the first `launchctl bootstrap` returned error 5 while the old service was still tearing down; the retry eight seconds later succeeded), `mac:hand` pulses the new id idle. Main and fast still `a8b08902`. The old state keeps its `drain-hand` file; remove it only for a rollback |
| 15 | Applied through the Supabase MCP as versions `20260925025504` (`hand_cut_analysis`) and `20260925025508` (`recordings_to_photos`); the files carry those versions. Before applying, the live definitions were diffed against the file: only the two hand-cut refusals and the cloud decision's two filters change. Checks: hand-cut placement and highlights reel route to `jobs_hand`, automatic placement and uploads to `jobs`, reclips to `jobs_fast`; `authenticated` cannot execute `job_queue_name`; the cloud switch was `disabled` throughout |
| First jobs on 8d11ea7e | Detailed analysis on 04f1b393 (20/20 points placed, 4.5 min) and 623c09c6 (55/55, 29 min) worked. The first hand-cut highlights job failed: point times arrive from psycopg2 as Decimal and the clip-window code counted only int/float, so it found "no marked points"; behind that, the original was downloaded to a str where a Path is needed, and the points pipeline ran without `--cut-mode plays`, the only mode v2 and its evidence dump run in, so every point read "no matching diagnostic card" |

## Release 2 (2026-09-25, about 04:20 UTC)

`8a2eb607eb9dbdcd0d32644a5decbf10aaf4f92c89bee59885c0f0afdc417403`, source `c32afb55`: the three hand-cut highlight fixes, nothing else (manifest identical to `8d11ea7e` apart from `hand_cut_analysis.py`, `highlight_backfill.py` and tests). Steps 1 to 10 passed as before, plus 10b: the highlights path run inside the sealed package on 623c09c6 reused the saved tracking (no BlurBall), gave 48 of 55 points ready evidence (7 no observed rally end) and selected 11 rallies, the same as the local replay. Switched the same way (backup in `release2/launcher-backup/`; bootstrap succeeded first try after an 8 s wait). `8d11ea7e`'s state keeps its `drain-hand` file for rollback.

## Release 3 (2026-09-25)

`20d1aaa79c7781d660ccb61353795bfeeb1ddad1a5a7f1cb1a27ab3c9f2189df`, source `b7589b3c`: the Mac hand cut publishes on the cut's measured clock (docs/research/2026-09-25-hand-cut-clock), the check-and-publish branch for a cut made on the iPhone (docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md), and the ten-minute sweep that hands back a phone cut silent for 72 hours. Database half applied earlier as `20260925061009`. Steps 1 to 10 passed, plus 10b (a phone-made cut of 04f1b393 through the sealed checker: all checks pass, positions exact, six tampered copies refused) and 10c (the sealed Mac hand cut of 04f1b393 publishes the measured offsets, byte-identical cut). Switched as before (backup in `release3/launcher-backup/`); `8a2eb607`'s state keeps its `drain-hand` for rollback. No sweep failures after opening.

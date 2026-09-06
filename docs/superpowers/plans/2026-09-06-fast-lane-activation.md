# Switching the fast lane on

**2026-09-06.** The fast lane was designed in
`docs/superpowers/specs/2026-09-06-instant-clip-edits-design.md` (§8, "Step
3") and built the same day: migration `20260906174730_fast_lane`, the
`--lane fast` flag in `worker/worker.py`, the launchd unit
`worker/com.adil.ponglens-worker-fast.plist`, and the runbook in
`worker/README.md` ("Fast lane"). It shipped switched off on purpose —
`app_config.reclip_lane = 'main'` — because routing work into a queue with
no process reading it is worse than no queue. This is the plan for the
second half: starting the process and flipping the switch, on the machine
as it actually is.

**Status: live, 2026-09-06 21:53 UTC.** See "What actually happened" at the bottom.

## What was found before starting

Three things the runbook could not know, all measured on the day.

1. **The feature had never reached the Mac.** The worker runs
   `/Users/adil/Desktop/Projects/PongLens/worker/worker.py` from the
   working tree of a checkout 361 commits behind `origin/main`. That file
   contained zero occurrences of `lane`. `pgmq.metrics_all()` showed
   `jobs_fast` with `total_messages = 0`: it had never carried a job.
2. **That checkout cannot be bulk-updated.** Its `worker.py` carried ~368
   uncommitted lines of another session's automatic-highlights work
   (`render_auto_highlights`, `prepare_auto_highlights`, an untracked
   `worker/highlights.py`), saved 23:31 on the 5th and running in
   production from the 23:32 restart. Pulling the folder forward would
   have deleted a live, unfinished feature. So the lane code is copied
   into that file **additively and verbatim from `origin/main`** — the
   same way the status pulse was added earlier in the day — so the
   eventual merge is textually clean.
3. **A release-based launch layout is staged but not active.** The
   installed `~/Library/LaunchAgents/com.adil.ponglens-worker.plist`
   (modified Sep 5 16:29) points at
   `~/Library/Application Support/PongLensWorker/current/run-worker`, a
   sealed pipeline release (`d504314f…`, source commit `030adef9`) from
   the Modal parity work. The **loaded** job still runs the Desktop app —
   `launchctl print` says so, and `kickstart -k` does not re-read a plist.
   That release's `worker.py` has no lane support, no status pulse and
   none of the highlights work, so the fast lane does not run from it,
   and a reboot would switch the main worker onto it silently. Flagged
   to Adil; not resolved here, because it is someone else's in-flight
   migration.

Also: the runbook's `osacompile` command used `/usr/bin/python3` with no
`venv` and no `cd`. System Python has no `psycopg2`; a runner built from
it would crash-loop every 30 seconds. Corrected in the README to mirror
the main runner's script exactly.

## Decision

Run the fast lane from the Desktop checkout through its own AppleScript
wrapper, exactly as the main lane runs today. Not from the staged
release (frozen code without the pulse), and not by updating the checkout
(destroys live work). When the release-layout migration lands, the fast
lane needs the same treatment as main — a `run-worker --lane fast` unit —
and that is recorded under follow-ups.

## Steps, in order

The order is the whole safety argument: a worker must be visibly running
before any work is routed to it.

**Mine, first**

1. Back up the live `worker.py`. Patch in, verbatim from `origin/main`:
   the `LANE` / `QUEUE_NAME` / `LOG_PATH` derivation before logging is
   configured; `read_message` and `archive_message` reading `QUEUE_NAME`
   instead of the literal `'jobs'`; the `housekeeping = LANE == "main"`
   gate in `main()` around the cost monitor, the retention sweep and the
   digests; and drop the `LANE = "main"` pin the pulse patch had used.
2. Verify: `py_compile`; a diff against the pre-pulse backup listing
   every removed line, to prove none of them is highlights code; the
   highlights symbols still counted; an import of the module with no
   arguments, with `--lane fast`, and with `WORKER_LANE=fast`, printing
   `LANE`, `QUEUE_NAME`, `LOG_PATH` and `WORKER_ID`.
3. Restart the main worker onto the patched file **while the queue is
   empty** (`pgmq.metrics_all()` and no `processing` rows), so the file
   is proven in production for the main lane before a second process is
   built on it. Confirm the startup line reads `lane=main queue=jobs` and
   the pulse continues.
4. Build `~/Applications/PongLensWorkerFast.app` with the corrected
   command; install the plist to `~/Library/LaunchAgents/` and into the
   checkout's `worker/`. **Do not load it yet** — without Full Disk
   Access it cannot read `~/Desktop` and would crash-loop.

**Adil's, one step**

5. System Settings → Privacy & Security → Full Disk Access → **+** →
   `⇧⌘G` → `~/Applications` (the one in the home folder) →
   `PongLensWorkerFast` → toggle on.

**Mine, last**

6. `launchctl load ~/Library/LaunchAgents/com.adil.ponglens-worker-fast.plist`.
   Check `launchctl print gui/$(id -u)/com.adil.ponglens-worker-fast`
   for a pid, `worker/worker-fast.log` for `lane=fast queue=jobs_fast`,
   and `worker_pulse` for a `mac:fast` row beating every 15s.
7. Confirm **https://www.ponglens.com/admin/processing** shows
   `Mac Studio · fast lane` as Idle. That row is the proof the grant
   worked and the process is alive; nothing is routed until it is there.
8. `update public.app_config set value = 'fast' where key = 'reclip_lane'`.
9. End-to-end: one clip update from the app. Expect the job to appear in
   `jobs_fast` (page: Queue section), the fast lane row to go Working,
   and the job to finish without the main lane touching it.

## Rollback

`update public.app_config set value = 'main' where key = 'reclip_lane'`
— one statement, no restart, takes effect on the next enqueue. Anything
already in `jobs_fast` is drained by the fast process, so stop that one
last, if at all. The pre-patch `worker.py` backups are in the session
scratchpad.

## Follow-ups

- **The release-layout migration must carry the fast lane.** When
  `current/run-worker` becomes the real launcher, the fast lane needs its
  own unit invoking `run-worker --lane fast`, and the release's
  `worker.py` must be built from a commit that includes the lane code,
  the pulse, and the highlights work.

  **Defused 2026-09-06 22:05 UTC, on Adil's instruction ("I just want
  stability").** The installed `~/Library/LaunchAgents/com.adil.ponglens-worker.plist`
  had been rewritten (Sep 5 16:29) to point at the staged release, while
  the loaded job still ran `PongLensWorker.app`; a reboot would have
  rolled main back to a snapshot with no pulse, no lane code and no
  highlights. The on-disk plist was restored to the repo's own
  `worker/com.adil.ponglens-worker.plist`, which matches the loaded job
  field for field (program, log paths). Nothing was reloaded or
  restarted. The rewritten file is kept as
  `com.adil.ponglens-worker.plist.release-experiment-backup` in the
  session scratchpad. The staged release directory and its `current`
  symlink are untouched. **Re-pointing the launcher at a release is now a
  deliberate step for the release work to take, once that release is
  built from current code and carries a fast-lane unit.**
- The fast lane runs at `Nice 0` against main's `Nice 5`, per the unit
  as designed: the person waiting on a re-cut outranks the batch job.
  Watch whether that starves a placement run on a shared, loaded Mac.

## What actually happened

Steps 1–4 went as written. The diff of the live `worker.py` against its
pre-pulse backup removed 13 lines, all of them the queue literals and the
`main()` preamble being replaced; the highlights symbols were untouched;
the import check derived `main`, `fast` (by flag) and `fast` (by
`WORKER_LANE`) correctly. Main restarted on the patched file at 21:47 UTC
with the queue empty: `lane=main queue=jobs`, housekeeping ran, pulse
continued, no errors.

Between step 4 and step 6 another session committed **"Merge main into the
production worker checkout (liveness)"** (`a7155b2c`, 21:45 UTC) — it
committed the highlights work and merged `origin/main` into the Desktop
checkout, then restarted main at 21:48. Because the lane and pulse code
had been copied verbatim, the merge was clean and `git status worker/` is
now empty. Both lanes run committed code on `a7155b2c`. The hand patch
described above was therefore superseded within the hour, exactly as
intended.

Adil granted Full Disk Access (step 5). `launchctl load` reported the
usual `Input/output error` from the legacy command and loaded anyway:
`state = running`, pid 68373; `worker-fast.log` opened with
`lane=fast queue=jobs_fast`, no housekeeping lines, no errors;
`worker_pulse` gained `mac:fast` within seconds; the page showed
`Mac Studio · fast lane — Idle` beside main. `reclip_lane` was set to
`fast` at 21:52 UTC with both lanes' beats under 15 s old.

**Step 9 happened unprompted.** Clip updates from the app: `5c57c980`
and `8f7f67e9` queued 21:49 went to main (pre-switch, 10 s each);
`6781f6fa` and `911e2e0d` queued 21:52:58 and 21:53:06 went to the fast
lane (12 s and 10 s from queued, both `reclip done` in
`worker-fast.log`, absent from `worker.log`). `pgmq.metrics_all()`:
`jobs_fast total_messages = 2`, which had been 0 all day.

Still open after this: the staged release layout (follow-ups above) and
the `Nice 0` question, neither of which this activation changes.

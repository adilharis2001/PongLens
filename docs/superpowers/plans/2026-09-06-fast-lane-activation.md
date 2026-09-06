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

**Status: in progress.** Updated at the bottom as steps land.

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
  the pulse, and the highlights work. Until then the installed main plist
  points at a release that has none of them.
- The fast lane runs at `Nice 0` against main's `Nice 5`, per the unit
  as designed: the person waiting on a re-cut outranks the batch job.
  Watch whether that starves a placement run on a shared, loaded Mac.

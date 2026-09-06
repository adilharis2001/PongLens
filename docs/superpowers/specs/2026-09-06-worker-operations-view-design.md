# Seeing what the workers are doing

**2026-09-06.** Written for Adil's request: a page under Workspaces in the
admin portal showing what the Mac Studio worker is processing right now,
whether it is healthy, when it is busy and when it is idle, with a place
held for the cloud twin. Against `origin/main` at `214621cb`.

**Status: built and live, 2026-09-06.** Migration
`20260906190500_worker_pulse`, page at `/admin/processing`, pulse in
`worker/worker.py`. Four things changed while building it, all of them
because production said so:

1. **A fifth state, `Not reporting`.** Silence WITH a job still marked in
   flight is genuinely ambiguous — the worker died mid-job, or it is
   running code from before the pulse existed — and the page names that
   rather than picking one. It is also the honest state of the Mac worker
   until its next restart, since the daemon loads its checkout at startup.

   **Superseded the same day.** Naming the ambiguity was not enough: shown
   in amber beside a Mac Studio that was cutting dead space at 56 frames a
   second, "Not reporting" read as an outage, and Adil reasonably took it
   for one. Replaced by two states and a second source of evidence — see
   the revision below.
2. **The pulse carries the machine's load average and core count.** Adil's
   own question on the day was why a job was stuck, and his guess was
   right: three research scripts from another session held 1700% CPU at
   load 50 on a 20-core machine, and ball detection was running at a fifth
   of its usual speed. Nothing anywhere reported that. The page now says
   it, and only when the load is high enough to be the explanation.
3. **A separate `admin_processing_counts()` for the hub**, so /admin does
   not load a hundred queued rows to render one line.
4. **The lesson recap workers are read from their own heartbeat**
   (`lesson_video_worker_heartbeats`) rather than being asked to pulse.
   They beat once a minute, so they get a slower staleness window. Their
   cloud half is live and reporting — 142 container ids today — which is
   worth knowing separately from the match-processing cloud twin, which is
   still off.

---

## 1. What is actually there today

Measured on production while writing this, not recalled.

**The Mac worker is one process, and right now it is stuck at the front of
a queue.** `ps` shows a single `worker.py` (the "main" lane). It has been
inside one `placement_generate` job for **2 hours 36 minutes** — the log
reads `frame 57000/65807  6.1 fps` — and behind it sit **12 jobs**: three
uploads waiting to be cut, three content checks, three share renders, two
re-cuts. The oldest has been queued 2h 37m. Nothing anywhere says this.

**A second lane exists and nothing is running it.** Migration
`20260906174730_fast_lane` added a `jobs_fast` queue so a five-second
re-cut does not queue behind a forty-minute upload. It is switched off
(`app_config.reclip_lane = 'main'`) because starting the queue before the
process that drains it would strand work. So the two re-cuts above are
sitting behind a three-hour job for exactly the reason the fast lane was
built to fix, and there is no screen that would have shown that.

**A third worker exists on the Mac**: `worker/lesson_video.py`, which
renders coach lesson recaps. It already reports a heartbeat every run
(`lesson_video_worker_heartbeats`, 145 rows) and already has a health RPC
and an API route. It is not running at the moment.

**The cloud twin's control plane is already in production, and it is
empty.** Another session has been building the Modal backup worker
(branch `codex/modal-backup-worker`). Production carries the whole
schema — `processing_control`, `pipeline_releases`, `job_attempts`,
`worker_heartbeats`, and a large `get_worker_control_dashboard()` RPC.
Its live state:

| | |
| --- | --- |
| cloud mode | `disabled` |
| active release | none — 6 candidates, 0 activated |
| parity gate | not passed |
| worker heartbeats | **0 rows** |
| job attempts | **0 rows** |

So Adil's guess was right on both counts: the cloud worker is not
deployed, and its scaffolding *is* in production.

**Nothing in `main` reads or writes any of it.** The heartbeat calls, the
attempt records and an `/admin/workers` page all exist on that unmerged
branch. The worker running on the Mac Studio today is `main`'s worker,
which reports nothing.

## 2. Why the obvious version of this page would lie

The tempting build is to read `jobs` and show status and progress. That
page would be wrong in the one moment it matters.

`jobs.progress` is written at a handful of milestones, and for the long
kinds there is nothing between them. `placement_generate` writes 5 at the
start, 20 shortly after, and 100 at the end. The job running while this
was written has therefore read **20% for two and a half hours**, and
because `updated_at` only moves when a column does, its "last updated" is
frozen at the same moment. Read those two columns and the honest
conclusion is "this worker died at 16:11". It is working perfectly.

The same shape hides the opposite failure. If the Mac genuinely crashes
mid-job, the row also sits at 20% with a stale timestamp — identical on
screen. A queue view alone cannot tell a busy worker from a dead one, and
that distinction is the whole request.

**So the worker has to say so itself.** That is one small addition to
`worker.py` and it is the load-bearing part of this spec.

## 3. The decision: a plain pulse, not the parity heartbeat

There is an existing heartbeat — `report_worker_heartbeat()` — and reusing
it is the wrong call. It is not a liveness signal; it is the gate on the
Mac/Modal parity contract. A worker reporting itself healthy must name a
release that is currently active and match its manifest hash, platform
profile, calibration strategy and model checksums. Today no release is
active, so `main`'s worker calling it would be recorded as **unhealthy and
identity-rejected**, and if cloud dispatch were ever switched on, that
same call would switch it straight back off (`cloud_mode = 'disabled'`,
reason `release_mismatch`). Satisfying it properly means shipping the
whole release-manifest machinery, which is the other session's project and
not something to do sideways.

**So this adds its own table, deliberately small and deliberately
separate**, answering only "which process, alive since when, doing what".
It does not touch `processing_control`, `pipeline_releases`,
`worker_heartbeats`, `job_attempts` or any of their functions. When the
Modal branch lands, the two sit side by side: parity/dispatch there,
operations here, and the page reads both.

## 4. The page

Route **`/admin/processing`**, titled **Processing**, added to
`ADMIN_WORKSPACES` in `src/app/admin/adminPageView.ts` — Adil asked for it
under Workspaces, and it fits the definition already written there: a
place you go to do a job over time, not a setting you go to change.

Its hub card carries a live detail line, which is the point of the hub:

- busy and clear → `Working · 3 queued`
- nothing to do → `Idle`
- backed up → `Working · 12 queued, oldest 2h` *(attention)*
- silent → `Not running` *(attention)*

Four sections, in the order the questions get asked.

### Workers

One row per process, whether or not it has ever checked in — a worker that
has never spoken must appear as **Not running**, because a missing row is
the failure this page exists to show. Rows: Mac · main, Mac · fast, Mac ·
lesson recaps, Cloud (Modal).

Each row: a state dot, what it is doing, and since when.

| state | rule |
| --- | --- |
| **Working** | beat within 90s, carrying a job |
| **Idle** | beat within 90s, no job |
| **Not running** | no beat for 5 minutes, or no row at all |
| **Off** | the lane is switched off by config (fast lane today, cloud today) |

**Off is not a fault**, and separating it from Not running is most of the
value of this section: the fast lane being dark is a decision, and the
main lane being dark is an outage. They must never look the same.

A Working row reads as a sentence, not a status code:

> **Mac · main** — Finding the ball · Mert's upload · 87% · 2h 36m

with the counter (`frame 57000 of 65807, 6.1 fps`) underneath, the code
version the daemon actually loaded, and a link to `/admin/uploads/<match>`
where there is one. The stage is a plain-English phrase — "Finding the
ball", "Downloading", "Cutting", "Scoring points", "Uploading" — because
the reader is Adil, not the log.

### Waiting

The queue: count, and one line per job — kind, who, how long it has
waited, and its estimated work where the ETA columns carry one. Ordered
oldest first, because the oldest is the complaint.

An **age that crosses 30 minutes reads as attention**. That number is not
invented: `processing_control.oldest_wait_s` is already set to 1800 as the
cloud's own overflow trigger, so the page and the dispatcher agree on what
"too long" means, and the page will not disagree with the cloud once the
cloud exists.

### Recently finished

The last 20 terminal jobs — kind, who, how long it took, and the outcome.
Failures show their error; a failed job is the thing most worth seeing and
the current portal shows it nowhere. This is also the only honest measure
of throughput, so the section header carries it: *"14 done, 2 failed in
the last 24 hours."*

### Cloud (Modal)

A real section reading the real control plane, not a "coming soon" box.
Today it renders what production actually says:

> **Not running.** No pipeline release has been activated, so nothing can
> be sent to the cloud. Parity has not been signed off. Six candidate
> releases are built.

with mode, the three gates, the spend caps ($3/day, $20/month) and the
budget used. When the Modal branch lands, this section starts showing
numbers with no further change, because it is reading the columns that
branch already writes. That is the placeholder Adil asked for, and it is a
placeholder that is already correct.

## 5. Schema

One migration, timestamp-named per the current convention
(`supabase/migrations/<UTC timestamp>_worker_pulse.sql`).

```
create table public.worker_pulse (
  worker_id   text primary key,   -- 'mac:main', 'mac:fast', 'mac:lesson', 'modal:<id>'
  lane        text not null,      -- main | fast | lesson | modal
  host        text not null,      -- mac | modal
  pid         integer,
  code_version text,              -- git describe of the checkout the daemon loaded
  started_at  timestamptz not null default now(),
  beat_at     timestamptz not null default now(),
  job_id      uuid references public.jobs(id) on delete set null,
  job_kind    text,
  stage       text,               -- download | inference | cut | points | publish | ...
  stage_note  text,               -- 'frame 57000/65807, 6.1 fps'
  stage_pct   integer
);
```

- **RLS on, admin-only, no anon or authenticated grant.** It names jobs
  and therefore, one join away, people. `service_role` writes.
- `started_at` resets only when `code_version` changes or the row is
  absent, so "up since" survives a heartbeat and means what it says. A
  restart on the same commit still shows as a restart because the pid
  changes — worth showing, since a `KeepAlive` restart loop is a real
  failure mode and `ThrottleInterval` is 30s.
- **One row per process, upserted.** No history table. Job history already
  lives in `jobs`, and a pulse log would be a large table nobody reads.

Two functions:

- `record_worker_pulse(...)` — `security definer`, service_role only, one
  upsert. Never raises on a bad stage name; an unrecognised stage is
  stored as given and rendered as itself. A new job kind must never be
  able to break the worker or vanish from the page.
- `admin_processing_overview()` — `security definer`, `is_admin()`
  re-checked inside, returns one JSON document: pulses, waiting jobs,
  recent jobs, per-lane config, and the cloud control summary. One call,
  because four round trips on a page that refreshes is four chances for
  one to fail and blank the rest.

## 6. Worker changes

`worker/worker.py`, and the same shape in `worker/lesson_video.py`.

- A **daemon thread beating every 15 seconds** on its own connection,
  built exactly like the existing `start_cost_alert_monitor()`. Its own
  connection matters: the main one is inside the job's transaction for
  hours at a time.
- A module-level `CURRENT` dict the thread reads. `process_job` sets it on
  claim and clears it on finish; six or seven assignments inside the
  per-kind paths set the stage.
- **`stage_pct` and `stage_note` come free.** `run_blurball` already takes
  an `on_progress` callback and already computes `frame/total` and fps for
  the log line — the same numbers the log has been printing all along,
  written where a page can read them.
- **Every part of it is best-effort and wrapped.** A failed pulse logs a
  warning and is forgotten. The rule from the storage ledger and the cost
  meter applies unchanged: monitoring must never fail a job. A page that
  can take down the pipeline is worse than no page.
- The pulse thread keeps beating between jobs, which is what makes **Idle**
  distinguishable from **Not running**.

`worker/README.md` gains a short section: what the pulse is, that
`/admin/processing` reads it, and how to check it by hand.

## 7. The standing rule

Adil's requirement, in his words: *"the worker might change in the future,
so we want to add cloud documentation to make sure every future chat knows
that it might change... It should update this page to ensure that the
stats are updated by the task done by the worker."*

The failure this prevents is quiet. Someone adds a job kind, the page
keeps working, and that kind is simply never mentioned — the page is not
broken, it is just no longer complete, and nothing tells anyone.

Two defences, because the documentation alone will not hold:

**In `CLAUDE.md`**, a section beside "Think in surfaces":

> **The processing page has to keep up with the worker.** `/admin/processing`
> is the only place anyone can see whether the workers are alive and what
> they are doing. A new job kind, a new stage, a new lane or a second
> execution location is not finished when the worker handles it — it is
> finished when the page names it. Adding a kind means adding its plain
> English label and its stage phrases; adding a lane means adding its row,
> including the case where nothing is running it, because a lane that is
> switched off and a lane that has died must never look the same. The Mac
> Studio is one execution location of one pipeline and the cloud twin is
> the other; anything true of one worker is a question about both.

**And in the code**, so a missed update is visible rather than silent:
unknown kinds and stages render as themselves rather than being dropped,
and the page shows an unlabelled kind with its raw name. A phrase like
`spin_report` sitting in the middle of a page of English sentences is the
notice, and it appears on the first job of that kind without anyone having
to remember anything.

## 8. Verification

Standard for this repo, and a real one is available: the Mac worker is
genuinely busy on a three-hour job with twelve queued behind it, so the
busy case can be observed rather than staged.

1. `npm run build` in a worktree, full run.
2. Unit tests on the view module: state rules, the Off-vs-Not-running
   split, age and duration labels, unknown kinds surviving.
3. Desktop web at 1440×900.
4. Mobile web at **393×660**, not 393×844. One layout at both widths, not
   two designs — the standing rule.
5. Against the live worker: confirm **Working** with a moving counter,
   confirm the queue matches `pgmq.metrics_all()`, then stop the worker
   (`launchctl kill`) and confirm the row turns **Not running** within
   five minutes and the hub card raises attention.

## 9. What this deliberately does not do

- **No controls.** Read-only. No pause, no retry, no reorder, no cancel.
  Adil asked to see the worker, and a button that can drain a queue on a
  page whose numbers have never been read once is how a bad afternoon
  starts. Buttons are a second conversation, once the numbers have been
  trusted for a while.
- **No change to the Modal control plane.** No writes to
  `processing_control`, `pipeline_releases`, `worker_heartbeats` or
  `job_attempts`, and no merge of `codex/modal-backup-worker`. That branch
  is in flight and is not mine to land.
- **No second page.** `/admin/workers` on the Modal branch is the parity
  and dispatch console — releases, canaries, gates. If it lands, its
  contents belong as a link from the Cloud section, not as a rival page
  with a similar name.
- **The fast lane stays off.** This page will make the case for turning it
  on plain, and that is a decision for Adil once he can see the cost.

---

## Revision, 2026-09-06 evening: saying "healthy" when it is healthy

Migration `20260906195000_processing_counts_liveness`.

The page was correct and still misled its only reader, which is the same
thing as being wrong. `Not reporting`, in the accent colour, described a
worker that was working perfectly. Two changes, and the second is the one
that matters.

**Silence is only evidence if the thing has spoken before.** `Not
reporting` split in two. A worker with a pulse row that has gone quiet
while holding a job is `silent` — "Not responding", amber, a real alarm. A
worker with no row at all has never reported and therefore cannot have
stopped; it is `unconfirmed` — "Status unknown", grey, a gap in the page
rather than a fault in the machine. The excuse is not permanent: once
anything on the machine beats, `pulseProven` is true and silence from the
other lanes becomes a real absence again, so the fast lane still shows as
an outage the moment it is routed work with nothing draining it.

**The job rows are a second, independent proof of life.** A job whose
progress advanced, or one a worker has just finished or failed, proves
something is running — nothing else writes those rows. Measured on the
day: `deadspace_cut` advances `progress` every twenty seconds or so, while
`placement_generate` writes 5, 20, 100 and stands still for hours. So the
signal is strictly one-directional. Movement proves life. Stillness proves
nothing, and must never be read as proof of death.

That is enough to say "Working" today, before the worker has ever been
restarted: the page reads the kind and the person from the job row, shows
the percentage, and states plainly where the claim came from — "Confirmed
by the job's own progress rather than by the worker." An inference is
never allowed to read as a report.

Consequences elsewhere:

- The in-flight callout now fires only on jobs that are unclaimed **and**
  standing still. Before, it warned about every job a non-reporting worker
  was busily processing.
- Finished jobs count as movement. Restricted to jobs in flight, the hub
  card flicked into an alarm for the few seconds between one job ending
  and the next starting — the exact moment the worker was most obviously
  working.
- Amber is now spent only on `silent` and `not-running`. `off` and
  `unconfirmed` are grey.

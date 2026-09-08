import assert from "node:assert/strict";
import test from "node:test";
import {
  BEAT_STALE_S,
  WAIT_ATTENTION_S,
  buildWorkerRows,
  durationLabel,
  kindLabel,
  isKnownKind,
  isKnownStage,
  loadNote,
  processingHubDetail,
  queueSummary,
  sourceName,
  stageLabel,
  throughputSummary,
  stalledRunning,
  waitingRows,
  workerState,
  type ProcessingCounts,
  type ProcessingOverview,
  type RunningJob,
  type WorkerPulse,
} from "./processingView.ts";

/** A job in flight. `updated_at` is what says whether it is moving. */
function job(over: Partial<RunningJob> = {}): RunningJob {
  return {
    id: "job-1",
    kind: "deadspace_cut",
    created_at: ago(3600),
    updated_at: ago(5),
    progress: 32,
    original_name: null,
    match_id: null,
    player: "Anton Berman",
    ...over,
  };
}

const NOW = new Date("2026-09-06T19:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

function pulse(over: Partial<WorkerPulse> = {}): WorkerPulse {
  return {
    worker_id: "mac:main",
    lane: "main",
    host: "mac",
    pid: 77922,
    code_version: "214621cb",
    started_at: ago(3600),
    beat_at: ago(5),
    job_id: null,
    job_kind: null,
    match_id: null,
    stage: null,
    stage_note: null,
    stage_pct: null,
    host_load_1m: null,
    host_cpu_count: null,
    player: null,
    job_created_at: null,
    ...over,
  };
}

function overview(over: Partial<ProcessingOverview> = {}): ProcessingOverview {
  return {
    now: NOW.toISOString(),
    workers: [],
    lesson: {},
    waiting: [],
    running: [],
    recent: [],
    day: { done: 0, failed: 0 },
    queue: [],
    reclip_lane: "main",
    cloud: { cloud_mode: "disabled" },
    ...over,
  };
}

/* ---------------------------------------------------------------- states */

test("a beating worker with a job is working, without one is idle", () => {
  assert.equal(workerState(pulse({ job_id: "j" }), { now: NOW }), "working");
  assert.equal(workerState(pulse(), { now: NOW }), "idle");
});

test("silence past the beat window, from a worker that HAS spoken, is not running", () => {
  const stale = pulse({ beat_at: ago(BEAT_STALE_S + 1) });
  assert.equal(workerState(stale, { now: NOW }), "not-running");
  assert.equal(
    workerState(pulse({ beat_at: ago(BEAT_STALE_S - 1) }), { now: NOW }),
    "idle",
  );
});

// The distinction the first version of this page got wrong. A worker that
// has never sent a beat cannot have "stopped", so its silence says
// nothing about its health and must not be reported as though it did.
test("a worker that has never spoken is unconfirmed, not an outage", () => {
  assert.equal(workerState(null, { now: NOW }), "unconfirmed");
  assert.equal(
    workerState(null, { now: NOW, jobInFlight: true }),
    "unconfirmed",
  );
});

// Whereas a worker that WAS beating and went quiet holding a job is the
// real alarm, and keeps it.
test("a worker that reported and went quiet mid-job is silent", () => {
  assert.equal(
    workerState(pulse({ beat_at: ago(600), job_id: "j" }), {
      now: NOW,
      jobInFlight: true,
    }),
    "silent",
  );
});

// Proof of life that does not need the worker's cooperation: if the job it
// is holding is advancing its own progress, something is running it.
test("a moving job proves a non-reporting worker is working", () => {
  assert.equal(
    workerState(null, { now: NOW, jobInFlight: true, jobMoving: true }),
    "working",
  );
  // And it outranks the alarm, for the same reason.
  assert.equal(
    workerState(pulse({ beat_at: ago(600), job_id: "j" }), {
      now: NOW,
      jobInFlight: true,
      jobMoving: true,
    }),
    "working",
  );
});

// The whole point of separating them: a lane switched off by choice and a
// lane that has died must never look the same.
test("off outranks everything and is not an outage", () => {
  assert.equal(workerState(null, { now: NOW, off: true }), "off");
  assert.equal(
    workerState(pulse({ job_id: "j" }), { now: NOW, off: true }),
    "off",
  );
});

/* ------------------------------------------------------------------ rows */

test("every expected process gets a row, spoken for or not", () => {
  const rows = buildWorkerRows(overview(), NOW);
  const keys = rows.map((r) => r.key);
  assert.deepEqual(keys, [
    "mac:main",
    "mac:fast",
    "mac:hand",
    "lesson:mac",
    "lesson:cloud",
    "modal:main",
  ]);
  // Nothing on the Mac has ever reported in this fixture, so the page is
  // blind rather than looking at an outage, and says the honest thing.
  assert.equal(rows[0].state, "unconfirmed");
});

test("the unrouted fast lane is off, and the main lane never is", () => {
  const rows = buildWorkerRows(overview({ reclip_lane: "main" }), NOW);
  assert.equal(rows.find((r) => r.key === "mac:fast")?.state, "off");
  assert.notEqual(rows.find((r) => r.key === "mac:main")?.state, "off");
});

// Once the machine is demonstrably reporting, silence from a lane that
// work is being ROUTED to is a real outage: jobs are going into a queue
// nobody is draining. The main lane beating is what removes the excuse.
test("a routed fast lane with nothing draining it is an outage, not off", () => {
  const rows = buildWorkerRows(
    overview({ reclip_lane: "fast", workers: [pulse({ worker_id: "mac:main" })] }),
    NOW,
  );
  assert.equal(rows.find((r) => r.key === "mac:fast")?.state, "not-running");
});

// ...but before anything has ever reported, the page cannot tell, and
// must not claim an outage it has no evidence for.
test("a routed fast lane on a silent machine is unconfirmed, not an outage", () => {
  const rows = buildWorkerRows(overview({ reclip_lane: "fast" }), NOW);
  assert.equal(rows.find((r) => r.key === "mac:fast")?.state, "unconfirmed");
});

// The hand-cut lane has no switch; its queue existing is the switch. Before
// the migration there is nothing to drain and nothing to report.
test("the hand-cut lane is off until its queue exists", () => {
  const rows = buildWorkerRows(overview({ queue: [] }), NOW);
  assert.equal(rows.find((r) => r.key === "mac:hand")?.state, "off");
});

test("a hand-cut queue with nothing draining it is an outage once the machine reports", () => {
  const rows = buildWorkerRows(
    overview({
      queue: [{ queue_name: "jobs_hand", queue_length: 1, oldest_msg_age_sec: 20 }],
      workers: [pulse({ worker_id: "mac:main" })],
    }),
    NOW,
  );
  assert.equal(rows.find((r) => r.key === "mac:hand")?.state, "not-running");
});

// A new lane has to appear on its own first beat, without this file being
// edited. Otherwise the page silently under-reports the machine.
test("a worker nobody has heard of still gets a row", () => {
  const rows = buildWorkerRows(
    overview({ workers: [pulse({ worker_id: "mac:lesson2", lane: "x" })] }),
    NOW,
  );
  assert.ok(rows.some((r) => r.key === "mac:lesson2"));
});

test("a working row says the stage, the kind, the player and how long", () => {
  const rows = buildWorkerRows(
    overview({
      workers: [
        pulse({
          job_id: "j1",
          job_kind: "placement_generate",
          stage: "ball",
          stage_note: "frame 57000 of 65807, 6.1 fps",
          stage_pct: 87,
          player: "Mert Ipek",
          job_created_at: ago(9420),
          match_id: "m1",
        }),
      ],
      running: [
        {
          id: "j1",
          kind: "placement_generate",
          created_at: ago(9420),
          updated_at: ago(9400),
          progress: 20,
          original_name: null,
          match_id: "m1",
          player: "Mert Ipek",
        },
      ],
    }),
    NOW,
  );
  const main = rows[0];
  assert.equal(main.state, "working");
  assert.equal(
    main.detail,
    "Finding the ball · Placement map · Mert Ipek · 2h 37m",
  );
  assert.equal(main.note, "frame 57000 of 65807, 6.1 fps");
  assert.equal(main.pct, 87);
  assert.equal(main.matchId, "m1");
});

test("the lesson recap workers come from their own heartbeat", () => {
  const rows = buildWorkerRows(
    overview({
      lesson: {
        mac_beat_at: ago(20),
        mac_started_at: ago(30000),
        cloud_beat_at: ago(40),
        cloud_enabled: true,
        cloud_reporting_today: 142,
        release_id: "lesson-video-000cf954",
      },
    }),
    NOW,
  );
  assert.equal(rows.find((r) => r.key === "lesson:mac")?.state, "idle");
  const cloud = rows.find((r) => r.key === "lesson:cloud");
  assert.equal(cloud?.state, "idle");
  assert.equal(cloud?.detail, "Waiting for the Mac fallback rule.");
});

test("a candidate worker row names its stage without losing the current lane or progress", () => {
  for (const [stage, label] of [
    ["candidate_prepare", "Preparing candidate video"],
    ["candidate_points", "Finding candidate points"],
    ["candidate_save", "Saving candidate version"],
  ]) {
    const rows = buildWorkerRows(
      overview({
        workers: [pulse({
          job_id: "candidate-job",
          job_kind: "match_reprocess",
          stage,
          stage_pct: 42,
          player: "Mert Ipek",
          job_created_at: ago(120),
          match_id: "m1",
        })],
      }),
      NOW,
    );
    const main = rows.find((row) => row.key === "mac:main");
    assert.equal(main?.title, "Mac Studio · main");
    assert.equal(main?.state, "working");
    assert.equal(main?.detail, `${label} · Reprocessing a match · Mert Ipek · 2m`);
    assert.equal(main?.pct, 42);
    assert.equal(main?.matchId, "m1");
    assert.equal(main?.caveat, null);
    assert.equal(isKnownStage(stage), true);
  }
});

test("a disabled lesson cloud worker is off despite historical heartbeats", () => {
  const rows = buildWorkerRows(
    overview({
      lesson: {
        cloud_enabled: false,
        cloud_beat_at: ago(40),
        cloud_reporting_today: 142,
        release_id: "lesson-video-000cf954",
      },
    }),
    NOW,
  );
  const cloud = rows.find((r) => r.key === "lesson:cloud");
  assert.equal(cloud?.state, "off");
  assert.equal(cloud?.detail, "Not switched on.");
});

// They beat once a minute, not every fifteen seconds, so the fast window
// would call a healthy one dead every time.
test("the lesson workers get the slower beat window", () => {
  const rows = buildWorkerRows(
    overview({ lesson: { mac_beat_at: ago(120) } }),
    NOW,
  );
  assert.equal(rows.find((r) => r.key === "lesson:mac")?.state, "idle");
});

test("the cloud twin is off while no release is active", () => {
  const rows = buildWorkerRows(overview(), NOW);
  const cloud = rows.find((r) => r.key === "modal:main");
  assert.equal(cloud?.state, "off");
  assert.match(cloud?.detail ?? "", /No pipeline release/);
});

/* ---------------------------------------------------------------- naming */

// The standing rule, enforced in code because documentation will not hold:
// an unknown kind or stage renders as ITSELF. It must never be dropped,
// and never mapped to "other" — a raw name sitting in a page of English
// sentences is the notice that the page has fallen behind the worker.
test("an unknown job kind reads as its raw name", () => {
  assert.equal(kindLabel("deadspace_cut"), "Match processing");
  assert.equal(kindLabel("match_reprocess"), "Reprocessing a match");
  assert.equal(kindLabel("spin_report"), "spin_report");
  assert.equal(isKnownKind("spin_report"), false);
  assert.equal(isKnownKind("match_reprocess"), true);
  assert.equal(isKnownKind("reel"), true);
});

test("an unknown stage reads as its raw name", () => {
  assert.equal(stageLabel("ball"), "Finding the ball");
  assert.equal(stageLabel("candidate_prepare"), "Preparing candidate video");
  assert.equal(stageLabel("candidate_points"), "Finding candidate points");
  assert.equal(stageLabel("candidate_save"), "Saving candidate version");
  assert.equal(stageLabel("rtmpose"), "rtmpose");
  assert.equal(stageLabel(null), null);
  assert.equal(isKnownStage("rtmpose"), false);
});

// "Clip update / Clip update" is a row saying one thing twice. The
// worker's own placeholder names are dropped; a real filename or a
// YouTube title is how Adil recognises whose upload a row is.
test("a placeholder source name is dropped, a real one is kept", () => {
  assert.equal(sourceName("Clip update", "reclip"), null);
  assert.equal(sourceName("Match export", "reel"), null);
  assert.equal(sourceName("Placement generation", "placement_generate"), null);
  assert.equal(sourceName("IMG_2486.mov", "deadspace_cut"), "IMG_2486.mov");
  assert.equal(
    sourceName("2nd Chandigarh State Ranking 2026", "youtube_import"),
    "2nd Chandigarh State Ranking 2026",
  );
  assert.equal(sourceName(null, "reel"), null);
});

/* ----------------------------------------------------------------- times */

test("durations read the way a person would say them", () => {
  assert.equal(durationLabel(9), "9s");
  assert.equal(durationLabel(90), "1m");
  assert.equal(durationLabel(9420), "2h 37m");
  assert.equal(durationLabel(7200), "2h");
  assert.equal(durationLabel(200000), "2d");
  assert.equal(durationLabel(null), "—");
});

/* ----------------------------------------------------------------- queue */

test("the queue is oldest first and marks anything past the cloud's own trigger", () => {
  const doc = overview({
    waiting: [
      {
        id: "a",
        kind: "reclip",
        created_at: ago(60),
        original_name: null,
        match_id: null,
        player: "Adil",
        estimated_work_seconds: null,
        eta_latest_at: null,
      },
      {
        id: "b",
        kind: "content_check",
        created_at: ago(WAIT_ATTENTION_S + 10),
        original_name: null,
        match_id: null,
        player: "Tim",
        estimated_work_seconds: null,
        eta_latest_at: null,
      },
    ],
  });
  const rows = waitingRows(doc, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
  assert.equal(rows[0].attention, true);
  assert.equal(rows[1].attention, false);
  assert.equal(queueSummary(rows), "2 waiting, oldest 30m");
  assert.equal(queueSummary([]), "Nothing waiting.");
});

test("throughput names failures even when there are none", () => {
  assert.equal(
    throughputSummary({ done: 9, failed: 0 }),
    "9 finished, none failed in the last day.",
  );
  assert.equal(
    throughputSummary({ done: 14, failed: 2, cancelled: 1 }),
    "14 finished, 2 failed, 1 cancelled in the last day.",
  );
});

/* ------------------------------------------------------------------ load */

// A machine at its core count is a machine doing its job. Several times
// over is why a job that normally takes forty minutes is taking three
// hours, and it is invisible everywhere else.
test("machine load is only mentioned when it explains something", () => {
  assert.equal(loadNote(18, 20), null);
  assert.match(loadNote(50, 20) ?? "", /Machine load 50.0 across 20 cores/);
  assert.match(loadNote(50, 20) ?? "", /competing for the processor/);
  assert.equal(loadNote(null, 20), null);
});

/* ------------------------------------------------------------------- hub */

const counts = (over: Partial<ProcessingCounts> = {}): ProcessingCounts => ({
  queued: 0,
  running: 0,
  oldest_wait_s: 0,
  reporting: true,
  moving: false,
  ever_reported: true,
  ...over,
});

test("the hub card says working, waiting, or idle", () => {
  assert.deepEqual(
    processingHubDetail(counts({ queued: 3, running: 1, oldest_wait_s: 60 })),
    { text: "Working · 3 waiting", attention: false },
  );
  assert.deepEqual(processingHubDetail(counts()), {
    text: "Idle",
    attention: false,
  });
  assert.deepEqual(
    processingHubDetail(counts({ queued: 15, running: 1, oldest_wait_s: 10396 })),
    { text: "Working · 15 waiting, oldest 2h 53m", attention: true },
  );
});

// The false alarm that started all of this. Nothing beating, but a job
// visibly advancing: that is a working platform, and the card said the
// platform was down.
test("a moving job reads as Working on the hub even with nothing reporting", () => {
  assert.deepEqual(
    processingHubDetail(
      counts({ queued: 14, running: 1, reporting: false, moving: true, ever_reported: false }),
    ),
    { text: "Working · 14 waiting", attention: false },
  );
});

// A worker that HAS reported before and has gone quiet is the real alarm.
test("a worker that stopped responding raises attention on the hub", () => {
  assert.deepEqual(
    processingHubDetail(counts({ queued: 15, running: 1, reporting: false })),
    { text: "Not responding · 1 in flight · 15 waiting", attention: true },
  );
});

// One that has never reported gets a different sentence, and no alarm at
// all when there is nothing waiting on it.
test("a worker that never reported reads as unknown, not as down", () => {
  assert.deepEqual(
    processingHubDetail(counts({ reporting: false, ever_reported: false })),
    { text: "Status unknown", attention: false },
  );
  assert.deepEqual(
    processingHubDetail(counts({ queued: 15, running: 1, reporting: false, ever_reported: false })),
    { text: "Status unknown · 1 in flight · 15 waiting", attention: true },
  );
  assert.equal(processingHubDetail(null), null);
});

/* ------------------------------------------------- working without a beat */

// The state of the world on 2026-09-06: the Mac Studio was cutting dead
// space at 56 frames a second while sending no heartbeat at all, because
// it was running code from before heartbeats existed. The page said "Not
// reporting" in amber and the owner read it as an outage.
test("a non-reporting worker with a moving job reads as working", () => {
  const rows = buildWorkerRows(
    overview({ running: [job()] }),
    NOW,
  );
  const main = rows.find((r) => r.key === "mac:main");
  assert.equal(main?.state, "working");
  assert.match(main?.detail ?? "", /Match processing/);
  assert.match(main?.detail ?? "", /Anton Berman/);
  // And it says where that came from, so an inference never reads as a
  // report from the worker itself.
  assert.match(main?.caveat ?? "", /the job's own progress/);
  assert.equal(main?.pct, 32);
});

// The same worker with a job that has stopped moving: back to the honest
// "cannot tell", because a still job proves nothing either way.
test("a still job leaves a never-reporting worker unconfirmed", () => {
  const rows = buildWorkerRows(
    overview({ running: [job({ updated_at: ago(3600) })] }),
    NOW,
  );
  const main = rows.find((r) => r.key === "mac:main");
  assert.equal(main?.state, "unconfirmed");
  assert.match(main?.caveat ?? "", /restarted/);
});

test("the stalled callout ignores jobs that are moving", () => {
  // Moving: nothing to warn about, however long it has been running.
  assert.equal(stalledRunning(overview({ running: [job()] }), NOW).length, 0);
  // Standing still with nothing reporting: this is the one worth a look.
  assert.equal(
    stalledRunning(
      overview({ running: [job({ updated_at: ago(3600) })] }),
      NOW,
    ).length,
    1,
  );
});

// Between one job ending and the next being claimed there is nothing in
// flight to point at, and the row would sit at "cannot tell" every time
// the worker got something done. A job finishing IS a worker writing to
// the database, so the row says so.
test("a recent completion is offered as evidence on an unconfirmed row", () => {
  const rows = buildWorkerRows(
    overview({
      recent: [
        {
          id: "f1",
          kind: "content_check",
          status: "done",
          created_at: ago(300),
          updated_at: ago(40),
          error: null,
          user_message: null,
          original_name: null,
          match_id: null,
          player: null,
        },
      ],
    }),
    NOW,
  );
  const main = rows.find((r) => r.key === "mac:main");
  assert.equal(main?.state, "unconfirmed");
  assert.match(main?.caveat ?? "", /finished a job 40s ago, so a worker is running/);
});

// A cancellation is written by the app, not by a worker, so it proves
// nothing about whether one is alive.
test("a cancellation is not evidence that a worker is running", () => {
  const rows = buildWorkerRows(
    overview({
      recent: [
        {
          id: "f1",
          kind: "reclip",
          status: "cancelled",
          created_at: ago(300),
          updated_at: ago(10),
          error: null,
          user_message: null,
          original_name: null,
          match_id: null,
          player: null,
        },
      ],
    }),
    NOW,
  );
  const main = rows.find((r) => r.key === "mac:main");
  assert.doesNotMatch(main?.caveat ?? "", /so a worker is running/);
});

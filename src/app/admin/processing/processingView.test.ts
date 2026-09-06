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
  waitingRows,
  workerState,
  type ProcessingOverview,
  type WorkerPulse,
} from "./processingView.ts";

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

test("silence past the beat window is not running", () => {
  const stale = pulse({ beat_at: ago(BEAT_STALE_S + 1) });
  assert.equal(workerState(stale, { now: NOW }), "not-running");
  assert.equal(
    workerState(pulse({ beat_at: ago(BEAT_STALE_S - 1) }), { now: NOW }),
    "idle",
  );
});

// The failure this page exists to show. A worker that has never checked
// in has no row at all, and "no row" must read as an outage, not as a
// blank space.
test("a worker that has never spoken is not running", () => {
  assert.equal(workerState(null, { now: NOW }), "not-running");
});

// Silence WITH a job in flight is genuinely ambiguous — dead mid-job, or
// running code from before the pulse existed — and gets its own state
// rather than being guessed either way.
test("silence while a job is in flight is not-reporting, not not-running", () => {
  assert.equal(
    workerState(null, { now: NOW, jobInFlight: true }),
    "not-reporting",
  );
  assert.equal(
    workerState(pulse({ beat_at: ago(600), job_id: "j" }), {
      now: NOW,
      jobInFlight: true,
    }),
    "not-reporting",
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
    "lesson:mac",
    "lesson:cloud",
    "modal:main",
  ]);
  assert.equal(rows[0].state, "not-running");
});

test("the unrouted fast lane is off, and the main lane never is", () => {
  const rows = buildWorkerRows(overview({ reclip_lane: "main" }), NOW);
  assert.equal(rows.find((r) => r.key === "mac:fast")?.state, "off");
  assert.equal(rows.find((r) => r.key === "mac:main")?.state, "not-running");
});

test("a routed fast lane with nothing draining it is an outage, not off", () => {
  const rows = buildWorkerRows(overview({ reclip_lane: "fast" }), NOW);
  assert.equal(rows.find((r) => r.key === "mac:fast")?.state, "not-running");
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
        cloud_reporting_today: 142,
        release_id: "lesson-video-000cf954",
      },
    }),
    NOW,
  );
  assert.equal(rows.find((r) => r.key === "lesson:mac")?.state, "idle");
  const cloud = rows.find((r) => r.key === "lesson:cloud");
  assert.equal(cloud?.state, "idle");
  assert.match(cloud?.detail ?? "", /142 containers/);
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
  assert.equal(kindLabel("spin_report"), "spin_report");
  assert.equal(isKnownKind("spin_report"), false);
  assert.equal(isKnownKind("reel"), true);
});

test("an unknown stage reads as its raw name", () => {
  assert.equal(stageLabel("ball"), "Finding the ball");
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

test("the hub card says working, waiting, or silent", () => {
  assert.deepEqual(
    processingHubDetail({ queued: 3, running: 1, oldest_wait_s: 60, reporting: true }),
    { text: "Working · 3 waiting", attention: false },
  );
  assert.deepEqual(
    processingHubDetail({ queued: 0, running: 0, oldest_wait_s: 0, reporting: true }),
    { text: "Idle", attention: false },
  );
  assert.deepEqual(
    processingHubDetail({
      queued: 15,
      running: 1,
      oldest_wait_s: 10396,
      reporting: true,
    }),
    { text: "Working · 15 waiting, oldest 2h 53m", attention: true },
  );
});

// Silence is the one the hub has to shout about, because it is the only
// state that might mean nobody's uploads are being processed at all.
test("a silent worker raises attention on the hub", () => {
  assert.deepEqual(
    processingHubDetail({ queued: 15, running: 1, oldest_wait_s: 9, reporting: false }),
    { text: "Not reporting · 1 job in flight", attention: true },
  );
  assert.deepEqual(
    processingHubDetail({ queued: 0, running: 0, oldest_wait_s: 0, reporting: false }),
    { text: "Not reporting", attention: true },
  );
  assert.equal(processingHubDetail(null), null);
});

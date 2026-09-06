/**
 * Pure logic for /admin/processing: what state a worker is in, and how to
 * say in English what it is doing.
 *
 * THE RULE THIS PAGE EXISTS TO ENFORCE (see CLAUDE.md, "The processing
 * page has to keep up with the worker"): an unknown job kind or stage is
 * rendered as its raw name, never dropped and never mapped to "other".
 * The page stays correct when the worker grows a new kind; it just starts
 * showing `spin_report` in the middle of a page of English sentences,
 * which is the notice, and it appears on that kind's first job without
 * anyone having to remember anything.
 */

/** A worker beats every 15s, so a minute and a half of silence is real. */
export const BEAT_STALE_S = 90;
/**
 * A beat interval long enough to cover the lesson recap workers, which
 * report once a minute through their own release-gated heartbeat rather
 * than through the pulse.
 */
export const SLOW_BEAT_STALE_S = 300;
/**
 * When a queued job has waited too long. Not invented: it is
 * processing_control.oldest_wait_s, the cloud dispatcher's own overflow
 * trigger, so the page and the dispatcher cannot disagree about what
 * "too long" means.
 */
export const WAIT_ATTENTION_S = 1800;

/**
 * How recently a job's own progress must have moved for that movement to
 * count as proof that a worker is alive.
 *
 * This signal is ASYMMETRIC and must only ever be read one way. A job
 * whose progress advanced a minute ago proves something is running it:
 * nothing else writes that column. A job whose progress has NOT moved
 * proves nothing at all, because the worker writes it at milestones — a
 * dead space cut ticks every twenty seconds, but placement writes 5, then
 * 20, then 100, so a healthy placement job stands still for hours.
 *
 * Movement means working. Stillness means unknown. Never the reverse.
 */
export const JOB_MOVED_S = 180;

export type WorkerState =
  /** Proven to be working, either by its own heartbeat or by a job whose
   *  progress is moving underneath it. */
  | "working"
  | "idle"
  /** It was reporting, and went quiet while still holding a job. The one
   *  state on this page that is genuinely an alarm. */
  | "silent"
  /** It has never reported at all, so this page cannot see it either way.
   *  This is NOT a fault and is never coloured as one: it is what every
   *  worker reads as until it is restarted onto code that can report.
   *  Showing "possibly broken" where the truth is "not wired up yet" is
   *  the exact false alarm this state exists to prevent. */
  | "unconfirmed"
  /** It has reported before, is silent now, and holds no job. */
  | "not-running"
  /** Switched off by configuration. NOT a fault, and never coloured like
   *  one: the fast lane being dark is a decision, the main lane being
   *  dark is an outage. */
  | "off";

export interface WorkerPulse {
  worker_id: string;
  lane: string;
  host: string;
  pid: number | null;
  code_version: string | null;
  started_at: string;
  beat_at: string;
  job_id: string | null;
  job_kind: string | null;
  match_id: string | null;
  stage: string | null;
  stage_note: string | null;
  stage_pct: number | null;
  host_load_1m: number | null;
  host_cpu_count: number | null;
  player: string | null;
  job_created_at: string | null;
}

export interface QueuedJob {
  id: string;
  kind: string;
  created_at: string;
  original_name: string | null;
  match_id: string | null;
  player: string | null;
  estimated_work_seconds: number | null;
  eta_latest_at: string | null;
}

export interface RunningJob {
  id: string;
  kind: string;
  created_at: string;
  updated_at: string;
  progress: number;
  original_name: string | null;
  match_id: string | null;
  player: string | null;
}

export interface FinishedJob {
  id: string;
  kind: string;
  status: "done" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
  error: string | null;
  user_message: string | null;
  original_name: string | null;
  match_id: string | null;
  player: string | null;
}

export interface CloudControl {
  cloud_mode?: string | null;
  active_release_id?: string | null;
  latest_dispatch_reason?: string | null;
  privacy_gate_passed?: boolean;
  license_gate_passed?: boolean;
  parity_gate_passed?: boolean;
  successful_cloud_canaries?: number;
  daily_cap_usd?: number;
  monthly_cap_usd?: number;
  oldest_wait_s?: number;
  candidate_releases?: number;
  heartbeats?: number;
  attempts_24h?: number;
}

export interface LessonWorkers {
  mac_beat_at?: string | null;
  mac_started_at?: string | null;
  mac_worker_id?: string | null;
  cloud_beat_at?: string | null;
  cloud_worker_id?: string | null;
  cloud_reporting_today?: number;
  release_id?: string | null;
}

export interface ProcessingOverview {
  now: string;
  workers: WorkerPulse[];
  lesson: LessonWorkers;
  waiting: QueuedJob[];
  running: RunningJob[];
  recent: FinishedJob[];
  day: { done?: number; failed?: number; cancelled?: number };
  queue: { queue_name: string; queue_length: number; oldest_msg_age_sec: number | null }[];
  reclip_lane: string | null;
  cloud: CloudControl;
}

/* -------------------------------------------------------------------------
 * Names
 * ---------------------------------------------------------------------- */

/** What each job kind is, in the words Adil would use for it. */
const KIND_LABELS: Record<string, string> = {
  content_check: "Content check",
  deadspace_cut: "Match processing",
  placement_generate: "Placement map",
  placement_retry: "Placement map, second try",
  reclip: "Clip update",
  reel: "Share video",
  side_change: "End changes",
  youtube_import: "YouTube import",
};

/** An unknown kind reads as itself. That is the point. */
export function kindLabel(kind: string | null | undefined): string {
  if (!kind) return "Unknown job";
  return KIND_LABELS[kind] ?? kind;
}

/** Whether the page has been taught this kind. Drives the small "new"
 *  marker, which is how a missed update becomes visible. */
export function isKnownKind(kind: string | null | undefined): boolean {
  return !!kind && kind in KIND_LABELS;
}

/** The stages a worker reports, as sentences rather than log tokens. */
const STAGE_LABELS: Record<string, string> = {
  download: "Downloading the video",
  import: "Downloading from YouTube",
  content_check: "Checking what the video is",
  trim: "Trimming to the claimed window",
  ball: "Finding the ball",
  points: "Building the points",
  cut: "Cutting the video",
  upload: "Uploading the result",
  publish: "Saving the match",
  placement: "Building the placement map",
  reel: "Rendering the share video",
  reclip: "Re-cutting clips",
  housekeeping: "Housekeeping",
};

/**
 * The names the worker writes into original_name for jobs that have no
 * source file of their own. Repeating them under the kind gives a row
 * that reads "Clip update / Clip update", so they are dropped; a real
 * filename or a YouTube title is kept, because that is how Adil
 * recognises whose upload a row is.
 */
const GENERIC_NAMES = new Set([
  "Match export",
  "Clip update",
  "Placement generation",
]);

export function sourceName(
  name: string | null | undefined,
  kind: string,
): string | null {
  if (!name) return null;
  if (GENERIC_NAMES.has(name)) return null;
  if (name === kindLabel(kind)) return null;
  return name;
}

export function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return STAGE_LABELS[stage] ?? stage;
}

export function isKnownStage(stage: string | null | undefined): boolean {
  return !!stage && stage in STAGE_LABELS;
}

/* -------------------------------------------------------------------------
 * Times
 * ---------------------------------------------------------------------- */

export function secondsBetween(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((now.getTime() - ms) / 1000));
}

/** "3s", "4m", "2h 36m", "3d". Short enough to sit in a table cell. */
export function durationLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "—";
  }
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(s / 86400)}d`;
}

export function agoLabel(iso: string | null | undefined, now: Date): string {
  const s = secondsBetween(iso, now);
  if (s === null) return "—";
  if (s < 45) return "just now";
  return `${durationLabel(s)} ago`;
}

/* -------------------------------------------------------------------------
 * Worker state
 * ---------------------------------------------------------------------- */

export function workerState(
  pulse: { beat_at: string; job_id: string | null } | null,
  opts: {
    now: Date;
    /** The lane is switched off by configuration. */
    off?: boolean;
    /** A job is marked in flight somewhere, so silence is ambiguous. */
    jobInFlight?: boolean;
    /** A job in flight has moved its own progress within JOB_MOVED_S.
     *  Proof of life that does not depend on the worker reporting. */
    jobMoving?: boolean;
    /** Reporting is known to work on this machine: some worker on it has
     *  sent a beat. That turns silence from a lane into a real absence,
     *  because the excuse — "it is running code from before reporting
     *  existed" — cannot apply to a machine that is demonstrably
     *  reporting. */
    pulseProven?: boolean;
    staleAfterS?: number;
  },
): WorkerState {
  if (opts.off) return "off";
  const stale = opts.staleAfterS ?? BEAT_STALE_S;
  const age = pulse ? secondsBetween(pulse.beat_at, opts.now) : null;
  if (age !== null && age <= stale) {
    return pulse?.job_id ? "working" : "idle";
  }
  // No heartbeat. The job's own progress can still settle it.
  if (opts.jobMoving) return "working";
  if (!pulse) {
    // Never reported at all — a row is inserted on a worker's first beat
    // and updated forever after, so a missing row means this worker has
    // never once spoken. It cannot have stopped mid-job, because it never
    // started. Whether that is a fault turns on one thing: does reporting
    // work on this machine? If nothing on it has ever beaten, this page is
    // simply blind and must say so. If something HAS, the excuse is gone
    // and a silent lane really is a lane that is not running.
    return opts.pulseProven ? "not-running" : "unconfirmed";
  }
  // It spoke before and has gone quiet. Holding a job, that is the alarm.
  return opts.jobInFlight ? "silent" : "not-running";
}

export interface WorkerRow {
  key: string;
  /** "Mac Studio · main" */
  title: string;
  state: WorkerState;
  /** The one-line answer: what it is doing, or why it is not. */
  detail: string;
  /** Where the answer came from, when it did not come from the worker
   *  itself. "Working" must never read as an unsourced assertion. */
  caveat: string | null;
  /** The counter under it — the log line, essentially. */
  note: string | null;
  /** Percent through the current stage, when the stage reports one. */
  pct: number | null;
  /** How long the current job has been running. */
  jobFor: number | null;
  matchId: string | null;
  player: string | null;
  upSince: string | null;
  codeVersion: string | null;
  /** "Load 50 across 20 cores" when the machine is oversubscribed. */
  loadNote: string | null;
}

/**
 * How busy the machine is, but only when it is worth saying. A load
 * average near the core count is a machine doing its job; several times
 * the core count means everything on it is running slowly, which is the
 * answer to "why is this taking so long" and is invisible everywhere else.
 */
export function loadNote(
  load: number | null | undefined,
  cpus: number | null | undefined,
): string | null {
  if (typeof load !== "number" || !Number.isFinite(load)) return null;
  if (!cpus || cpus <= 0) return `Machine load ${load.toFixed(1)}`;
  const label = `Machine load ${load.toFixed(1)} across ${cpus} cores`;
  if (load < cpus * 1.5) return null;
  return `${label} — something else on the Mac is competing for the processor`;
}

function pulseDetail(p: WorkerPulse, now: Date): string {
  const stage = stageLabel(p.stage);
  const kind = kindLabel(p.job_kind);
  const who = p.player ? ` · ${p.player}` : "";
  if (!p.job_id) return "Waiting for work";
  return `${stage ?? kind}${stage ? ` · ${kind}` : ""}${who} · ${durationLabel(
    secondsBetween(p.job_created_at ?? p.beat_at, now),
  )}`;
}

const STATE_DETAIL: Record<WorkerState, string> = {
  // Only reached if a row is working with neither a pulse nor a moving job
  // to describe it, which the states above make impossible. Kept total.
  working: "Working.",
  idle: "Waiting for work",
  silent:
    "It was reporting and has gone quiet while still holding a job. Either it stopped mid-job, or the machine it runs on is not answering.",
  unconfirmed:
    "This worker does not report its status yet, so the page cannot see it directly.",
  "not-running": "Nothing is running here.",
  off: "Switched off.",
};

/**
 * The same sentence as pulseDetail, assembled from the job row instead.
 * Used when a job is visibly moving but the worker is not reporting: the
 * job knows its kind and who is waiting on it, and cannot know the stage.
 */
function jobDetail(j: RunningJob, now: Date): string {
  const who = j.player ? ` · ${j.player}` : "";
  return `${kindLabel(j.kind)}${who} · ${durationLabel(
    secondsBetween(j.created_at, now),
  )}`;
}

/** Has this job's own progress moved recently? See JOB_MOVED_S: yes is
 *  proof of life, no is not proof of anything. */
export function jobIsMoving(j: RunningJob, now: Date): boolean {
  const age = secondsBetween(j.updated_at, now);
  return age !== null && age <= JOB_MOVED_S;
}

/** The first job in flight that is visibly moving, if any. */
export function movingJob(
  doc: ProcessingOverview,
  now: Date,
): RunningJob | null {
  return doc.running.find((j) => jobIsMoving(j, now)) ?? null;
}

/**
 * How long ago a worker last finished something, when that was recent
 * enough to prove one is running.
 *
 * The gap this closes: between one job ending and the next being claimed,
 * nothing is in flight and nothing is moving, so a non-reporting worker
 * fell back to "cannot tell" for a few seconds every time it got
 * something DONE. Finishing a job is a worker writing to the database,
 * which is exactly the proof of life being looked for. A cancellation is
 * not — the app writes those — so it does not count.
 */
export function lastFinishedS(
  doc: ProcessingOverview,
  now: Date,
): number | null {
  let best: number | null = null;
  for (const j of doc.recent ?? []) {
    if (j.status === "cancelled") continue;
    const age = secondsBetween(j.updated_at, now);
    if (age === null || age > JOB_MOVED_S) continue;
    if (best === null || age < best) best = age;
  }
  return best;
}

/**
 * Every process that should exist, whether or not it has ever spoken. A
 * worker that has never checked in has to appear as Not running: a
 * missing row is the failure this page exists to show, and a page that
 * renders only what it hears from would show nothing at all in exactly
 * that case.
 */
export function buildWorkerRows(
  doc: ProcessingOverview,
  now: Date = new Date(),
): WorkerRow[] {
  const pulses = new Map(doc.workers.map((w) => [w.worker_id, w]));
  const jobInFlight = doc.running.length > 0;
  // Has anything on the Mac ever reported? This is what tells "the page
  // cannot see this machine" apart from "this lane is not up", and it
  // corrects itself: the moment the worker is restarted onto code that
  // reports, every other lane's silence becomes meaningful.
  const pulseProven = doc.workers.some((w) => w.host === "mac");
  const rows: WorkerRow[] = [];

  const fromPulse = (
    key: string,
    title: string,
    opts: {
      off?: boolean;
      jobInFlight?: boolean;
      /** A job this worker is the only candidate for, whose progress is
       *  moving. Passed only to the lane that actually drains the queue. */
      moving?: RunningJob | null;
      /** Seconds since a worker last finished something. Only used to
       *  soften the "cannot tell" row, never to claim a state. */
      finishedS?: number | null;
    } = {},
  ): WorkerRow => {
    const p = pulses.get(key) ?? null;
    pulses.delete(key);
    const moving = opts.moving ?? null;
    const state = workerState(p, {
      now,
      ...opts,
      jobMoving: !!moving,
      pulseProven,
    });
    // Two ways to be working, and the page distinguishes them. Told by the
    // worker: the stage is known. Inferred from the job: the kind and the
    // person are known, the stage is not, and the row says where the claim
    // came from rather than letting an inference read as a report.
    const bySelf = state === "working" && !!p;
    const byJob = state === "working" && !p && !!moving;
    return {
      key,
      title,
      state,
      detail: bySelf
        ? pulseDetail(p, now)
        : byJob
          ? jobDetail(moving, now)
          : STATE_DETAIL[state],
      caveat: byJob
        ? "Confirmed by the job's own progress rather than by the worker. Restart the worker to see which stage it is on."
        : state === "unconfirmed"
          ? [
              opts.finishedS !== null && opts.finishedS !== undefined
                ? `Something finished a job ${durationLabel(
                    opts.finishedS,
                  )} ago, so a worker is running.`
                : null,
              "It starts reporting for itself the next time it is restarted.",
            ]
              .filter(Boolean)
              .join(" ")
          : null,
      note: bySelf ? p.stage_note ?? null : null,
      pct: bySelf ? p.stage_pct ?? null : byJob ? moving.progress : null,
      jobFor: bySelf
        ? secondsBetween(p.job_created_at ?? p.beat_at, now)
        : byJob
          ? secondsBetween(moving.created_at, now)
          : null,
      matchId: bySelf ? p.match_id ?? null : byJob ? moving.match_id : null,
      player: bySelf ? p.player ?? null : byJob ? moving.player : null,
      upSince: p && state !== "not-running" ? p.started_at : null,
      codeVersion: p?.code_version ?? null,
      loadNote:
        state === "working" || state === "idle"
          ? loadNote(p?.host_load_1m, p?.host_cpu_count)
          : null,
    };
  };

  // The main lane is the process that has always run. It is never "off":
  // if it is not there, that is an outage.
  rows.push(
    fromPulse("mac:main", "Mac Studio · main", {
      jobInFlight,
      // The main lane is the only process that drains the 'jobs' queue, so
      // a job moving in that queue can only be this one. If a second lane
      // ever drains it too, this has to key on the job rather than assume.
      moving: movingJob(doc, now),
      finishedS: lastFinishedS(doc, now),
    }),
  );

  // The fast lane (20260906174730) exists so a five-second clip update
  // does not queue behind a forty-minute upload. Nothing drains it until
  // app_config.reclip_lane routes work to it, and a queue nobody drains
  // is worse than no queue, so an unrouted fast lane is Off, not broken.
  rows.push(
    fromPulse("mac:fast", "Mac Studio · fast lane", {
      off: doc.reclip_lane !== "fast" && !pulses.has("mac:fast"),
    }),
  );

  // Anything else that pulsed. A new lane appears here on its first beat
  // without this file being edited, which is the point.
  for (const p of pulses.values()) {
    rows.push(fromPulse(p.worker_id, p.worker_id, { jobInFlight: false }));
  }

  // The lesson recap workers keep their own heartbeat and are left where
  // they are; this reads it rather than duplicating it.
  const lesson = doc.lesson ?? {};
  const lessonRow = (
    key: string,
    title: string,
    beat: string | null | undefined,
    started: string | null | undefined,
    detail: string,
  ): WorkerRow => {
    const state = workerState(
      beat ? { beat_at: beat, job_id: null } : null,
      {
        now,
        staleAfterS: SLOW_BEAT_STALE_S,
        // The lesson workers report through their own heartbeat table, so
        // that table is what proves reporting works for them. If either
        // one has ever beaten, the other's silence means something.
        pulseProven: !!(lesson.mac_beat_at || lesson.cloud_beat_at),
      },
    );
    return {
      key,
      title,
      // The lesson heartbeat says a process is alive; it does not say
      // which video it has. "Idle" would be a claim this signal cannot
      // make, so a live one reads as Running.
      state,
      detail: state === "idle" ? detail : STATE_DETAIL[state],
      caveat: null,
      note: null,
      pct: null,
      jobFor: null,
      matchId: null,
      player: null,
      upSince: state === "idle" ? started ?? null : null,
      codeVersion: lesson.release_id ?? null,
      loadNote: null,
    };
  };
  rows.push(
    lessonRow(
      "lesson:mac",
      "Mac Studio · lesson recaps",
      lesson.mac_beat_at,
      lesson.mac_started_at,
      "Reporting every minute.",
    ),
  );
  rows.push(
    lessonRow(
      "lesson:cloud",
      "Cloud · lesson recaps",
      lesson.cloud_beat_at,
      null,
      lesson.cloud_reporting_today
        ? `Reporting every minute. ${lesson.cloud_reporting_today} containers have checked in today.`
        : "Reporting every minute.",
    ),
  );

  // The cloud twin for match processing. Off until a pipeline release is
  // activated and the parity gate passes; the Cloud section below says so
  // in full.
  const cloudMode = doc.cloud?.cloud_mode ?? "disabled";
  rows.push({
    key: "modal:main",
    title: "Cloud · match processing",
    state: cloudMode === "disabled" ? "off" : "not-running",
    detail:
      cloudMode === "disabled"
        ? "Not switched on. No pipeline release has been activated."
        : STATE_DETAIL["not-running"],
    caveat: null,
    note: null,
    pct: null,
    jobFor: null,
    matchId: null,
    player: null,
    upSince: null,
    codeVersion: doc.cloud?.active_release_id ?? null,
    loadNote: null,
  });

  return rows;
}

/* -------------------------------------------------------------------------
 * The queue
 * ---------------------------------------------------------------------- */

export interface WaitingRow extends QueuedJob {
  waited: number;
  /** Waited past the cloud dispatcher's own overflow trigger. */
  attention: boolean;
}

export function waitingRows(
  doc: ProcessingOverview,
  now: Date = new Date(),
): WaitingRow[] {
  return doc.waiting
    .map((job) => {
      const waited = secondsBetween(job.created_at, now) ?? 0;
      return { ...job, waited, attention: waited >= WAIT_ATTENTION_S };
    })
    .sort((a, b) => b.waited - a.waited);
}

/**
 * Jobs the rows say are running that nothing can be shown to be working
 * on: unclaimed by any live heartbeat AND standing still by their own
 * progress.
 *
 * This is the state the page was built for, and how often it is reached
 * depends entirely on the kind of job. Measured 2026-09-06: a dead space
 * cut advances `progress` and `updated_at` about every twenty seconds, so
 * it is never in here while it is healthy. Placement writes 5, then 20,
 * then 100, so a placement row can sit at 20% since 16:11 and be either
 * three hours of honest work or a worker that died at 16:11 — the columns
 * genuinely cannot tell you which. Those are the jobs at stake, and the
 * page names them rather than picking an answer.
 */
export function stalledRunning(
  doc: ProcessingOverview,
  now: Date = new Date(),
): RunningJob[] {
  const claimed = new Set(
    doc.workers
      .filter((w) => {
        const age = secondsBetween(w.beat_at, now);
        return age !== null && age <= BEAT_STALE_S && w.job_id;
      })
      .map((w) => w.job_id as string),
  );
  // BOTH halves are required, and the second one is the whole lesson of
  // this page's first day. Without it the callout fired on every job a
  // non-reporting worker was busily and correctly processing — a red
  // warning printed over healthy work, on the page whose entire purpose is
  // telling a real stall apart from a quiet one.
  return doc.running.filter(
    (j) => !claimed.has(j.id) && !jobIsMoving(j, now),
  );
}

/** "12 waiting, oldest 2h 46m" — the queue in one line. */
export function queueSummary(rows: WaitingRow[]): string {
  if (rows.length === 0) return "Nothing waiting.";
  const oldest = rows[0];
  return `${rows.length} waiting, oldest ${durationLabel(oldest.waited)}`;
}

/** "9 done, no failures in the last day." */
export function throughputSummary(day: ProcessingOverview["day"]): string {
  const done = day?.done ?? 0;
  const failed = day?.failed ?? 0;
  const cancelled = day?.cancelled ?? 0;
  const parts = [`${done} finished`];
  parts.push(failed === 0 ? "none failed" : `${failed} failed`);
  if (cancelled > 0) parts.push(`${cancelled} cancelled`);
  return `${parts.join(", ")} in the last day.`;
}

/* -------------------------------------------------------------------------
 * The hub line
 * ---------------------------------------------------------------------- */

export interface ProcessingCounts {
  queued: number;
  running: number;
  oldest_wait_s: number;
  /** Any Mac worker beating within the last 90 seconds. */
  reporting: boolean;
  /** Any job a worker touched recently: one in flight advancing, or one
   *  just finished or failed. Work is demonstrably happening, whether or
   *  not anything is reporting. Includes finished jobs on purpose — see
   *  the migration: without them the card flicked to an alarm in the gap
   *  between one job ending and the next starting. */
  moving: boolean;
  /** Whether any Mac worker has EVER reported. False means reporting has
   *  never been switched on here, which is a setup gap and not an outage,
   *  and the card must not cry wolf about it. */
  ever_reported: boolean;
}

/**
 * What the Processing card says on /admin. The states it has to keep
 * apart: working, working with a backlog, idle, not answering, and not
 * visible at all. The last two are the ones that used to read the same,
 * and only one of them is an outage.
 */
export function processingHubDetail(
  counts: ProcessingCounts | null,
): { text: string; attention: boolean } | null {
  if (!counts) return null;
  const backedUp = counts.oldest_wait_s >= WAIT_ATTENTION_S;
  const queued = counts.queued > 0 ? ` · ${counts.queued} waiting` : "";
  const oldest = backedUp
    ? `, oldest ${durationLabel(counts.oldest_wait_s)}`
    : "";

  // Something is demonstrably working — it beat, or a job moved. Whether
  // the worker ALSO reports is a detail for the page itself, and no
  // reason to put an alarm on the hub.
  if (counts.reporting || counts.moving) {
    if (counts.running === 0 && counts.queued === 0) {
      return { text: "Idle", attention: false };
    }
    return {
      text: `${counts.running > 0 ? "Working" : "Idle"}${queued}${oldest}`,
      attention: backedUp,
    };
  }

  // Nothing beating and nothing moving. A worker that has reported before
  // and stopped is an outage; one that has never reported is a worker
  // this card cannot see, which is a different sentence and not a red one
  // on its own.
  const head = counts.ever_reported ? "Not responding" : "Status unknown";
  if (counts.running > 0) {
    return {
      text: `${head} · ${counts.running} in flight${queued}`,
      attention: true,
    };
  }
  if (counts.queued > 0) {
    return { text: `${head}${queued}${oldest}`, attention: true };
  }
  // Nothing running, nothing waiting, nothing to worry about yet.
  return { text: head, attention: counts.ever_reported };
}

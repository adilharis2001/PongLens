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

export type WorkerState =
  | "working"
  | "idle"
  /** Silent, but a job is still marked in flight — died mid-job, or is
   *  running code from before the pulse existed. Ambiguous on purpose. */
  | "not-reporting"
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
    staleAfterS?: number;
  },
): WorkerState {
  if (opts.off) return "off";
  const stale = opts.staleAfterS ?? BEAT_STALE_S;
  const age = pulse ? secondsBetween(pulse.beat_at, opts.now) : null;
  if (age !== null && age <= stale) {
    return pulse?.job_id ? "working" : "idle";
  }
  return opts.jobInFlight ? "not-reporting" : "not-running";
}

export interface WorkerRow {
  key: string;
  /** "Mac Studio · main" */
  title: string;
  state: WorkerState;
  /** The one-line answer: what it is doing, or why it is not. */
  detail: string;
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
  // Only reached if a row is working without a pulse to describe it,
  // which the states above make impossible. Kept so the map is total.
  working: "Working.",
  idle: "Waiting for work",
  "not-reporting":
    "Silent, but a job is still marked in flight. Either it stopped mid-job, or it is running code from before it learned to report.",
  "not-running": "Nothing is running here.",
  off: "Switched off.",
};

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
  const rows: WorkerRow[] = [];

  const fromPulse = (
    key: string,
    title: string,
    opts: { off?: boolean; jobInFlight?: boolean } = {},
  ): WorkerRow => {
    const p = pulses.get(key) ?? null;
    pulses.delete(key);
    const state = workerState(p, { now, ...opts });
    return {
      key,
      title,
      state,
      detail:
        state === "working" && p ? pulseDetail(p, now) : STATE_DETAIL[state],
      note: state === "working" ? p?.stage_note ?? null : null,
      pct: state === "working" ? p?.stage_pct ?? null : null,
      jobFor:
        state === "working" && p
          ? secondsBetween(p.job_created_at ?? p.beat_at, now)
          : null,
      matchId: state === "working" ? p?.match_id ?? null : null,
      player: state === "working" ? p?.player ?? null : null,
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
  rows.push(fromPulse("mac:main", "Mac Studio · main", { jobInFlight }));

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
      { now, staleAfterS: SLOW_BEAT_STALE_S },
    );
    return {
      key,
      title,
      // The lesson heartbeat says a process is alive; it does not say
      // which video it has. "Idle" would be a claim this signal cannot
      // make, so a live one reads as Running.
      state,
      detail: state === "idle" ? detail : STATE_DETAIL["not-running"],
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
 * Jobs the rows say are running that no live worker has claimed.
 *
 * This is the state the page was built for. `jobs.progress` and
 * `jobs.updated_at` both freeze for hours on a healthy worker — placement
 * writes 5, then 20, then 100 — so a row sitting at 20% since 16:11 is
 * either three hours of honest work or a worker that died at 16:11, and
 * the columns cannot tell you which. When nothing is pulsing, these are
 * the jobs at stake, and the page says exactly that rather than picking
 * an answer.
 */
export function unclaimedRunning(
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
  return doc.running.filter((j) => !claimed.has(j.id));
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
}

/**
 * What the Processing card says on /admin. The states it has to keep
 * apart: working normally, working with a backlog, idle, and silent —
 * and silence while a job is in flight is the one that earns the accent,
 * because it is the only one that might be an outage.
 */
export function processingHubDetail(
  counts: ProcessingCounts | null,
): { text: string; attention: boolean } | null {
  if (!counts) return null;
  if (!counts.reporting) {
    if (counts.running > 0) {
      return { text: "Not reporting · 1 job in flight", attention: true };
    }
    if (counts.queued > 0) {
      return {
        text: `Not reporting · ${counts.queued} waiting`,
        attention: true,
      };
    }
    return { text: "Not reporting", attention: true };
  }
  const backedUp = counts.oldest_wait_s >= WAIT_ATTENTION_S;
  if (counts.running === 0 && counts.queued === 0) {
    return { text: "Idle", attention: false };
  }
  const queued = counts.queued > 0 ? ` · ${counts.queued} waiting` : "";
  const oldest = backedUp
    ? `, oldest ${durationLabel(counts.oldest_wait_s)}`
    : "";
  return {
    text: `${counts.running > 0 ? "Working" : "Idle"}${queued}${oldest}`,
    attention: backedUp,
  };
}

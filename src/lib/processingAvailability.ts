export type ServiceState = "available" | "unavailable" | "maintenance" | "unknown";
export type ServiceLane = "main" | "fast" | "hand";
export type AvailabilityContext = "saved_match" | "saved_video" | "saved_idle" | "hand" | "queued_work" | "import" | "uploading" | "before_upload" | "before_import" | "fast" | "export";
export interface ProcessingServiceStatus {
  main: ServiceState;
  fast: ServiceState;
  hand: ServiceState;
  clip_lane: "main" | "fast";
  observed_at: string | null;
}
export const UNKNOWN_SERVICE: ProcessingServiceStatus = {
  main: "unknown", fast: "unknown", hand: "unknown", clip_lane: "main", observed_at: null,
};
export function normalizeServiceStatus(value: unknown, now = Date.now()): ProcessingServiceStatus {
  if (!value || typeof value !== "object") return UNKNOWN_SERVICE;
  const row = value as Record<string, unknown>;
  if (row.clip_lane !== "main" && row.clip_lane !== "fast") return UNKNOWN_SERVICE;
  const observed = typeof row.observed_at === "string" ? Date.parse(row.observed_at) : NaN;
  if (!Number.isFinite(observed) || now - observed > 90_000 || observed - now > 30_000) return UNKNOWN_SERVICE;
  const state = (v: unknown): ServiceState => ["available", "unavailable", "maintenance"].includes(String(v)) ? v as ServiceState : "unknown";
  return { main: state(row.main), fast: state(row.fast), hand: state(row.hand),
    clip_lane: row.clip_lane === "fast" ? "fast" : "main", observed_at: row.observed_at as string };
}

/**
 * Mirrors the database's job_queue_name, the one routing every job is
 * queued by (20260925145751); status comes from the server, not this map.
 *
 *   re-cuts, a video's content check and vertical exports ("v:" reels)
 *     follow app_config.reclip_lane: the fast lane when it says fast
 *   a hand cut, and the detailed analysis and highlights reel of a match
 *     cut by hand, run on the hand lane
 *   everything else runs on the main lane
 *
 * `handCutMatch` is matches.cut_source = 'manual' for the job's match. The
 * notices used to read the main lane for content checks and for a hand
 * cut's follow-ups (post-rollout audit S1, 2026-09-26), so an idle main
 * lane hid a stopped one and the other way round.
 */
export function serviceLane(
  kind: string | null | undefined,
  clipLane: "main" | "fast" = "main",
  scope = "",
  handCutMatch = false,
): ServiceLane {
  if (kind === "reclip" || kind === "content_check" || (kind === "reel" && scope.startsWith("v:"))) return clipLane;
  if (kind === "hand_cut") return "hand";
  if (handCutMatch && (kind === "placement_generate" || kind === "placement_retry" || (kind === "reel" && scope === "highlights"))) {
    return "hand";
  }
  return "main";
}

export function processingContext(kind: string | null | undefined, videoSaved: boolean): AvailabilityContext {
  if (kind === "youtube_import" && !videoSaved) return "import";
  if (kind === "content_check") return "saved_video";
  if (kind === "hand_cut") return "hand";
  return kind === "deadspace_cut" ? "saved_match" : "queued_work";
}

/** A saved automatic cut and a hand cut both end in the ready email. */
export function processingExitMessage(context: AvailabilityContext): string {
  return context === "saved_match" || context === "hand" ? "You can leave this page. We email you when the match is ready."
    : "You can leave this page and check back later.";
}

export function importedProcessingContext(matchStatus: string | null | undefined, job: { kind: string | null; status: string } | null): AvailabilityContext {
  if (!matchStatus) return "import";
  if (job?.status === "queued" || job?.status === "processing") return processingContext(job.kind, true);
  return "saved_idle";
}

export function selectImportedProcessingJob<T extends { kind: string | null; status: string }>(jobs: T[]): T | null {
  const active = jobs.filter((job) => job.status === "queued" || job.status === "processing");
  return active.find((job) => job.kind === "deadspace_cut" || job.kind === "hand_cut")
    ?? active.find((job) => job.kind === "content_check") ?? null;
}

export interface ProcessingWork {
  kind: string | null | undefined;
  status: string;
  videoSaved: boolean;
  lane?: ServiceLane;
  stageLabel?: string | null;
  /** A hand cut the owner's phone is cutting. No server lane is involved
   *  until the phone hands it over, so no lane's outage blocks it. */
  onDevice?: boolean;
  /** The job's match was cut by hand: its analysis and highlights run on
   *  the hand lane (serviceLane). */
  handCutMatch?: boolean;
}

/** Only blocked work contributes to the outage notice; other lanes keep their
 * own progress and email contract. Orphan imports have no saved-video claim. */
export function summarizeProcessingWork(services: ProcessingServiceStatus, work: ProcessingWork[]) {
  const active = work.filter((job) => job.status === "queued" || job.status === "processing");
  const blocked = active.filter((job) => !job.onDevice
    && availabilityNotice(services[job.lane ?? serviceLane(job.kind, services.clip_lane, "", job.handCutMatch)], "queued_work"));
  const continuing = active.filter((job) => !blocked.includes(job));
  const first = continuing[0];
  const queued = continuing.length > 0 && continuing.every((job) => job.status === "queued");
  const continuingLabel = continuing.length === 1 ? first.stageLabel
    ?? (first.kind === "youtube_import" ? queued ? "Waiting to import video" : "Importing video"
      : first.kind === "hand_cut" ? first.onDevice ? "Cutting the video" : queued ? "Waiting to prepare clips" : "Preparing clips"
      : queued ? "Waiting to process" : "Your match is processing")
    : `${continuing.length} videos are ${queued ? "waiting to process" : "processing"}`;
  const sendsEmail = continuing.length > 0 && continuing.every((job) => (job.kind === "deadspace_cut" || job.kind === "hand_cut") && job.videoSaved);
  const firstBlocked = blocked[0];
  const notice = firstBlocked ? availabilityNotice(
    services[firstBlocked.lane ?? serviceLane(firstBlocked.kind, services.clip_lane, "", firstBlocked.handCutMatch)],
    blocked.length === 1 ? processingContext(firstBlocked.kind, firstBlocked.videoSaved) : "queued_work",
  ) : null;
  return { blockedCount: blocked.length, continuingCount: continuing.length, continuingLabel, queued, notice,
    exitMessage: sendsEmail ? continuing.length === 1 ? "We’ll email you when your match is ready." : "We’ll email you when your matches are ready." : processingExitMessage("queued_work") };
}

export function availabilityNotice(state: unknown, context: AvailabilityContext): { title: string; body: string } | null {
  if (state !== "unavailable" && state !== "maintenance") return null;
  const title = context === "export" ? "Video exports are temporarily unavailable" : context === "fast"
    ? "Clip updates and vertical exports are temporarily unavailable"
    : state === "maintenance" ? "Video processing is paused for maintenance" : "Video processing is temporarily unavailable";
  const bodies: Record<AvailabilityContext, string> = {
    saved_match: "Your video is saved and queued. Processing will resume automatically when service is restored. You can leave this page. We’ll email you when your match is ready.",
    saved_video: "Your video is saved. Its video check will continue when service is restored. You can leave this page.",
    saved_idle: "Your video is saved. You can request processing, but it will not start until service is restored.",
    hand: "Your video is saved. Clip preparation will resume automatically when service is restored. You can leave this page. We’ll email you when your match is ready.",
    queued_work: "Your processing requests are saved. Work on the affected videos will continue when service is restored. You can leave this page.",
    import: "Your import request is queued and will continue when service is restored. You can leave this page.",
    uploading: "Keep this page open until your upload finishes. Processing requests will wait until service is restored.",
    before_upload: "You can still upload a video. Processing requests will wait until service is restored.",
    before_import: "You can still submit a YouTube link. Import requests will wait until service is restored.",
    fast: "Any requested clip updates or vertical exports will continue when service is restored. Your existing videos and scoring remain available.",
    export: "Any requested exports will continue when service is restored. Videos that are already prepared can still be downloaded.",
  };
  return { title, body: bodies[context] };
}

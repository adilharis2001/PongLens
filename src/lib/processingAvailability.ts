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
  const observed = typeof row.observed_at === "string" ? Date.parse(row.observed_at) : NaN;
  if (!Number.isFinite(observed) || now - observed > 90_000 || observed - now > 30_000) return UNKNOWN_SERVICE;
  const state = (v: unknown): ServiceState => ["available", "unavailable", "maintenance"].includes(String(v)) ? v as ServiceState : "unknown";
  return { main: state(row.main), fast: state(row.fast), hand: state(row.hand),
    clip_lane: row.clip_lane === "fast" ? "fast" : "main", observed_at: row.observed_at as string };
}

/** Mirrors enqueue_job's routing; status comes from the server, not this map. */
export function serviceLane(kind: string | null | undefined, clipLane: "main" | "fast" = "main", scope = ""): ServiceLane {
  if (kind === "hand_cut") return "hand";
  if (kind === "reclip" || (kind === "reel" && scope.startsWith("v:"))) return clipLane;
  return "main";
}

export function processingContext(kind: string | null | undefined, videoSaved: boolean): AvailabilityContext {
  if (kind === "youtube_import" && !videoSaved) return "import";
  if (kind === "content_check") return "saved_video";
  if (kind === "hand_cut") return "hand";
  return kind === "deadspace_cut" ? "saved_match" : "queued_work";
}

export function processingExitMessage(context: AvailabilityContext): string {
  return context === "saved_match" ? "You can leave this page. We email you when the match is ready."
    : "You can leave this page and check back later.";
}

export function availabilityNotice(state: unknown, context: AvailabilityContext): { title: string; body: string } | null {
  if (state !== "unavailable" && state !== "maintenance") return null;
  const title = context === "export" ? "Video exports are temporarily unavailable" : context === "fast"
    ? "Clip updates and exports are temporarily unavailable"
    : state === "maintenance" ? "Video processing is paused for maintenance" : "Video processing is temporarily unavailable";
  const bodies: Record<AvailabilityContext, string> = {
    saved_match: "Your video is saved and queued. Processing will resume automatically when service is restored. You can leave this page. We’ll email you when your match is ready.",
    saved_video: "Your video is saved. Its video check will continue when service is restored. You can leave this page.",
    saved_idle: "Your video is saved. You can request processing, but it will not start until service is restored.",
    hand: "Your video is saved. Clip preparation will resume automatically when service is restored. You can leave this page.",
    queued_work: "Your processing requests are saved. Work on the affected videos will continue when service is restored. You can leave this page.",
    import: "Your import request is queued and will continue when service is restored. You can leave this page.",
    uploading: "Keep this page open until your upload finishes. Processing requests will wait until service is restored.",
    before_upload: "You can still upload a video. Processing requests will wait until service is restored.",
    before_import: "You can still submit a YouTube link. Import requests will wait until service is restored.",
    fast: "Any requested clip updates or exports will continue when service is restored. Your existing videos and scoring remain available.",
    export: "Any requested exports will continue when service is restored. Videos that are already prepared can still be downloaded.",
  };
  return { title, body: bodies[context] };
}

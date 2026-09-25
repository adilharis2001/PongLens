import type { ProcessingEstimate } from "./processingEstimate";

/** Owner feedback carries observations and an optional server-owned rough estimate. */
export interface ProcessingFeedback {
  match_id: string;
  job_id: string | null;
  job_status: string | null;
  job_kind: string | null;
  stage: string | null;
  worker_state: "fresh" | "missing" | "silent" | null;
  service_state?: "available" | "unavailable" | "maintenance" | "unknown";
  lane?: "main" | "fast" | "hand";
  estimate?: ProcessingEstimate | null;
  checked_at: string | null;
  window_start_s: number | null;
  window_end_s: number | null;
  camera_check: { status: string; changes?: unknown[] } | null;
  /** A hand cut the owner's iPhone cut or is cutting (20260925061009):
   *  'device' while the phone works, 'verify' once the Mac is checking it,
   *  'mac' when the Mac took it over (the phone gave it up, or stopped
   *  reporting for 15 minutes: 20260925200000). Absent on every other job. */
  cutter?: "device" | "mac" | null;
  phase?: "device" | "verify" | "mac" | "released" | null;
  /** The phone's own stage, and when it last reported (its claim when it
   *  never has), while phase is 'device'. The player's words for the stage
   *  are the server's (HAND_CUT_STAGES); device_seen_at is carried by the
   *  RPC and read by nothing a player sees. */
  device_stage?: string | null;
  device_seen_at?: string | null;
}

/** The owner's phone is cutting this match; no server lane is involved yet. */
export function onDevice(feedback: Pick<ProcessingFeedback, "job_kind" | "phase"> | null | undefined): boolean {
  return feedback?.job_kind === "hand_cut" && feedback.phase === "device";
}

/**
 * A hand cut's stages, named the way a player would say them. None of them
 * finds points or removes dead time: the owner's marks already did both.
 *
 * The same words wherever the cut runs (Adil, 2026-09-25). A hand cut can
 * be cut on the owner's iPhone or on the server, and move from one to the
 * other without warning when the phone cannot finish, so a player is never
 * told which: the phone's encode reads as the server's cut, its upload as
 * the server's upload, and the server's check of the phone's work as the
 * save it ends in. /admin/processing keeps the distinction; this does not.
 */
const HAND_CUT_STAGES: Record<string, string> = {
  marks: "Reading the marks",
  download: "Preparing video",
  cut: "Cutting the video",
  upload: "Uploading the result",
  points: "Building the points",
  publish: "Saving the match",
  // The phone (report_device_hand_cut). A pause is still the cut, from
  // the player's side: the phone only pauses while encoding, and a phone
  // that stays quiet is handed to the server anyway.
  device_cut: "Cutting the video",
  device_clips: "Cutting the video",
  device_paused: "Cutting the video",
  device_upload: "Uploading the result",
  // The server checking what the phone sent, then saving it.
  device_verify: "Saving the match",
};

export function processingStageLabel(feedback: ProcessingFeedback | null): string | null {
  if (feedback?.job_kind === "content_check") return null;
  if (!feedback || !["queued", "processing"].includes(feedback.job_status ?? "")) return null;
  // The phone is doing the work, so the server's lanes and pulses say
  // nothing about it: its own stage is the whole answer.
  if (onDevice(feedback)) return HAND_CUT_STAGES[feedback.device_stage ?? ""] ?? "Cutting the video";
  if (feedback.service_state === "maintenance") return "Paused for maintenance";
  if (feedback.service_state === "unavailable") return "Processing is delayed";
  if (feedback.worker_state === "silent") return "Processing is delayed";
  const handCut = feedback.job_kind === "hand_cut";
  if (feedback.job_status === "queued") {
    return handCut ? "Waiting to prepare clips" : "Waiting to process";
  }
  if (feedback.worker_state !== "fresh") return null;
  if (handCut) return HAND_CUT_STAGES[feedback.stage ?? ""] ?? "Preparing clips";
  const stages: Record<string, string> = {
    content_check: "Processing your match",
    camera_check: "Checking the camera view",
    download: "Preparing video",
    import: "Importing video",
    trim: "Preparing video",
    ball: "Finding the ball",
    points: "Finding the points",
    bodies: "Finding the points",
    cut: "Removing dead time",
    publish: "Preparing your match",
  };
  return stages[feedback.stage ?? ""] ?? "Processing your match";
}

export function cameraViewWarning(
  feedback: ProcessingFeedback | null,
  trimStart = 0,
  trimEnd = Infinity,
): string | null {
  if (!Number.isFinite(trimStart) || trimStart < 0 || Number.isNaN(trimEnd) || trimEnd <= trimStart) return null;
  if (feedback?.camera_check?.status !== "changed" || !Array.isArray(feedback.camera_check.changes)) return null;
  const inside = feedback.camera_check.changes.some((value) => {
    if (!value || typeof value !== "object") return false;
    const { before_s: before, after_s: after } = value as Record<string, unknown>;
    return typeof before === "number" && typeof after === "number"
      && Number.isFinite(before) && Number.isFinite(after)
      && before >= 0 && before < after && before >= trimStart && after <= trimEnd;
  });
  if (!inside) return null;
  const start = feedback.window_start_s;
  const end = feedback.window_end_s;
  if (typeof start === "number" && typeof end === "number"
      && Number.isFinite(start) && Number.isFinite(end)
      && start >= 0 && end > start && end - start <= 10) {
    return "The camera view changes during this recording. Keep the camera in a fixed position with the same table in view.";
  }
  return "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table.";
}

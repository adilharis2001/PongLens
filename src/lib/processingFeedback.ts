/** Owner feedback describes observations, never an unvalidated completion time. */
export interface ProcessingFeedback {
  match_id: string;
  job_id: string | null;
  job_status: string | null;
  job_kind: string | null;
  stage: string | null;
  worker_state: "fresh" | "missing" | "silent" | null;
  checked_at: string | null;
  window_start_s: number | null;
  window_end_s: number | null;
  camera_check: { status: string; changes?: unknown[] } | null;
}

export function processingStageLabel(feedback: ProcessingFeedback | null): string | null {
  if (!feedback || !["queued", "processing"].includes(feedback.job_status ?? "")) return null;
  const checking = feedback.job_kind === "content_check";
  if (feedback.worker_state === "silent") return checking ? "Video check is delayed" : "Processing is delayed";
  if (feedback.job_status === "queued") return checking ? "Waiting to check video" : "Waiting to process";
  if (feedback.worker_state !== "fresh") return null;
  const stages: Record<string, string> = {
    content_check: "Checking video",
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
  return stages[feedback.stage ?? ""] ?? (checking ? "Checking video" : "Processing your match");
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
  return inside
    ? "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table."
    : null;
}

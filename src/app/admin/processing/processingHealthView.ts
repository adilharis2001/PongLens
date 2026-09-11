export interface ProcessingRun {
  attempt_key: string;
  job_id: string;
  match_id: string | null;
  release_id: string | null;
  body_model: string | null;
  requested_pipeline: string;
  delivered_pipeline: string | null;
  status: string;
  reason_code: string | null;
  started_at: string;
  finished_at: string | null;
  details: { body?: { status?: string }; edges?: { status?: string } };
}
export interface ProcessingIncident {
  id: string;
  kind: string;
  release_id: string;
  opened_at: string;
  recovered_at: string | null;
  details: { affected_jobs?: number };
}
export interface ProcessingHealth {
  as_of: string;
  control: { expected_after: string | null; monitor_at: string | null };
  runs: ProcessingRun[];
  incidents: ProcessingIncident[];
  missing: { job_id: string; finished_at: string }[];
}
const OUTCOMES: Record<string, string> = {
  running: "Processing", used: "Bodies used", refused: "Bodies declined",
  degraded: "Processing problem", unknown: "Outcome unknown",
  not_requested: "Bodies not requested", failed: "Processing failed",
};
const REASONS: Record<string, string> = {
  low_player_coverage: "Both players were not visible often enough.",
  insufficient_pose_samples: "There were too few player samples.",
  no_table: "No usable table or activity area was found.",
  no_play_found: "No play was found in the player movements.",
  no_body_cards: "The body pass produced no points.",
  players_file_missing: "The player-reading result was missing.",
  pose_exception: "Reading the players failed.", pose_timeout: "Reading the players took too long.",
  assembly_exception: "Building the body points failed.", assembly_timeout: "Building the body points took too long.",
  body_exception: "Building the body points failed.", body_timeout: "Building the body points took too long.",
  serve_v3_exception: "Serve refinement failed. The body points were kept.",
  serve_v3_timeout: "Serve refinement took too long. The body points were kept.",
  config_read_failed: "Some processing settings could not be read.",
  missing_body_outcome: "No body-stage outcome was recorded.",
  missing_final_outcome: "The job ended without a final processing record.",
  metadata_write_failed: "The processing outcome could not be attached to the match.",
  publication_failed: "The point-by-point result could not be published.",
  processing_failed: "Processing stopped before the point result was ready.",
};
export const outcomeLabel = (status: string) => OUTCOMES[status] ?? status;
export const reasonLabel = (reason: string | null) => reason ? REASONS[reason] ?? reason : null;
export const pipelineLabel = (pipeline: string | null) => pipeline === "bodies" ? "Bodies"
  : pipeline === "v1" ? "Ball V1" : pipeline === "v2" ? "Ball V2" : pipeline ?? "Not recorded";
export function monitorLabel(doc: ProcessingHealth, now: Date): string {
  if (!doc.control.expected_after) return "Not activated yet";
  if (!doc.control.monitor_at) return "Monitor status unknown";
  const age = now.getTime() - new Date(doc.control.monitor_at).getTime();
  if (!Number.isFinite(age)) return "Monitor status unknown";
  return age > 180_000 ? "Monitor has stopped reporting" : "Monitoring";
}

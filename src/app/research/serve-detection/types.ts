import type {
  ServeDetectionHumanLabel,
  ServeEventType,
} from "@/lib/research/serveDetection";

export type DetectorStatus =
  | "high_confidence"
  | "needs_review"
  | "unavailable";

export interface ServeLikelyAction {
  id: string;
  suggested_type: ServeEventType;
  time_s: number;
  origin: "detector" | "placement_candidate";
  confidence: number | null;
}

export interface ServeDetectionProposal {
  schema_version: 1;
  detector: {
    version: number | null;
    status: DetectorStatus;
    reason: string;
    server_side: "near" | "far" | null;
    confidence: number;
    score_margin: number | null;
  };
  likely_actions: ServeLikelyAction[];
  video: {
    duration_s: number;
    fps: number;
    frame_count: number;
  };
  scored_server: {
    player: "user" | "opponent" | null;
    side: "near" | "far" | null;
    source: "rotation" | "override" | "unresolved";
  };
  service_motion?: {
    status?: "high_confidence" | "withheld" | "unavailable";
    side?: "near" | "far" | null;
    onset_t: number | null;
    contact_t: number | null;
    first_bounce_t: number | null;
    second_bounce_t: number | null;
  };
}

export const SERVE_FOLLOWUP_REASONS = [
  "occluded",
  "high_confidence_wrong_server",
  "correct_control",
] as const;

export type ServeFollowupReason =
  (typeof SERVE_FOLLOWUP_REASONS)[number];

export interface ServeFollowupPrefill {
  included: boolean;
  order: number | null;
  reasons: ServeFollowupReason[];
}

export interface ServeOnsetPrefill {
  included: boolean;
  order: number | null;
  stratum: "visible" | "occluded" | "prior_wrong_server" | null;
  model_sha256: string;
}

export interface ServeResearchSource {
  id: string;
  source_point_idx: number;
  match_label: string;
  duration_s: number;
  proposal: ServeDetectionProposal;
  prefill: {
    match_key?: string;
    detector_status?: DetectorStatus;
    followup_v2?: ServeFollowupPrefill;
    onset_v3?: ServeOnsetPrefill;
    [key: string]: unknown;
  };
}

export interface ServeResearchAssignment {
  id: string;
  batch_id: string;
  source_id: string;
  sequence: number;
  status: "not_started" | "in_progress" | "submitted";
  human_label: ServeDetectionHumanLabel | null;
  review_metrics: {
    time_spent_s?: number;
    playback_count?: number;
    answer_changes?: number;
    video_completed?: boolean;
  } | null;
  started_at: string | null;
  submitted_at: string | null;
  source: ServeResearchSource;
}

export interface ServeQueueFilter {
  match: string | "all";
  status: DetectorStatus | "all";
}

export type ServeReviewMode = "onset" | "followup" | "original";

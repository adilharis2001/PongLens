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
}

export interface ServeResearchSource {
  id: string;
  source_point_idx: number;
  match_label: string;
  duration_s: number;
  proposal: ServeDetectionProposal;
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

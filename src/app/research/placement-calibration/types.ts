import type {
  PlacementCalibrationHumanLabel,
  PlacementCalibrationProposal,
} from "@/lib/research/placementCalibration";

export interface PlacementResearchAssignment {
  id: string;
  batch_id: string;
  source_id: string;
  sequence: number;
  status: "not_started" | "in_progress" | "submitted";
  human_label: Partial<PlacementCalibrationHumanLabel> | null;
  review_metrics: {
    time_spent_s?: number;
    playback_count?: number;
    answer_changes?: number;
    video_completed?: boolean;
  } | null;
  started_at: string | null;
  submitted_at: string | null;
  source: {
    id: string;
    source_point_idx: number;
    match_label: string;
    player_near_name: string | null;
    player_far_name: string | null;
    venue_label: string | null;
    duration_s: number;
    proposal: PlacementCalibrationProposal;
  };
}

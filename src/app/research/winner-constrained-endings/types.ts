import type { WinnerConstrainedEndingHumanLabel } from "@/lib/research/winnerConstrainedEnding";

export type ScoredPlayer = "user" | "opponent";
export type PhysicalSide = "near" | "far";

export interface ScoringParticipant {
  player: ScoredPlayer;
  name: string;
  side: PhysicalSide;
}

export interface WinnerConstrainedScoring {
  server: ScoringParticipant;
  winner: ScoringParticipant;
}

export interface WinnerConstrainedEndingProposal {
  schema_version: 1;
  match: { label: string; venue: string };
  scoring: WinnerConstrainedScoring;
  detected_serve_boundary: { available: boolean };
  automatic_prediction_withheld: true;
  video: { duration_s: number; fps: number; frame_count: number };
}

export interface WinnerConstrainedResearchSource {
  id: string;
  source_point_idx: number;
  match_label: string;
  duration_s: number;
  proposal: WinnerConstrainedEndingProposal;
}

export interface WinnerConstrainedResearchAssignment {
  id: string;
  batch_id: string;
  source_id: string;
  sequence: number;
  status: "not_started" | "in_progress" | "submitted";
  human_label: WinnerConstrainedEndingHumanLabel | null;
  review_metrics: {
    time_spent_s?: number;
    playback_count?: number;
    answer_changes?: number;
    video_completed?: boolean;
  } | null;
  started_at: string | null;
  submitted_at: string | null;
  source: WinnerConstrainedResearchSource;
}

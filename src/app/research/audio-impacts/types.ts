import type {
  AudioImpactCandidate,
  AudioImpactHumanLabel,
} from "@/lib/research/audioImpacts";

export type AudioImpactVenueCategory = "pingpod" | "westchester" | "lyttc";
export type AudioImpactRound = "A" | "B" | "C";

export interface AudioImpactProposalCandidate extends AudioImpactCandidate {
  detector_scores: Record<string, number>;
}

export interface AudioImpactProposal {
  schema_version: 1;
  audio: {
    detector_version: string;
    sample_rate: 44_100 | 48_000;
    duration_s: number;
    waveform_bin_ms: number;
    waveform: number[];
    candidates: AudioImpactProposalCandidate[];
    low_threshold_candidates: AudioImpactCandidate[];
  };
  video: {
    duration_s: number;
    width: number;
    height: number;
  };
  automatic_prediction_withheld: true;
}

export interface AudioImpactPrefill {
  venue_category: AudioImpactVenueCategory;
  round: AudioImpactRound;
  split: "development" | "sealed_evaluation";
  source_recording_id: string;
  source_media_sha256: string;
  point_id: string;
  cohort_manifest_sha256: string;
  detector_manifest_sha256: string;
  selection_score?: number | null;
  acquisition_model_sha256?: string | null;
}

export interface AudioImpactResearchSource {
  id: string;
  source_point_idx: number;
  match_label: string;
  venue_label: string | null;
  duration_s: number;
  proposal: AudioImpactProposal;
  prefill: AudioImpactPrefill;
}

export interface AudioImpactReviewMetrics {
  time_spent_s?: number;
  playback_count?: number;
  answer_changes?: number;
  replay_half_speed_count?: number;
  replay_quarter_speed_count?: number;
  full_context_played?: boolean;
  video_completed?: boolean;
  media_unavailable?: boolean;
  media_error?: string;
}

export interface AudioImpactResearchAssignment {
  id: string;
  batch_id: string;
  source_id: string;
  sequence: number;
  status: "not_started" | "in_progress" | "submitted";
  human_label: AudioImpactHumanLabel | null;
  review_metrics: AudioImpactReviewMetrics | null;
  started_at: string | null;
  submitted_at: string | null;
  source: AudioImpactResearchSource;
}

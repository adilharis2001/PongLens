import type {
  ResearchEventOrigin,
  ResearchHumanLabel,
} from "./labeling";

export interface ResearchAudioCandidate {
  id: string;
  time_s: number;
  confidence: number;
  hf_energy: number;
}

export interface ResearchVisualCandidate {
  id: string;
  source_id: string;
  time_s: number;
  kind: string;
  kinds: string[];
  side?: "near" | "far" | null;
  u?: number | null;
  v?: number | null;
  x_norm?: number | null;
  y_norm?: number | null;
  confidence?: number | null;
}

export interface ResearchProposalMarker {
  id: string;
  time_s: number;
  origin: ResearchEventOrigin;
  audio_id: string | null;
  visual_id: string | null;
}

export interface ResearchProposal {
  schema_version: 1;
  stratum: string;
  video: { duration_s: number; width: number; height: number };
  audio: {
    detector_version: string;
    sample_rate: number;
    duration_s: number;
    waveform_bin_ms: number;
    waveform: number[];
    high_frequency_envelope: number[];
    candidates: ResearchAudioCandidate[];
  };
  visual_candidates: ResearchVisualCandidate[];
  markers: ResearchProposalMarker[];
  placement_status: string | null;
}

export interface ResearchPrefill {
  server?: "user" | "opponent" | null;
  winner?: "user" | "opponent" | "let" | null;
  confirmed_how?: string | null;
  suggestion?: Record<string, unknown> | null;
  direction?: string | null;
  serve_spin?: string | null;
  serve_sidespin?: boolean | null;
  serve_length?: string | null;
}

export interface ResearchSource {
  id: string;
  source_point_idx: number;
  match_label: string;
  player_near_name: string | null;
  player_far_name: string | null;
  venue_label: string | null;
  duration_s: number;
  proposal: ResearchProposal;
  prefill: ResearchPrefill;
}

export interface ResearchAssignment {
  id: string;
  batch_id: string;
  source_id: string;
  sequence: number;
  status: "not_started" | "in_progress" | "submitted";
  human_label: Partial<ResearchHumanLabel> | null;
  review_metrics: {
    time_spent_s?: number;
    playback_count?: number;
    answer_changes?: number;
    video_completed?: boolean;
  } | null;
  started_at: string | null;
  submitted_at: string | null;
  source: ResearchSource;
}

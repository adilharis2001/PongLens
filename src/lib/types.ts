export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface JobOptions {
  points?: boolean;
  placement?: boolean;
  strictness?: "tight" | "normal" | "loose";
}

export interface Job {
  id: string;
  user_id: string;
  status: JobStatus;
  kind: string;
  input_path: string | null;
  original_name: string | null;
  result_path: string | null;
  error: string | null;
  progress: number;
  options: JobOptions | null;
  created_at: string;
  updated_at: string;
}

export type MatchStatus = "processing" | "ready" | "failed";

export interface Match {
  id: string;
  user_id: string;
  job_id: string | null;
  opponent_name: string | null;
  played_at: string;
  cut_path: string | null;
  match_json_path: string | null;
  status: MatchStatus;
  // Player tagging: which side of the table the uploader played from.
  // null = not confirmed yet; server/winner chips stay neutral until set.
  user_side: "near" | "far" | null;
  player_near_name: string | null;
  player_far_name: string | null;
  created_at: string;
}

export interface PlacementBounce {
  t: number;
  u: number; // meters across the table width (0..1.525)
  v: number; // meters along the table length (0..2.74)
  side: "near" | "far";
}

export interface PointSuggestion {
  winner: "user" | "opponent";
  how: string;
  n_hits?: number;
  reason?: string;
}

export interface Point {
  id: string;
  match_id: string;
  idx: number;
  t0: number | null;
  t1: number | null;
  clip_path: string | null;
  server: "user" | "opponent" | null;
  placement: { bounces: PlacementBounce[] } | null;
  suggestion: PointSuggestion | null;
  confirmed_winner: "user" | "opponent" | null;
  confirmed_how: string | null;
  starred: boolean;
}

// Returned by the player_coach_links() RPC (player's own sharing links,
// coach display fields joined server-side).
export interface CoachLinkRow {
  id: string;
  invite_token: string;
  scope_match_id: string | null;
  status: "pending" | "accepted" | "revoked";
  coach_name: string | null;
  coach_email: string | null;
  created_at: string;
}

// Returned by the coach_players() RPC (players sharing with the viewer).
export interface SharedPlayer {
  player_id: string;
  player_name: string;
}

export interface Note {
  id: string;
  match_id: string;
  point_id: string | null;
  author_id: string;
  body: string;
  audio_path: string | null;
  created_at: string;
}

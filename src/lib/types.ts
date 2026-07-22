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
  // Who served the first point ('user' = the uploader). Once set, every
  // point's displayed server comes from ITTF rotation (see serving.ts);
  // auto-detected points.server is only the fallback while this is null.
  first_server: "user" | "opponent" | null;
  created_at: string;
}

// Placement v1 (legacy rows): a flat dot list in bounce order.
export interface PlacementBounce {
  t: number;
  u: number; // meters across the table width (0..1.525)
  v: number; // meters along the table length (0..2.74)
  side: "near" | "far";
}

// Placement v2: ordered, role-tagged on-table bounces.
export type PlacementRole = "serve_1" | "serve_2" | "rally" | "final";
export type FinalKind = "winner_landing" | "net" | "out_adjacent" | "unknown";

export interface PlacementBounceV2 {
  seq: number;
  t?: number;
  u: number;
  v: number;
  role: PlacementRole;
  /** 1-based exchange number, rally bounces only. */
  rally_n?: number;
  /** Who hit the shot that produced this bounce. */
  hitter_side: "near" | "far";
  /** Final bounce only: how the point ended, from the umpire suggestion. */
  final_kind?: FinalKind;
}

export type Placement =
  | { v?: undefined; bounces: PlacementBounce[] } // v1 (legacy)
  | { v: 2; bounces: PlacementBounceV2[] };

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
  // Auto-detected server (worker near/far assumption). Only a default
  // guess and a display fallback; rotation from matches.first_server wins.
  server: "user" | "opponent" | null;
  // Owner correction: displayed server for this point AND the rotation
  // anchor for the points after it (serving.ts recomputes downstream from
  // the most recent override).
  server_override: "user" | "opponent" | null;
  // A let: same server serves again; excluded from rotation count + score.
  is_let: boolean;
  placement: Placement | null;
  suggestion: PointSuggestion | null;
  confirmed_winner: "user" | "opponent" | null;
  confirmed_how: string | null;
  starred: boolean;
  // Soft delete ("Not a point"): hidden from the timeline, undoable.
  deleted: boolean;
  // Seconds into the CUT video where this point starts (worker-computed).
  // Null on matches processed before migration 011 and on split-born
  // points; the "Go to point" strip only shows for points that have it.
  // (points.warmup still exists in Postgres but is retired and ignored.)
  cut_t0: number | null;
  // t0/t1 changed (or the point was born from a split) and the clip is
  // stale; cleared by the reclip worker when the clip is regenerated.
  edited: boolean;
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

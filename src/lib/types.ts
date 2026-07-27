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
  // A PERSON's name only (feeds the scorebug / rotation / search). The
  // display title is DERIVED from this + venue + played_at, never stored —
  // see src/lib/matchTitle.ts.
  opponent_name: string | null;
  // Club / location, optional. Set from the upload form, folded into the
  // derived title. null until the owner names a venue.
  venue: string | null;
  // Practice / League / Tournament, set from the upload form (006).
  match_type: "practice" | "league" | "tournament" | null;
  // Capture date: the video's real creation_time (ffprobe) for uploads, the
  // YouTube upload_date for imports, else the upload time. now() default.
  played_at: string;
  cut_path: string | null;
  match_json_path: string | null;
  // Poster JPEG for match cards (033): r2://ponglens-media/points/<uid>/
  // <matchId>/thumb.jpg. Signed in batch via /api/media-url { thumbs }.
  // null for matches processed before thumbs existed and not yet backfilled.
  thumb_path: string | null;
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

export type PlacementStatus = "ready" | "review" | "unavailable";
export type PlacementTerminalKind =
  | "net"
  | "out"
  | "winner_landing"
  | "no_return";

export interface PlacementEventV3 {
  event_id: string | null;
  t?: number;
  u?: number;
  v?: number;
  x?: number;
  y?: number;
  inferred?: boolean;
  confidence: number;
}

export interface PlacementTerminalV3 extends PlacementEventV3 {
  kind: PlacementTerminalKind;
  direction?: { du: number; dv: number } | null;
}

export interface PlacementShotV3 {
  id: string;
  seq: number;
  phase: "serve" | "rally" | "final";
  hitter_side: "near" | "far";
  contact_t: number | null;
  contact: PlacementEventV3 | null;
  serve_first_bounce: PlacementEventV3 | null;
  landing: PlacementEventV3 | null;
  terminal: PlacementTerminalV3 | null;
  confidence: number;
}

export interface PlacementHypothesisV3 {
  serverSide: "near" | "far";
  server_side: "near" | "far";
  status: PlacementStatus;
  confidence: number;
  score: number;
  reasons: string[];
  hard_reasons: string[];
  shots: PlacementShotV3[];
  used_event_ids: string[];
}

export interface PlacementCandidateV3 {
  id: string;
  kind: "bounce" | "contact" | "impact" | "net" | "out";
  kinds: string[];
  t: number;
  u?: number | null;
  v?: number | null;
  x?: number | null;
  y?: number | null;
  side?: "near" | "far";
  visual_confidence: number;
  audio_confidence: number;
}

export interface PlacementV3 {
  v: 3;
  status: PlacementStatus;
  candidates: PlacementCandidateV3[];
  hypotheses: {
    near: PlacementHypothesisV3;
    far: PlacementHypothesisV3;
  };
}

export type Placement =
  | { v?: undefined; bounces: PlacementBounce[] } // v1 (legacy)
  | { v: 2; bounces: PlacementBounceV2[] }
  | PlacementV3;

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
  // The SKIPPED outcome flag (column kept as is_let for its many DB
  // dependents; treat as "skipped" everywhere in app code). A skipped
  // point never scores and never advances the serve rotation; the
  // optional reason lives in confirmed_how ('let' | 'misrecorded' |
  // 'other' — see scorecard.ts SKIP_REASONS). DB constraint
  // points_let_never_scored: is_let and confirmed_winner never coexist.
  is_let: boolean;
  placement: Placement | null;
  suggestion: PointSuggestion | null;
  confirmed_winner: "user" | "opponent" | null;
  confirmed_how: string | null;
  // Tactical placement of the deciding ball on the opponent's side:
  // forehand / backhand / middle (the crossover). Optional; may later be
  // pre-filled from the vision's final bounce. See migration 030.
  direction?: "fh" | "bh" | "mid" | null;
  // Optional serve diagnosis, asked only when the point turned on the serve
  // (receive error / ace). Spin is a base axis plus a sidespin modifier so
  // side-under and side-top are expressible — see migration 032.
  serve_spin?: "back" | "top" | "none" | null;
  serve_sidespin?: boolean | null;
  serve_length?: "short" | "half" | "long" | null;
  // Optional self-reported reasons the OWNER lost this point. Never set on
  // points they won (you can't know your opponent's reasons).
  loss_reasons?: string[] | null;
  starred: boolean;
  // Soft delete ("Not a point"): hidden from the timeline, undoable.
  deleted: boolean;
  // Seconds into the CUT video where this point's PADDED clip starts
  // (t0 minus the point's effective pre pad — see playhead.ts anchoring).
  // Worker-computed at cut time; for split-born points computed by the
  // split flow from the parent's anchor (migration 023). Null only on
  // matches processed before migration 011 (and their split children).
  // (points.warmup still exists in Postgres but is retired and ignored.)
  cut_t0: number | null;
  // t0/t1 changed (or the point was born from a split) and the clip is
  // stale; cleared by the reclip worker when the clip is regenerated.
  edited: boolean;
  // This edge is a split boundary shared with a sibling point: the clip is
  // cut with min(pad, TIGHT_PAD) context there instead of the full
  // strictness pad, so the split moment isn't doubled across both
  // children. Set by split_point(); cleared client-side when the owner
  // manually re-times that edge (clipEdit.ts effectivePad).
  tight_start: boolean;
  tight_end: boolean;
  // Owner override of the auto game boundary AFTER this point:
  //   'end'      — a game ends here regardless of the score;
  //   'continue' — suppress the auto 11+2-clear rule from here until a
  //                later explicit 'end' closes the game;
  //   null       — automatic.
  // Only read on scored points (confirmed_winner set, not skipped) — see
  // gameScore.ts stepBoundaryWalk, the single boundary authority.
  game_end_override: "end" | "continue" | null;
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

// Display names for the people who wrote notes on a match, from the
// match_note_authors() RPC (auth.users is never exposed to clients). Lets
// the thread name a coach instead of labelling every one of them "Coach".
export interface NoteAuthor {
  author_id: string;
  name: string | null;
  is_owner: boolean;
}

// Point tags (035): the owner's vocabulary of short labels. Owner-keyed —
// a coach's "forehand error" on your match is YOUR tag — so cross-match
// counts never split. Attribution lives on point_tags.created_by.
export interface Tag {
  id: string;
  owner_id: string;
  label: string;
  created_at: string;
}

export interface PointTag {
  point_id: string;
  tag_id: string;
  created_by: string;
  created_at: string;
}

// One row of tag_stats(): a visible tag with its cross-match reach.
export interface TagStat {
  tag_id: string;
  owner_id: string;
  label: string;
  point_count: number;
  match_count: number;
  last_used: string | null;
}

// One row of tagged_points(tag): a point carrying the tag, with match
// title atoms and its display number for "Point N" and ?p= deep links.
export interface TaggedPointRow {
  point_id: string;
  match_id: string;
  point_no: number;
  tagged_at: string;
  tagged_by: string;
  match_owner_id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string;
  user_side: "near" | "far" | null;
  player_near_name: string | null;
  player_far_name: string | null;
}

// One row of note_feed() (034): a note joined with its author's display
// name and the match's title atoms, scoped by has_match_access(). Feeds the
// Improve workspace and Home's notes snapshot.
export interface NoteFeedRow {
  id: string;
  match_id: string;
  point_id: string | null;
  author_id: string;
  body: string;
  audio_path: string | null;
  created_at: string;
  author_name: string | null;
  match_owner_id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string;
  user_side: "near" | "far" | null;
  player_near_name: string | null;
  player_far_name: string | null;
}

export type NotificationKind =
  | "note"
  | "match_ready"
  | "match_failed"
  | "reel_ready"
  | "reel_failed"
  | "coach_joined";

// Named AppNotification so it never shadows the DOM's Notification global.
// Copy is denormalised server-side (see migration 031) — the bell renders
// title/body verbatim and navigates to href.
export interface AppNotification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  match_id: string | null;
  actor_id: string | null;
  title: string;
  body: string | null;
  href: string;
  group_count: number;
  read_at: string | null;
  created_at: string;
}

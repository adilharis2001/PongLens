export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface JobOptions {
  points?: boolean;
  placement?: boolean;
  strictness?: "tight" | "normal" | "loose";
  /**
   * Commerce mode (096): claim_processing stamps the match this job was
   * claimed for. It is the only link between the two until the worker
   * writes matches.job_id, which is why the library and Home dedupe on it.
   */
  match_id?: string | null;
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

// "uploaded" (096): a raw library video — watchable, not yet processed.
export type MatchStatus = "uploaded" | "processing" | "ready" | "failed";

export type MatchStructureStatus =
  | "pending"
  | "ready"
  | "withheld"
  | "failed";

export interface MatchEndChangeEvidence {
  after_point_id: string | null;
  before_point_id: string | null;
  confirmed_at_point_id: string | null;
  after_idx: number;
  before_idx: number;
  confirmed_at_idx: number;
  old_state: "direct" | "swapped";
  new_state: "direct" | "swapped";
  confirmations: number;
  kind: "end_change";
}

export interface MatchStructureEvidence {
  version: 1;
  status: MatchStructureStatus;
  algorithm: "rtmpose-match-structure-v1";
  first_server?: {
    status: "high_confidence" | "withheld" | "unavailable";
    side: "near" | "far" | null;
    usable_points?: number[];
  };
  end_changes?: MatchEndChangeEvidence[];
  coverage?: {
    total: number;
    high_confidence: number;
    needs_review: number;
    unavailable: number;
  };
  compute?: {
    elapsed_s?: number;
    model_load_s?: number;
    decode_s?: number;
    inference_s?: number;
    postprocess_s?: number;
    frames_requested?: number;
    frames_decoded?: number;
    clips_opened?: number;
  };
}

export type MatchPlacementStatus =
  | "not_requested"
  | "processing"
  | "ready"
  | "retry_available"
  | "retrying"
  | "final_failed";

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
  match_type: "drills" | "practice" | "match" | "league" | "tournament" | null;
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
  // Authority for first_server. A user value is never replaced by worker
  // reprocessing; detected values may be refreshed from new evidence.
  first_server_source: "user" | "detected" | null;
  // Versioned, summarized RTMPose evidence. Raw frames/keypoints never land
  // here; owner server/game overrides remain separate and authoritative.
  match_structure: MatchStructureEvidence | null;
  // Clip context pads this match's clips were cut with (048). null for
  // pre-048 matches — the app falls back to the per-strictness table
  // (clipEdit.ts CLIP_PAD, the values those older clips were cut with).
  clip_pads?: { pre: number; post: number } | null;
  // Placement generation is optional and may fail without failing the match.
  placement_status: MatchPlacementStatus;
  placement_retry_count: 0 | 1;
  placement_mapped_points: number;
  placement_failure_code: string | null;
  placement_retry_expires_at: string | null;
  placement_retry_job_id: string | null;
  placement_generation_job_id: string | null;
  // Owner said the match's maps are wrong (063). Hides the placement
  // section and is the feedback signal that the calibration failed here.
  placement_flagged?: boolean;
  // Commerce (096): the raw source in R2 while the video lives in the
  // library unprocessed, its duration as read at upload (the charging
  // basis for processing minutes), and the original filename for display
  // before any metadata exists.
  raw_path?: string | null;
  duration_s?: number | null;
  original_name?: string | null;
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

/**
 * How a serve-start label was tapped (089). A tap made while the video is
 * playing carries the labeller's reaction time; a tap made while paused or
 * scrubbing does not. Recording which is which is what lets the offline
 * analysis correct one and trust the other, instead of treating every
 * label as the looser of the two.
 */
export interface ServeStartMeta {
  paused: boolean;
  rate: number;
  src: "key" | "button";
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
  // Owner said THIS point's map is wrong (063). Hides the point's map and
  // drops its bounces from the match-level maps.
  placement_flagged?: boolean;
  suggestion: PointSuggestion | null;
  confirmed_winner: "user" | "opponent" | null;
  // Cut-video playhead when the owner scored this point in Keep score's
  // flowing session (067) — a human "point decided by here" label for the
  // rally-end detector. Null elsewhere; cleared with the score.
  scored_at_cut_s?: number | null;
  // The sibling label (089), admin only: cut-video playhead when the owner
  // saw the serve begin. Independent of the score, so it survives clearing
  // a winner. serve_start_meta says HOW it was tapped — a tap during
  // playback lands a couple of hundred ms late, a tap while paused does
  // not, and only the meta distinguishes them.
  serve_start_at_cut_s?: number | null;
  serve_start_meta?: ServeStartMeta | null;
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
  // Which part of the spin beat you, on a point whose reason was "Misread
  // the spin" — 'type' (couldn't read it) or 'amount' (read it, misjudged
  // how much). Migration 062; the only follow-up that question asks.
  misread_kind?: "type" | "amount" | null;
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
  // POSITIONAL: read on every visible point, scored or not — see
  // gameScore.ts stepBoundaryWalk, the single boundary authority.
  game_end_override: "end" | "continue" | null;
  // Owner-named winner of the game that ENDS at this point (099). Only
  // meaningful alongside a game end here; covers ends the 11-clear-by-2
  // rule can't prove because a cut ate points (a game pinned closed at
  // 10-7 counted for nobody). Cleared with the 'end' it belongs to.
  game_winner_override: "user" | "opponent" | null;
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
  /** Annotated video frame (040). Optional: some row shapes (note_feed)
   *  don't carry it. */
  image_path?: string | null;
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

// Tags on journal entries (entry_tags, migration 038): same owner-keyed
// vocabulary as point tags, so one tag search yields footage AND writing.
export interface EntryTag {
  lesson_id: string;
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

// Lessons (037): long-form coaching content, distilled into grouped
// takeaways by /api/lesson. Private to the author.
export interface LessonTakeaways {
  title: string;
  themes: { name: string; points: string[] }[];
}

export interface Lesson {
  id: string;
  user_id: string;
  match_id: string | null;
  transcript: string;
  takeaways: LessonTakeaways | null;
  status: "queued" | "ready" | "failed";
  // 'lesson' = coaching content; 'practice' = the player's own journal.
  kind: "lesson" | "practice";
  // Who taught it, as the player typed it (085). Free text: a coach here
  // is often not a PongLens user. Null on practice entries and on lessons
  // saved before the field existed. This is what lets Ask answer "my last
  // lesson with Jonathan" from structure instead of hoping the name
  // survived speech-to-text inside the transcript.
  coach_name?: string | null;
  // Attached photo (047): r2://…/entry/<user_id>/… — moderated on upload.
  image_path?: string | null;
  created_at: string;
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
  image_path: string | null;
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
  | "coach_joined"
  // An upload or YouTube import that never became a match (066).
  | "upload_failed"
  // Paid review lifecycle (073). Written by the review_orders status
  // trigger and add_review_followup; hrefs point at /orders/<id> for the
  // student and /coaching/orders/<id> for the coach.
  | "order_paid"
  | "order_submitted"
  | "order_accepted"
  | "order_declined"
  | "clarification_requested"
  | "review_delivered"
  | "followup_received"
  | "order_completed"
  | "order_refunded"
  | "sponsored_claimed"
  // Featured-sample consent handshake (078).
  | "sample_requested"
  | "sample_responded";

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

/**
 * Shapes returned by the SECURITY DEFINER share-resolution functions
 * (migrations 013, 129, 130) plus the display helpers the /s page and its
 * OG image share. Server-side only concern: clip/cut R2 paths never leave
 * the server (the media route signs them).
 */

import type { Point } from "@/lib/types";

export interface ResolvedShareLink {
  kind: "point" | "match" | "starred" | "tag";
  match_id: string;
  point_id: string | null;
  /** owner-written headline (<= 80 chars); null = machine context line */
  title: string | null;
  /** the tag's label, for 'tag' links; null otherwise */
  tag_label: string | null;
  /** owner's choice: draw the running score over the video (129). Since
   *  130 it governs the whole scored half of the page — the bug, the
   *  result and the stats — because they are all the same fact. */
  show_score: boolean;
  opponent_name: string | null;
  player_near_name: string | null;
  player_far_name: string | null;
  /** the uploader's own display name, metadata only — never the email
   *  local part (130). Null when they have never had a name. */
  owner_name: string | null;
  /** which end of the frame the uploader played. Without it the page
   *  cannot tell which of the two side names is the person who shared. */
  user_side: "near" | "far" | null;
  first_server: "user" | "opponent" | null;
  venue: string | null;
  placement_status: string | null;
  /** the owner said this match's maps are wrong; nothing is drawn */
  placement_flagged: boolean;
  played_at: string;
  cut_path: string | null;
  original_name: string | null;
  point_number: number | null;
  point_t0: number | null;
  point_t1: number | null;
  point_clip_path: string | null;
  point_starred: boolean | null;
  point_confirmed_winner: "user" | "opponent" | null;
  point_confirmed_how: string | null;
}

export interface ResolvedSharePoint {
  id: string;
  idx: number;
  t0: number | null;
  t1: number | null;
  /**
   * Seconds into the CUT VIDEO where this rally's padded clip starts —
   * the ONLY clock that means anything on this page, because the cut
   * video is what a share link plays. t0/t1 are in the source timebase
   * and are tens of seconds away from it on a real match. Walking the
   * wrong one is what made a shared score read 0-3 where the truth was
   * 2-4 (130).
   */
  cut_t0: number | null;
  clip_path: string | null;
  starred: boolean;
  is_let: boolean;
  confirmed_winner: "user" | "opponent" | null;
  /** The owner's manual game boundaries. Without these the page would walk
   *  different boundaries from the owner's own player and print a score
   *  that disagrees with theirs, which is worse than printing none. */
  game_end_override: "end" | "continue" | null;
  game_winner_override: "user" | "opponent" | null;
  /** Auto-detected server, and the owner's correction. computeServing
   *  needs both to run the ITTF rotation. */
  server: "user" | "opponent" | null;
  server_override: "user" | "opponent" | null;
  placement_flagged: boolean;
}

/** Row from resolve_share_starred(): a currently-starred visible point. */
export interface ResolvedStarredPoint {
  id: string;
  /** display number (position among all non-deleted points) */
  number: number;
  t0: number | null;
  t1: number | null;
  clip_path: string | null;
}

/** Row from resolve_share_placement(): the vision's per-point placement. */
export interface ResolvedSharePlacement {
  id: string;
  placement: Point["placement"];
}

/**
 * The share rows, in the shape the match maths expects.
 *
 * computeMatchScore, computeServing, computeMatchStats and
 * collectTrustedPlacementObservations all take Point[]. This page used to
 * hand them `rows as unknown as Point[]`, which is a promise the compiler
 * cannot check and which quietly hid the fact that `server` was never
 * being fetched at all. Filling the shape explicitly makes the missing
 * columns a decision rather than an accident: everything nulled below is
 * genuinely withheld from a public link, on purpose.
 */
export function sharePointsAsPoints(
  rows: ResolvedSharePoint[],
  matchId: string,
  placement: Map<string, Point["placement"]> = new Map()
): Point[] {
  return rows.map((r) => ({
    id: r.id,
    match_id: matchId,
    idx: r.idx,
    t0: r.t0 === null ? null : Number(r.t0),
    t1: r.t1 === null ? null : Number(r.t1),
    cut_t0: r.cut_t0 === null ? null : Number(r.cut_t0),
    clip_path: r.clip_path,
    server: r.server,
    server_override: r.server_override,
    is_let: r.is_let,
    placement: placement.get(r.id) ?? null,
    placement_flagged: r.placement_flagged,
    suggestion: null,
    confirmed_winner: r.confirmed_winner,
    // Not published: how a point ended, why it was lost, how it was
    // served. Those are notes the owner wrote about themselves, and none
    // of them are in the video the link already plays.
    confirmed_how: null,
    starred: r.starred,
    deleted: false,
    edited: false,
    tight_start: false,
    tight_end: false,
    game_end_override: r.game_end_override,
    game_winner_override: r.game_winner_override,
  }));
}

/** "Adil" — first name only, the way the app names anyone. */
function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

function looksLikeMatchup(name: string): boolean {
  return /\bvs\.?\s/i.test(name);
}

/**
 * Who the two rows of the scoreboard belong to.
 *
 * `you` is always the UPLOADER, because that is what confirmed_winner
 * 'user' means — and which side of the frame they played is
 * matches.user_side, not an assumption that they were the near player.
 * This page assumed near from the day it was written: a match played at
 * the far end put the opponent's name on the owner's score.
 */
export function sharePlayers(link: {
  player_near_name: string | null;
  player_far_name: string | null;
  opponent_name: string | null;
  owner_name: string | null;
  user_side: "near" | "far" | null;
}): { you: string; them: string } {
  const near = (link.player_near_name ?? "").trim();
  const far = (link.player_far_name ?? "").trim();
  const ownSide = link.user_side === "far" ? far : near;
  const otherSide = link.user_side === "far" ? near : far;
  const opp = (link.opponent_name ?? "").trim();
  return {
    you: ownSide || firstName(link.owner_name) || "You",
    // Owners sometimes type the whole matchup ("Adil vs Vaibhav") into the
    // opponent field. That is a title, not a person, and it must never end
    // up as one row of a two-row scoreboard.
    them: otherSide || (looksLikeMatchup(opp) ? "" : opp) || "Them",
  };
}

/** "Adil vs Julian" — the headline, uploader first so it reads in the
 *  same order as the scoreboard under it. */
export function playersLine(link: {
  player_near_name: string | null;
  player_far_name: string | null;
  opponent_name: string | null;
  owner_name: string | null;
  user_side: "near" | "far" | null;
}): string | null {
  const opp = (link.opponent_name ?? "").trim();
  const hasSideName = Boolean(
    (link.player_near_name ?? "").trim() || (link.player_far_name ?? "").trim()
  );
  // The owner already wrote the matchup out; wrapping a name around it
  // produced "vs Adil vs Vaibhav".
  if (looksLikeMatchup(opp) && !hasSideName) return opp;
  const { you, them } = sharePlayers(link);
  if (you === "You" && them === "Them") return null;
  if (you === "You") return `vs ${them}`;
  if (them === "Them") return you;
  return `${you} vs ${them}`;
}

/** "Point 14 · 12s rally" (duration omitted when timing is missing). */
export function pointContextLine(link: {
  point_number: number | null;
  point_t0: number | null;
  point_t1: number | null;
}): string {
  const n = link.point_number ?? 0;
  const base = n > 0 ? `Point ${n}` : "Point";
  const dur =
    link.point_t0 !== null && link.point_t1 !== null
      ? Math.max(0, Math.round(Number(link.point_t1) - Number(link.point_t0)))
      : null;
  return dur !== null ? `${base} · ${dur}s rally` : base;
}

/** "4 points · Adil vs Marco" | "1 point · vs Marco" | "Starred points". */
export function starredContextLine(
  count: number,
  names: string | null
): string {
  if (count < 1) return names ?? "Starred points";
  const pts = `${count} ${count === 1 ? "point" : "points"}`;
  return names ? `${pts} · ${names}` : pts;
}

/** "backhand error · 4 points · Adil vs Marco" — the tag collection line. */
export function tagContextLine(
  label: string | null,
  count: number,
  names: string | null
): string {
  const name = (label ?? "").trim() || "Tagged points";
  const pts =
    count > 0 ? `${count} ${count === 1 ? "point" : "points"}` : null;
  return [name, pts, names].filter(Boolean).join(" · ");
}

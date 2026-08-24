import { deriveMatchTitleParts } from "../../lib/matchTitle.ts";
import {
  howLabel,
  lossReasonsSummary,
  skipChipLabel,
  type CustomReasonLabels,
} from "../match/[id]/scorecard.ts";

/**
 * The Starred points shelf: pure shaping of what starred_points() (134)
 * returns, kept out of the view so it can be tested without React.
 *
 * The RPC already did the two things SQL is better at — numbering each
 * point within its match, and ordering the whole set — so nothing here
 * re-sorts. Grouping walks the rows in the order they arrived and starts
 * a new group whenever the match id changes, which is only correct
 * BECAUSE the RPC ordered by match. Sort them yourself and this breaks
 * quietly, into duplicate groups for the same match.
 */

export interface StarredPointRow {
  id: string;
  match_id: string;
  /** position among the match's VISIBLE points — what the match page prints */
  display_no: number;
  t0: number | null;
  t1: number | null;
  has_clip: boolean;
  confirmed_winner: "user" | "opponent" | null;
  confirmed_how: string | null;
  direction: "fh" | "bh" | "mid" | null;
  loss_reasons: string[] | null;
  is_let: boolean;
  /** timing changed and the clip is being recut — it may not play yet */
  edited: boolean;
  opponent_name: string | null;
  venue: string | null;
  played_at: string;
  match_type: string | null;
  has_thumb: boolean;
}

export interface StarredGroup {
  matchId: string;
  playedAt: string;
  hasThumb: boolean;
  /** "Julian · Pingpod" */
  title: string;
  /** "Aug 22, 2026 · Match" */
  subtitle: string;
  points: StarredPointRow[];
}

export function groupStarred(rows: StarredPointRow[]): StarredGroup[] {
  const groups: StarredGroup[] = [];
  for (const row of rows) {
    let last = groups[groups.length - 1];
    if (!last || last.matchId !== row.match_id) {
      const parts = deriveMatchTitleParts({
        opponentName: row.opponent_name,
        venue: row.venue,
        playedAt: row.played_at,
        matchType: row.match_type,
      });
      last = {
        matchId: row.match_id,
        playedAt: row.played_at,
        hasThumb: row.has_thumb,
        title: parts.primary,
        subtitle: parts.secondary,
        points: [],
      };
      groups.push(last);
    }
    last.points.push(row);
  }
  return groups;
}

export type Outcome = "won" | "lost" | "skipped" | "unscored";

export function outcomeOf(row: StarredPointRow): Outcome {
  if (row.is_let) return "skipped";
  if (row.confirmed_winner === "user") return "won";
  if (row.confirmed_winner === "opponent") return "lost";
  return "unscored";
}

/** The tile's headline. Same three words the match timeline uses. */
export function outcomeLabel(row: StarredPointRow): string {
  switch (outcomeOf(row)) {
    case "won":
      return "I won";
    case "lost":
      return "They won";
    case "skipped":
      return skipChipLabel(row.confirmed_how);
    default:
      return "Not scored";
  }
}

/**
 * The second line, when there is one. Since 062 nothing writes
 * confirmed_how on a SCORED point — the reasons a point was lost moved to
 * loss_reasons — so a scored point reads its reasons from there and a
 * skipped one still reads its reason from confirmed_how. Both are
 * optional; most points have neither and the tile simply omits the line.
 *
 * The stored values are slugs, and the owner's own reasons are `custom:`
 * ids that only loss_reason_labels can resolve. Joining the raw array
 * printed "too_aggressive" on a tile, which is the database talking.
 */
export function reasonLabel(
  row: StarredPointRow,
  custom?: CustomReasonLabels
): string | null {
  if (row.is_let) return null; // already said by outcomeLabel
  return (
    lossReasonsSummary(row.loss_reasons, custom) ?? howLabel(row.confirmed_how)
  );
}

export const DIRECTION_LABEL: Record<string, string> = {
  fh: "Forehand side",
  bh: "Backhand side",
  mid: "Middle",
};

/** "8.4s", or null when the timing is missing. */
export function rallySeconds(row: StarredPointRow): number | null {
  if (row.t0 == null || row.t1 == null) return null;
  const secs = Number(row.t1) - Number(row.t0);
  return Number.isFinite(secs) && secs > 0 ? secs : null;
}

export function durationLabel(row: StarredPointRow): string | null {
  const secs = rallySeconds(row);
  return secs == null ? null : `${secs.toFixed(1)}s`;
}

/** "67 points · 21 matches" — a count, not a description of the page. */
export function summaryLine(rows: StarredPointRow[]): string {
  const matches = new Set(rows.map((r) => r.match_id)).size;
  return `${rows.length} point${rows.length === 1 ? "" : "s"} · ${matches} match${
    matches === 1 ? "" : "es"
  }`;
}

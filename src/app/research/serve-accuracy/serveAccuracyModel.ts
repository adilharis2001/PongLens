import type { Point } from "@/lib/types";
import type { ServePlacementRejection } from "@/lib/placement/placementAggregate";

/** One row of the review: a clip, a serve dot, and where the point ended. */
export interface ServeAccuracyRow {
  pointId: string;
  idx: number;
  game: number;
  /** Who served, from the scored rotation. */
  server: "user" | "opponent" | null;
  /** Who won, or null when the point is unscored or a let. */
  winner: "user" | "opponent" | null;
  isLet: boolean;
  /** Normalized to the drawn map: the user is at the bottom, their left. */
  serve: { u: number; v: number } | null;
  final: { u: number; v: number; shotSeq: number } | null;
  rejection: ServePlacementRejection | null;
}

export interface ServeAccuracyMatch {
  matchId: string;
  label: string;
  opponent: string;
  rows: ServeAccuracyRow[];
}

/**
 * Plain English for a refusal, written for someone holding the video.
 *
 * The point of naming them is that a refusal is a claim: "this serve was
 * not measurable". Watching the clip is how you find out whether the claim
 * was right, and a reason you cannot read is a claim you cannot check.
 */
export const REJECTION_COPY: Record<ServePlacementRejection, string> = {
  deleted: "Point was deleted.",
  not_v3: "No ball tracking was stored for this point.",
  no_server: "The scored rotation does not say who served.",
  no_serve_shot: "No serve was reconstructed.",
  no_landing: "The serve's landing was never measured.",
  off_table: "The landing projects outside the table.",
  wrong_half: "The landing is on the server's own half.",
  first_bounce_wrong_half:
    "The serve's first bounce is on the receiver's half, so this may not be "
    + "the player the rotation says it is.",
  not_consecutive:
    "Something else touched the table between the serve's two bounces.",
  no_zone: "The landing does not fall in a zone.",
};

/** How many serves were drawn, and what stopped the rest. */
export function summarise(rows: readonly ServeAccuracyRow[]) {
  const drawn = rows.filter((r) => r.serve !== null).length;
  const byReason = new Map<ServePlacementRejection, number>();
  for (const r of rows) {
    if (r.rejection === null) continue;
    byReason.set(r.rejection, (byReason.get(r.rejection) ?? 0) + 1);
  }
  return {
    drawn,
    total: rows.length,
    withFinal: rows.filter((r) => r.final !== null).length,
    reasons: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** Visible points, in play order — the same set the match page counts. */
export function livePoints(points: readonly Point[]): Point[] {
  return points.filter((p) => !p.deleted);
}

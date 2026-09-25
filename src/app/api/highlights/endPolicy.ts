import { createHash } from "node:crypto";

export type AutomaticHighlightEndPoint = {
  t0?: number | null;
  cut_t0?: number | null;
  scored_at_cut_s?: number | null;
  rally_end_cut_s?: number | null;
  tight_start?: boolean | null;
  highlight_evidence?: { observed_end_s?: number | null } | null;
};

export type AutomaticHighlightRevisionPoint = AutomaticHighlightEndPoint & {
  id: string;
  idx: number;
  t1?: number | null;
  clip_path?: string | null;
  deleted?: boolean | null;
  edited?: boolean | null;
  is_let?: boolean | null;
  confirmed_winner?: string | null;
  highlight_evidence?: {
    v?: number | null;
    status?: string | null;
    n_hits?: number | null;
    connected_crossings?: number | null;
    alternating_table_landings?: number | null;
    table_bounces?: number | null;
    observed_end_s?: number | null;
    end_source?: string | null;
  } | null;
};

export const TAP_END_TAIL_S = 0.2;
export const DETECTOR_END_TAIL_S = 0.25;
/** process_hand_cut's clip pad; hand cuts also store it on matches.clip_pads. */
export const HAND_CUT_PRE_S = 1.2;
/** adjust_point opens a tight-start clip with least(pre, 0.3). */
const TIGHT_START_PRE_S = 0.3;

/**
 * The source seconds each clip opens before its mark on a hand-cut match,
 * or null for every other match. Only the hand-cut end rule reads it; the
 * worker computes the same number (worker.hand_cut_clip_pre).
 */
export function handCutClipPreS(match: {
  cut_source?: string | null;
  clip_pads?: unknown;
}): number | null {
  if (match.cut_source !== "manual") return null;
  const pads = match.clip_pads;
  if (pads && typeof pads === "object") {
    const pre = (pads as { pre?: unknown }).pre;
    const post = (pads as { post?: unknown }).post;
    if (finite(pre) && finite(post)) return pre;
  }
  return HAND_CUT_PRE_S;
}

export function supportsScoredHighlights(matchType: string | null | undefined): boolean {
  return matchType !== "practice" && matchType !== "drills";
}

export type AutomaticHighlightReadStatus =
  | "ready"
  | "rendering"
  | "needs_scoring"
  | "needs_generation"
  | "needs_update"
  | "updating"
  | "empty"
  | "failed";

export function automaticHighlightReadDecision({
  hasReel,
  reelStatus,
  manifestFresh,
  pointsUpdating,
  scoreEligible = true,
}: {
  hasReel: boolean;
  reelStatus: string | null;
  manifestFresh: boolean;
  pointsUpdating: boolean;
  scoreEligible?: boolean;
}): { status: AutomaticHighlightReadStatus } {
  if (reelStatus === "queued" || reelStatus === "rendering") {
    return { status: "rendering" };
  }
  if (pointsUpdating) return { status: "updating" };
  if (hasReel && manifestFresh && reelStatus === "ready") {
    return { status: "ready" };
  }
  if (!scoreEligible) return { status: "needs_scoring" };
  if (!hasReel) return { status: "needs_generation" };
  if (reelStatus === "empty" || reelStatus === "failed") {
    return { status: "needs_generation" };
  }
  if (!manifestFresh) {
    return {
      status: pointsUpdating ? "updating" : "needs_update",
    };
  }
  if (reelStatus === "ready") return { status: "ready" };
  if (reelStatus === "empty") return { status: "empty" };
  return { status: "failed" };
}

export function automaticHighlightRequestDecision({
  hasReel,
  reelStatus,
  manifestFresh,
  pointsUpdating,
  scoreEligible = true,
}: {
  hasReel: boolean;
  reelStatus: string | null;
  manifestFresh: boolean;
  pointsUpdating: boolean;
  scoreEligible?: boolean;
}): "enqueue" | "rendering" | "clips_updating" | "current" | "score_required" {
  if (
    hasReel &&
    (reelStatus === "queued" || reelStatus === "rendering")
  ) {
    return "rendering";
  }
  if (pointsUpdating) return "clips_updating";
  if (hasReel && manifestFresh && reelStatus === "ready") return "current";
  if (!scoreEligible) return "score_required";
  return "enqueue";
}

export function automaticHighlightEvidenceRefreshNeeded(
  points: AutomaticHighlightRevisionPoint[],
): boolean {
  return points.some(
    (point) =>
      !point.deleted &&
      !point.edited &&
      !point.is_let &&
      (point.confirmed_winner === "user" ||
        point.confirmed_winner === "opponent") &&
      Boolean(point.clip_path) &&
      point.highlight_evidence?.v !== 2,
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalNumber(value: unknown): string | null {
  if (!finite(value)) return null;
  const text = value.toFixed(6).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/** Cross-language hash of every input that can change the rendered artifact. */
export function highlightPointsRevision(
  points: AutomaticHighlightRevisionPoint[],
  scoredOnly = false,
): string {
  const rows = [...points]
    .sort((a, b) => a.t0! - b.t0! || a.idx - b.idx || a.id.localeCompare(b.id))
    .map((point) => {
      const evidence = point.highlight_evidence ?? {};
      const row = [
        point.id,
        canonicalNumber(point.idx),
        canonicalNumber(point.t0),
        canonicalNumber(point.t1),
        canonicalNumber(point.cut_t0),
        canonicalNumber(point.scored_at_cut_s),
        canonicalNumber(point.rally_end_cut_s),
        point.clip_path ?? null,
        Boolean(point.deleted),
        Boolean(point.edited),
        Boolean(point.is_let),
        canonicalNumber(evidence.v),
        evidence.status ?? null,
        canonicalNumber(evidence.n_hits),
        canonicalNumber(evidence.connected_crossings),
        canonicalNumber(evidence.alternating_table_landings),
        canonicalNumber(evidence.table_bounces),
        canonicalNumber(evidence.observed_end_s),
        evidence.end_source ?? null,
      ];
      if (scoredOnly) {
        row.push(
          point.confirmed_winner === "user" ||
            point.confirmed_winner === "opponent",
        );
      }
      return row;
    });
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function highlightManifestIsFresh(
  points: AutomaticHighlightRevisionPoint[],
  manifest: {
    points_revision: string;
    scored_only?: boolean;
    points: Array<{
      point_id: string;
      cut_start_s: number;
      cut_end_s: number;
    }>;
  },
  clipPreS: number | null = null,
): boolean {
  const scoredOnly = manifest.scored_only === true;
  if (highlightPointsRevision(points, scoredOnly) !== manifest.points_revision) {
    return false;
  }
  const byId = new Map(points.map((point) => [point.id, point]));
  return manifest.points.every((manifestPoint) => {
    const point = byId.get(manifestPoint.point_id);
    const end = point ? automaticHighlightEnd(point, clipPreS) : null;
    return Boolean(
      point &&
        !point.deleted &&
        !point.edited &&
        !point.is_let &&
        (!scoredOnly ||
          point.confirmed_winner === "user" ||
          point.confirmed_winner === "opponent") &&
        point.highlight_evidence?.v === 2 &&
        point.highlight_evidence.status === "ready" &&
        finite(point.cut_t0) &&
        finite(end) &&
        Math.abs(point.cut_t0 - manifestPoint.cut_start_s) < 0.011 &&
        Math.abs(end - manifestPoint.cut_end_s) < 0.011,
    );
  });
}

/**
 * The worker's automatic-highlight end rule, mirrored for stale-asset checks
 * (highlights._segment_bounds). `clipPreS` only for a hand-cut match: cut_t0
 * is where the PADDED clip starts, so an evidence end in source seconds is
 * counted from t0 minus the pad. Without it the end lands a whole pad early.
 * Every other match passes nothing and keeps the established rule exactly.
 */
export function automaticHighlightEnd(
  point: AutomaticHighlightEndPoint,
  clipPreS: number | null = null,
): number | null {
  if (!finite(point.cut_t0)) return null;

  if (point.scored_at_cut_s !== null && point.scored_at_cut_s !== undefined) {
    if (!finite(point.scored_at_cut_s) || point.scored_at_cut_s < point.cut_t0) {
      return null;
    }
    return point.scored_at_cut_s + TAP_END_TAIL_S;
  }

  let detectorEnd = point.rally_end_cut_s;
  if (
    !finite(detectorEnd) &&
    finite(point.t0) &&
    finite(point.highlight_evidence?.observed_end_s)
  ) {
    if (clipPreS === null) {
      detectorEnd =
        point.cut_t0 + point.highlight_evidence.observed_end_s - point.t0;
    } else {
      const pad = point.tight_start
        ? Math.min(clipPreS, TIGHT_START_PRE_S)
        : clipPreS;
      detectorEnd =
        point.cut_t0 +
        point.highlight_evidence.observed_end_s -
        Math.max(0, point.t0 - pad);
    }
  }
  if (!finite(detectorEnd)) return null;
  return detectorEnd + DETECTOR_END_TAIL_S;
}

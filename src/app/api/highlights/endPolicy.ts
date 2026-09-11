import { createHash } from "node:crypto";

export type AutomaticHighlightEndPoint = {
  t0?: number | null;
  cut_t0?: number | null;
  scored_at_cut_s?: number | null;
  rally_end_cut_s?: number | null;
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
  if (hasReel && manifestFresh) return "current";
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
): boolean {
  const scoredOnly = manifest.scored_only === true;
  if (highlightPointsRevision(points, scoredOnly) !== manifest.points_revision) {
    return false;
  }
  const byId = new Map(points.map((point) => [point.id, point]));
  return manifest.points.every((manifestPoint) => {
    const point = byId.get(manifestPoint.point_id);
    const end = point ? automaticHighlightEnd(point) : null;
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

/** The worker's automatic-highlight end rule, mirrored for stale-asset checks. */
export function automaticHighlightEnd(
  point: AutomaticHighlightEndPoint,
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
    detectorEnd =
      point.cut_t0 + point.highlight_evidence.observed_end_s - point.t0;
  }
  if (!finite(detectorEnd)) return null;
  return detectorEnd + DETECTOR_END_TAIL_S;
}

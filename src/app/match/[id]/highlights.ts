export type HighlightManifestPoint = {
  point_id: string;
  cut_start_s: number;
  cut_end_s: number;
  output_start_s: number;
  output_end_s: number;
  n_hits: number | null;
  connected_crossings: number | null;
  table_bounces: number;
  alternating_table_landings: number | null;
};

export type HighlightManifest = {
  v: 2;
  rule: "quality-first-v2";
  max_seconds: number;
  points_revision: string;
  duration_s: number;
  scored_only?: boolean;
  points: HighlightManifestPoint[];
};

export type HighlightAsset = {
  status: "ready";
  url: string;
  durationS: number;
  manifest: HighlightManifest;
};

export type HighlightState =
  | HighlightAsset
  | {
      status: "needs_scoring";
      scoredPoints: number;
      scorablePoints: number;
      requiredPoints: number;
      requiredPercent: 75;
      eligible?: false;
    }
  | {
      status:
        | "rendering"
        | "needs_generation"
        | "needs_update"
        | "updating"
        | "empty"
        | "unavailable"
        | "failed";
    };

type HighlightSimpleStatus =
  | "rendering"
  | "needs_generation"
  | "needs_update"
  | "updating"
  | "empty"
  | "unavailable"
  | "failed";

const nonPlayable = new Set<HighlightSimpleStatus>([
  "rendering",
  "needs_generation",
  "needs_update",
  "updating",
  "empty",
  "unavailable",
  "failed",
]);

export function parseHighlightResponse(value: unknown): HighlightState {
  if (!value || typeof value !== "object") return { status: "failed" };
  const row = value as Record<string, unknown>;
  if (row.status === "needs_scoring") {
    if (
      Number.isInteger(row.scoredPoints) &&
      Number.isInteger(row.scorablePoints) &&
      Number.isInteger(row.requiredPoints) &&
      row.requiredPercent === 75 &&
      row.eligible === false
    ) {
      return row as HighlightState;
    }
    return { status: "failed" };
  }
  const simpleStatus = row.status as HighlightSimpleStatus;
  if (typeof row.status === "string" && nonPlayable.has(simpleStatus)) {
    return { status: simpleStatus };
  }
  const manifest = row.manifest as HighlightManifest | undefined;
  if (
    row.status !== "ready" ||
    typeof row.url !== "string" ||
    typeof row.durationS !== "number" ||
    !manifest ||
    manifest.v !== 2 ||
    manifest.rule !== "quality-first-v2" ||
    !Array.isArray(manifest.points) ||
    manifest.points.length === 0
  ) {
    return { status: "failed" };
  }
  return row as HighlightAsset;
}

export type HighlightLifecycleView = {
  rowSummary: string;
  sheetTitle: string;
  body: string;
  actionLabel: string | null;
  actionKind?: "score";
  shouldPoll: boolean;
};

export function highlightLifecycleView(
  state: Exclude<HighlightState, HighlightAsset>,
): HighlightLifecycleView {
  switch (state.status) {
    case "needs_scoring":
      return {
        rowSummary: `${state.scoredPoints} of ${state.scorablePoints} scored`,
        sheetTitle: "Score more of this match",
        body: `Score at least 75% of the points before generating highlights. You've scored ${state.scoredPoints} of ${state.scorablePoints}.`,
        actionLabel: "Score the Match",
        actionKind: "score",
        shouldPoll: false,
      };
    case "needs_generation":
      return {
        rowSummary: "Generate",
        sheetTitle: "Generate highlights?",
        body: "Highlights haven't been generated for this match. You can generate them from Tools.",
        actionLabel: "Generate highlights",
        shouldPoll: false,
      };
    case "needs_update":
      return {
        rowSummary: "Update needed",
        sheetTitle: "Update highlights",
        body: "This match changed after these highlights were prepared. Update them to use your latest rally edits.",
        actionLabel: "Update highlights",
        shouldPoll: false,
      };
    case "updating":
      return {
        rowSummary: "Updating rally clips",
        sheetTitle: "Highlights",
        body: "Your rally clips are still updating. You can update highlights when they’re ready.",
        actionLabel: null,
        shouldPoll: true,
      };
    case "rendering":
      return {
        rowSummary: "Preparing highlights",
        sheetTitle: "Highlights",
        body: "Your highlights are being prepared.",
        actionLabel: null,
        shouldPoll: true,
      };
    case "empty":
    case "unavailable":
      return {
        rowSummary: "No highlight rallies",
        sheetTitle: "Highlights",
        body: "No rallies met the highlight quality threshold.",
        actionLabel: null,
        shouldPoll: false,
      };
    case "failed":
      return {
        rowSummary: "Highlights unavailable",
        sheetTitle: "Highlights",
        body: "Highlights couldn't be prepared for this match.",
        actionLabel: null,
        shouldPoll: false,
      };
  }
}

export function highlightRequestSheetIsVisible(
  open: boolean,
  state: HighlightState | null,
): boolean {
  return Boolean(open && state && state.status !== "ready");
}

/** During the 0.3s crossfade, the incoming rally owns the overlap. */
export function highlightPointIdAt(
  manifest: HighlightManifest,
  seconds: number,
): string | null {
  let answer: string | null = null;
  for (const point of manifest.points) {
    if (seconds < point.output_start_s) break;
    if (seconds <= point.output_end_s + 0.01) answer = point.point_id;
  }
  return answer;
}

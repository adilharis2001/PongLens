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
      status:
        | "rendering"
        | "needs_update"
        | "updating"
        | "empty"
        | "unavailable"
        | "failed";
    };

const nonPlayable = new Set([
  "rendering",
  "needs_update",
  "updating",
  "empty",
  "unavailable",
  "failed",
]);

export function parseHighlightResponse(value: unknown): HighlightState {
  if (!value || typeof value !== "object") return { status: "failed" };
  const row = value as Record<string, unknown>;
  if (typeof row.status === "string" && nonPlayable.has(row.status)) {
    return { status: row.status as Exclude<HighlightState, HighlightAsset>["status"] };
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
  shouldPoll: boolean;
};

export function highlightLifecycleView(
  state: Exclude<HighlightState, HighlightAsset>,
): HighlightLifecycleView {
  switch (state.status) {
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

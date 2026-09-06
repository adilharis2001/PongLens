export type HighlightManifestPoint = {
  point_id: string;
  cut_start_s: number;
  cut_end_s: number;
  output_start_s: number;
  output_end_s: number;
  n_hits: number;
  connected_crossings: number;
  table_bounces: number;
};

export type HighlightManifest = {
  v: 1;
  rule: "quality-first-v1";
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
  | { status: "rendering" | "empty" | "unavailable" | "failed" };

const nonPlayable = new Set(["rendering", "empty", "unavailable", "failed"]);

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
    manifest.v !== 1 ||
    manifest.rule !== "quality-first-v1" ||
    !Array.isArray(manifest.points) ||
    manifest.points.length === 0
  ) {
    return { status: "failed" };
  }
  return row as HighlightAsset;
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

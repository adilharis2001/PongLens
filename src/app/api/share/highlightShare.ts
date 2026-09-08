export function highlightShareCanBeCreated(
  reel: { status?: string | null; r2_key?: string | null } | null,
): boolean {
  return reel?.status === "ready" && Boolean(reel.r2_key);
}

export function highlightShareMediaKey(
  matchId: string,
  row: { match_id?: string | null; r2_key?: string | null } | null,
): string | null {
  if (row?.match_id !== matchId || !row.r2_key) return null;
  const escapedMatchId = matchId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^reels/${escapedMatchId}-highlights-[0-9a-f]{16}\\.mp4$`,
  );
  return pattern.test(row.r2_key) ? row.r2_key : null;
}

export interface SafeHighlightTimelineRow {
  point_id: string;
  output_start_s: number;
  output_end_s: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Treat the worker manifest as untrusted at the public boundary. A broken
 * row must never make the score jump to the wrong rally for a stranger.
 */
export function sanitizeHighlightTimeline(
  value: unknown,
): SafeHighlightTimelineRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((row): SafeHighlightTimelineRow[] => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const pointId =
        typeof record.point_id === "string" ? record.point_id : "";
      const start = Number(record.output_start_s);
      const end = Number(record.output_end_s);

      if (
        !UUID_PATTERN.test(pointId) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start
      ) {
        return [];
      }

      return [
        {
          point_id: pointId,
          output_start_s: start,
          output_end_s: end,
        },
      ];
    })
    .sort((a, b) => a.output_start_s - b.output_start_s);
}

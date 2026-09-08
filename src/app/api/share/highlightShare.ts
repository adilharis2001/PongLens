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

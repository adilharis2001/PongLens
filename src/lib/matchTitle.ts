/**
 * The derived match title — one display name for a match, composed from
 * atomic facts and never stored. opponent_name holds a PERSON; venue the
 * place it was played; played_at the capture date. Owner-led (no "Me vs"):
 *
 *   "{opponent} · {venue} · {date}"   person + venue known
 *   "{opponent} · {date}"             person only
 *   "{venue} · {date}"                venue only (no opponent)
 *   "Match · {date}"                  neither
 *
 * Both the dashboard cards and the match header render this — ONE definition,
 * so the two never disagree.
 */

/** Compact absolute date, e.g. "Jul 23, 2026". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function deriveMatchTitle({
  opponentName,
  venue,
  playedAt,
}: {
  opponentName?: string | null;
  venue?: string | null;
  playedAt: string;
}): string {
  const opp = (opponentName ?? "").trim();
  const v = (venue ?? "").trim();
  const date = shortDate(playedAt);
  const parts: string[] = [];
  if (opp) parts.push(opp);
  if (v) parts.push(v);
  if (parts.length === 0) parts.push("Match");
  parts.push(date);
  return parts.join(" · ");
}

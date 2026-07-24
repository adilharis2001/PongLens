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

const MATCH_TYPE_LABEL: Record<string, string> = {
  practice: "Practice",
  league: "League",
  tournament: "Tournament",
};

/**
 * Title/subtitle split for list + header display. The one-line
 * deriveMatchTitle truncated once venue + date piled on; a title/subtitle
 * hierarchy keeps the identifying part (who + where) whole and pushes the
 * date/type/count metadata to a muted second line.
 *
 *   primary:   "{opponent} · {venue}"  (either alone, or "Match" if neither)
 *   secondary: "{date} · {type} · {n} points"  (parts folded in as known)
 */
export function deriveMatchTitleParts({
  opponentName,
  venue,
  playedAt,
  matchType,
  pointCount,
}: {
  opponentName?: string | null;
  venue?: string | null;
  playedAt: string;
  matchType?: string | null;
  pointCount?: number | null;
}): { primary: string; secondary: string } {
  const opp = (opponentName ?? "").trim();
  const v = (venue ?? "").trim();
  const head: string[] = [];
  if (opp) head.push(opp);
  if (v) head.push(v);
  if (head.length === 0) head.push("Match");

  const tail: string[] = [shortDate(playedAt)];
  const type = matchType ? MATCH_TYPE_LABEL[matchType] : null;
  if (type) tail.push(type);
  if (pointCount && pointCount > 0) {
    tail.push(`${pointCount} point${pointCount === 1 ? "" : "s"}`);
  }

  return { primary: head.join(" · "), secondary: tail.join(" · ") };
}

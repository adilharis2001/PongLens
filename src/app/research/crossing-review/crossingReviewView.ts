import type { CrossingReviewRow } from "./data";

export type CrossingReviewTab = "missed_junk" | "flagged_kept";

export interface CrossingReviewFilter {
  readonly tab: CrossingReviewTab;
  readonly match: string; // "all" or a matchId
}

export interface MatchOption {
  readonly matchId: string;
  readonly label: string;
  readonly count: number;
}

/** Matches present in the current tab, alphabetical, with row counts. */
export function matchOptions(
  rows: readonly CrossingReviewRow[],
  tab: CrossingReviewTab,
): MatchOption[] {
  const byMatch = new Map<string, MatchOption>();
  for (const row of rows) {
    if (row.cls !== tab) continue;
    const existing = byMatch.get(row.matchId);
    if (existing) {
      byMatch.set(row.matchId, { ...existing, count: existing.count + 1 });
    } else {
      byMatch.set(row.matchId, {
        matchId: row.matchId,
        label: row.venue ? `${row.opponent} at ${row.venue}` : row.opponent,
        count: 1,
      });
    }
  }
  return [...byMatch.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterRows(
  rows: readonly CrossingReviewRow[],
  filter: CrossingReviewFilter,
): CrossingReviewRow[] {
  return rows.filter(
    (row) =>
      row.cls === filter.tab &&
      (filter.match === "all" || row.matchId === filter.match),
  );
}

/** Seconds into the original video as m:ss, for finding the moment again. */
export function formatClock(t0: number): string {
  const total = Math.max(0, Math.floor(t0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function tabCounts(
  rows: readonly CrossingReviewRow[],
): Record<CrossingReviewTab, number> {
  const counts = { missed_junk: 0, flagged_kept: 0 };
  for (const row of rows) counts[row.cls] += 1;
  return counts;
}

export type CrossingVerdict =
  | "measurement_miss"
  | "label_wrong_junk"
  | "no_cross_real"
  | "handover"
  | "label_wrong_real"
  | "ghost";

/**
 * The three answers that matter per tab, mirrored in migration 097.
 *
 * flagged_kept: a kept point the track shows no crossing for. Either the
 * measurement missed a real crossing, the scoring was wrong, or the point
 * genuinely had none (netted serve or fault) — the class the rule can
 * never be safe on.
 * missed_junk: a deleted point whose track crossed. Either a handover
 * toss, a scoring mistake, or a crossing the tracker invented.
 */
export const VERDICTS: Record<
  CrossingReviewTab,
  ReadonlyArray<{ value: CrossingVerdict; label: string }>
> = {
  flagged_kept: [
    { value: "measurement_miss", label: "Real, ball crossed" },
    { value: "label_wrong_junk", label: "Actually junk" },
    { value: "no_cross_real", label: "Real, never crossed" },
  ],
  missed_junk: [
    { value: "handover", label: "Toss between players" },
    { value: "label_wrong_real", label: "Actually a real point" },
    { value: "ghost", label: "Other table or ghost" },
  ],
};

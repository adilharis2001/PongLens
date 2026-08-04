/**
 * Pure formatting for the players portal. The durations come from point
 * spans (source t0/t1, cut cut_t0), so they are close-enough estimates of
 * the two videos, not probed file lengths.
 */

export interface PlayerOverviewRow {
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  access_source: string | null;
  used_bytes: number;
  storage_limit_bytes: number;
  matches: number;
  matches_scored: number;
  points: number;
  starred: number;
  notes: number;
  voice_notes: number;
  journal_entries: number;
  exports: number;
  share_links: number;
  est_cost_usd: number;
}

export interface PlayerMatchRow {
  id: string;
  opponent_name: string | null;
  match_type: string | null;
  played_at: string | null;
  created_at: string;
  status: string;
  placement_status: string | null;
  placement_mapped_points: number | null;
  has_cut: boolean;
  src_duration_s: number | null;
  cut_duration_s: number | null;
  points: number;
  scored_points: number;
  unscored_points: number;
  starred: number;
  notes: number;
  exports: number;
  job_status: string | null;
  job_error: string | null;
}

export interface PlayerDetailPayload {
  profile: {
    user_id: string;
    email: string;
    name: string | null;
    created_at: string;
    last_sign_in_at: string | null;
    access_source: string | null;
    used_bytes: number;
    storage_limit_bytes: number;
    handedness: string | null;
    grip: string | null;
    style: string | null;
  } | null;
  engagement: {
    notes: number;
    voice_notes: number;
    journal_entries: number;
    tags: number;
    tagged_points: number;
    share_links: number;
    coaches: number;
    recollect_jobs: number;
    uploads_failed: number;
  };
  est_cost_usd: number;
  matches: PlayerMatchRow[];
}

const GB = 1024 ** 3;

export function countLabel(
  n: number,
  singular: string,
  plural = `${singular}s`
): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function gbLabel(bytes: number): string {
  const v = (bytes / GB).toFixed(1);
  return `${v.endsWith(".0") ? v.slice(0, -2) : v} GB`;
}

/** Seconds to a clock: 754 -> "12:34", 5025 -> "1:23:45". */
export function formatClock(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** How much of the source survived the cut: "77% kept". */
export function retentionLabel(
  srcSeconds: number | null,
  cutSeconds: number | null
): string | null {
  if (
    srcSeconds == null ||
    cutSeconds == null ||
    !Number.isFinite(srcSeconds) ||
    !Number.isFinite(cutSeconds) ||
    srcSeconds <= 0 ||
    cutSeconds < 0
  ) {
    return null;
  }
  const pct = Math.min(100, Math.round((cutSeconds / srcSeconds) * 100));
  return `${pct}% kept`;
}

/** "12:34 → 9:41" when both timelines exist, one alone otherwise. */
export function durationsLabel(
  srcSeconds: number | null,
  cutSeconds: number | null
): string | null {
  const src = formatClock(srcSeconds);
  const cut = formatClock(cutSeconds);
  if (src && cut) return `${src} → ${cut}`;
  return src ?? cut;
}

/** A match's scoring state, matching the library's chip rule. */
export function scoringLabel(row: {
  points: number;
  scored_points: number;
  unscored_points: number;
}): string {
  if (row.points === 0) return "No points";
  if (row.scored_points === 0) return countLabel(row.points, "point");
  if (row.unscored_points === 0) {
    return `${countLabel(row.points, "point")}, scored`;
  }
  return `${row.scored_points}/${row.points} scored`;
}

export function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

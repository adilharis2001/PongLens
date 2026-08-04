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

/** One point of a match, as admin_match_points (069) returns it. */
export interface AdminPoint {
  id: string;
  idx: number;
  t0: number;
  t1: number;
  cut_t0: number | null;
  server: string | null;
  confirmed_winner: "user" | "opponent" | null;
  is_let: boolean;
  warmup: boolean;
  deleted: boolean;
  edited: boolean;
  starred: boolean;
  tight_start: boolean;
  tight_end: boolean;
  misread_kind: string | null;
  has_clip: boolean;
}

export interface PointBreakdownRow extends AdminPoint {
  lengthS: number;
  /** dead time the cut removed before this point (source timeline) */
  gapBeforeS: number;
}

/** Ordered rows with each point's length and the dead gap ahead of it. */
export function buildPointBreakdown(
  points: AdminPoint[]
): PointBreakdownRow[] {
  const ordered = [...points].sort(
    (a, b) => Number(a.t0) - Number(b.t0) || a.idx - b.idx
  );
  let prevEnd = 0;
  return ordered.map((p) => {
    const t0 = Number(p.t0);
    const t1 = Number(p.t1);
    const row: PointBreakdownRow = {
      ...p,
      t0,
      t1,
      cut_t0: p.cut_t0 == null ? null : Number(p.cut_t0),
      lengthS: Math.max(0, t1 - t0),
      gapBeforeS: Math.max(0, t0 - prevEnd),
    };
    prevEnd = Math.max(prevEnd, t1);
    return row;
  });
}

export interface TimelineSegment {
  idx: number;
  leftPct: number;
  widthPct: number;
  deleted: boolean;
}

/**
 * The kept spans as percentages of the source timeline, for the strip.
 * The unpainted remainder is what the cut removed.
 */
export function timelineSegments(
  rows: PointBreakdownRow[]
): TimelineSegment[] {
  const total = rows.reduce((max, r) => Math.max(max, r.t1), 0);
  if (total <= 0) return [];
  return rows.map((r) => ({
    idx: r.idx,
    leftPct: (r.t0 / total) * 100,
    widthPct: Math.max(0.2, ((r.t1 - r.t0) / total) * 100),
    deleted: r.deleted,
  }));
}

/** What stands out about a point when grading the cut. */
export function pointFlags(p: AdminPoint): string[] {
  const flags: string[] = [];
  if (p.edited) flags.push("edited");
  if (p.tight_start && p.tight_end) flags.push("tight");
  else if (p.tight_start) flags.push("tight start");
  else if (p.tight_end) flags.push("tight end");
  if (p.is_let) flags.push("let");
  if (p.warmup) flags.push("warmup");
  if (p.deleted) flags.push("deleted");
  if (p.misread_kind) flags.push("misread");
  return flags;
}

/** "21:59 played · 4:57 removed" for the strip's caption. */
export function breakdownSummary(rows: PointBreakdownRow[]): string | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((max, r) => Math.max(max, r.t1), 0);
  const played = rows.reduce((sum, r) => sum + r.lengthS, 0);
  const playedLabel = formatClock(played);
  const removedLabel = formatClock(Math.max(0, total - played));
  if (!playedLabel || !removedLabel) return null;
  return `${playedLabel} played · ${removedLabel} removed`;
}

export function gapLabel(gapBeforeS: number): string | null {
  if (gapBeforeS < 1) return null;
  return `+${Math.round(gapBeforeS)}s dead`;
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

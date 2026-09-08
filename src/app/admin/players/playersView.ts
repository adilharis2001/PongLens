/**
 * Pure formatting for the players portal. The durations come from point
 * spans (source t0/t1, cut cut_t0), so they are close-enough estimates of
 * the two videos, not probed file lengths.
 */

/** What an account IS, from the admin's own list (176). */
export type PlayerKind = "real" | "team" | "test";

export interface PlayerOverviewRow {
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Newest upload; null for an account that has never uploaded. */
  last_upload_at: string | null;
  kind: PlayerKind;
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


/* ------------------------------------------------------------------ *
 * Who to show, and in what order (Adil, 2026-09-05).
 *
 * The list was one tall column of forty-seven accounts ordered by match
 * count, so his own test accounts sat at the top and a real person who
 * joined this morning sat wherever their upload count put them. Ten of
 * the forty-seven are genuine users.
 *
 * Both of these are pure so they can be tested without a database.
 * ------------------------------------------------------------------ */

export type PlayerSort = "active" | "joined" | "matches";

export const PLAYER_SORTS: { key: PlayerSort; label: string }[] = [
  { key: "active", label: "Recently active" },
  { key: "joined", label: "Recently joined" },
  { key: "matches", label: "Most matches" },
];

/** How recently something happened, for the "is this worth a look" read.
 *  Null (never uploaded) sorts last rather than as the epoch. */
function stamp(value: string | null): number {
  return value ? Date.parse(value) : -Infinity;
}

export function sortPlayers(
  rows: PlayerOverviewRow[],
  sort: PlayerSort,
): PlayerOverviewRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (sort === "matches") {
      if (b.matches !== a.matches) return b.matches - a.matches;
      return stamp(b.created_at) - stamp(a.created_at);
    }
    if (sort === "joined") return stamp(b.created_at) - stamp(a.created_at);
    // "active": the newest upload, and an account that has never uploaded
    // falls back to when it joined, so a brand new signup with nothing in
    // it still surfaces near the top rather than at the bottom.
    const av = a.last_upload_at ? stamp(a.last_upload_at) : stamp(a.created_at);
    const bv = b.last_upload_at ? stamp(b.last_upload_at) : stamp(b.created_at);
    return bv - av;
  });
  return out;
}

export function filterPlayers(
  rows: PlayerOverviewRow[],
  kind: PlayerKind | "all",
  query: string,
): PlayerOverviewRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (kind !== "all" && r.kind !== kind) return false;
    if (!q) return true;
    return (
      r.email.toLowerCase().includes(q) ||
      (r.name ?? "").toLowerCase().includes(q)
    );
  });
}

/** Days since a timestamp, or null when there is none. */
export function daysSince(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  return Math.floor((now - Date.parse(value)) / 86_400_000);
}

/** "today" / "3d" / "2w" / "Aug 9" — short enough for a table cell.
 *  Never "0 days ago", which reads as a bug beside a real date. */
export function agoLabel(value: string | null, now = Date.now()): string {
  const d = daysSince(value, now);
  if (d === null) return "—";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return new Date(value as string).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** A signup worth noticing: joined inside a week. */
export function isNew(row: PlayerOverviewRow, now = Date.now()): boolean {
  const d = daysSince(row.created_at, now);
  return d !== null && d <= 7;
}

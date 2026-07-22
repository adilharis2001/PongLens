/**
 * Shapes returned by the SECURITY DEFINER share-resolution functions
 * (migration 013) plus the tiny display helpers the /s page and its OG
 * image share. Server-side only concern: clip/cut R2 paths never leave
 * the server (the media route signs them).
 */

export interface ResolvedShareLink {
  kind: "point" | "match" | "starred";
  match_id: string;
  point_id: string | null;
  opponent_name: string | null;
  player_near_name: string | null;
  player_far_name: string | null;
  played_at: string;
  cut_path: string | null;
  original_name: string | null;
  point_number: number | null;
  point_t0: number | null;
  point_t1: number | null;
  point_clip_path: string | null;
  point_starred: boolean | null;
  point_confirmed_winner: "user" | "opponent" | null;
  point_confirmed_how: string | null;
}

export interface ResolvedSharePoint {
  id: string;
  t0: number | null;
  t1: number | null;
  clip_path: string | null;
  starred: boolean;
  is_let: boolean;
  confirmed_winner: "user" | "opponent" | null;
}

/** Row from resolve_share_starred(): a currently-starred visible point. */
export interface ResolvedStarredPoint {
  id: string;
  /** display number (position among all non-deleted points) */
  number: number;
  t0: number | null;
  t1: number | null;
  clip_path: string | null;
}

/** "Adil vs Marco" | "vs Marco" | null — whatever names exist. */
export function playersLine(link: {
  player_near_name: string | null;
  player_far_name: string | null;
  opponent_name: string | null;
}): string | null {
  const near = (link.player_near_name ?? "").trim();
  const far = (link.player_far_name ?? "").trim();
  if (near && far) return `${near} vs ${far}`;
  const opp = (link.opponent_name ?? "").trim();
  if (opp) return `vs ${opp}`;
  return null;
}

/** "Point 14 · 12s rally" (duration omitted when timing is missing). */
export function pointContextLine(link: {
  point_number: number | null;
  point_t0: number | null;
  point_t1: number | null;
}): string {
  const n = link.point_number ?? 0;
  const base = n > 0 ? `Point ${n}` : "Point";
  const dur =
    link.point_t0 !== null && link.point_t1 !== null
      ? Math.max(0, Math.round(Number(link.point_t1) - Number(link.point_t0)))
      : null;
  return dur !== null ? `${base} · ${dur}s rally` : base;
}

/** "4 points · Adil vs Marco" | "1 point · vs Marco" | "Starred points". */
export function starredContextLine(
  count: number,
  names: string | null
): string {
  if (count < 1) return names ?? "Starred points";
  const pts = `${count} ${count === 1 ? "point" : "points"}`;
  return names ? `${pts} · ${names}` : pts;
}

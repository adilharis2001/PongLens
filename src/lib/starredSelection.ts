/**
 * Starred points picked from any number of matches (2026-09-22): the rules
 * the link and the video share, kept out of the routes so they can be
 * tested. The iOS twin of the limits is in Core/Starred.swift.
 * Spec: docs/superpowers/specs/2026-09-22-starred-points-selection-design.md
 */

/** A link names up to this many points (share_links_check says the same). */
export const SELECTION_LINK_MAX_POINTS = 100;
/** A video renders up to this many (enqueue_selection_reel says the same). */
export const SELECTION_VIDEO_MAX_POINTS = 60;

export type SelectionVideoPurpose = "instagram" | "save";

/** Instagram takes a minute in a Reel; a saved video may run three. */
export function selectionVideoCapS(purpose: SelectionVideoPurpose): number {
  return purpose === "instagram" ? 60 : 180;
}

/** Half a second of grace, the same backstop /api/reel gives a Reel. */
export function selectionVideoTooLong(
  seconds: number,
  purpose: SelectionVideoPurpose,
): boolean {
  return seconds > selectionVideoCapS(purpose) + 0.5;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ids a request names, lower-cased and in the order picked, with a
 * repeat kept once where it first appeared. Null for anything that is not a
 * list of 1..max ids — the caller answers that with a 400.
 */
export function selectionPointIds(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || !UUID_RE.test(v)) return null;
    const id = v.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length > 0 && out.length <= max ? out : null;
}

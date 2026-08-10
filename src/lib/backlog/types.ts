/**
 * The backlog's vocabulary. Mirrors migration 088.
 *
 * Two independent axes, on purpose:
 *   lane        priority — what you would pick up if an evening opened;
 *   target_date when — the date you are aiming at, or null for someday.
 *
 * Keeping them separate is what lets one list answer both "what am I on
 * right now" (the list view, grouped by lane) and "what is this month
 * shaped like" (the timeline, laid out by date) without either view
 * lying about the other.
 */

/**
 * Retired as an organizing axis (091). The list is grouped by WHEN now —
 * see sections.ts — and priority is the manual order inside a section
 * rather than a lane you assign. The column survives because it still
 * answers the one question sections cannot: finished, or not.
 *
 * Anything that is not 'done' is open. The other three values are only
 * ever seen on rows written before 091 and mean nothing beyond "open".
 */
export type BacklogLane = "now" | "next" | "later" | "done";

export const LANE_LABEL: Record<BacklogLane, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  done: "Done",
};

/** What a newly captured or reopened item gets. */
export const OPEN_LANE: BacklogLane = "next";

export interface BacklogItem {
  id: string;
  author_id: string;
  title: string;
  notes: string;
  /** Free text, '' when untagged. Never an enum — see the migration. */
  tag: string;
  lane: BacklogLane;
  /**
   * YYYY-MM-DD, or null for someday. Never asked for at capture — it is
   * written by dropping the card into a section, and the sections are
   * derived back out of it (see sections.ts).
   */
  target_date: string | null;
  /** Manual position within its section, ascending. Lower is higher up,
   *  and higher up means higher priority. */
  sort: number;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

/**
 * Tags offered on a brand-new list, before anything real exists to
 * suggest. Starting points only: the picker offers whatever the list
 * already uses, and any word typed in is a tag.
 */
export const STARTER_TAGS = [
  "dev",
  "marketing",
  "content",
  "design",
  "ops",
  "research",
] as const;

/**
 * The tags currently in use, most-used first, with the starters filling
 * in behind them. This is what the picker offers: a list that learns
 * from what you actually write without ever blocking a new word.
 */
export function suggestedTags(items: BacklogItem[], limit = 10): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const tag = item.tag.trim();
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const used = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
  const seen = new Set(used.map((t) => t.toLowerCase()));
  for (const starter of STARTER_TAGS) {
    if (used.length >= limit) break;
    if (!seen.has(starter)) used.push(starter);
  }
  return used.slice(0, limit);
}

/** Normalizes a typed tag: trimmed, collapsed, and capped to the column. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 40);
}

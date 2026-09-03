/**
 * Pure helpers behind the coach workspace's cards, kept out of the React
 * components so they can be tested with node --test. The iOS twins live
 * in CoachCards.swift; keep the rules in step.
 */

export interface EntryTakeaways {
  title?: string | null;
  themes?: { name: string; points: string[] }[] | null;
}

/** One line to name an entry: the distilled title, else the opening words. */
export function entryTitle(
  transcript: string | null | undefined,
  takeaways: EntryTakeaways | null | undefined,
  max = 72,
): string {
  const title = takeaways?.title?.trim();
  if (title) return title;
  const words = (transcript ?? "").replace(/\s+/g, " ").trim();
  if (!words) return "Entry";
  return words.length > max ? `${words.slice(0, max)}…` : words;
}

/** The roster row's second line. */
export function studentSummary(
  linked: boolean,
  matches: number,
  entries: number,
): string {
  if (!linked) return "Not on PongLens yet";
  const parts: string[] = [];
  if (matches > 0) parts.push(`${matches} match${matches === 1 ? "" : "es"}`);
  if (entries > 0) parts.push(`${entries} entr${entries === 1 ? "y" : "ies"}`);
  return parts.length > 0 ? parts.join(" · ") : "On PongLens";
}

/** How a student's match is named in a coach list. */
export function matchLabel(match: {
  opponent_name: string | null;
  original_name: string | null;
  match_type: string | null;
}): string {
  if (match.opponent_name) return `vs ${match.opponent_name}`;
  if (match.original_name) return match.original_name;
  return match.match_type === "practice" ? "Practice" : "Match";
}

/** The per-user storage key for the workspace choice (157). */
export function workspaceKey(userId: string): string {
  return `pl-workspace:${userId}`;
}

/**
 * Theme analysis: the shape of the page, without any of the drawing.
 *
 * The themes themselves are Adil's own words, typed into the card review
 * box on /admin/uploads/<id> while watching a match ("fast smash not
 * detected", "missing lob getting cut"). This module answers the question
 * that box cannot: across every match, where does one theme actually turn
 * up, and is it one venue's problem or everywhere.
 */

/** One themed card, as `admin_theme_cards` returns it (164). */
export interface ThemeCardRow {
  point_id: string;
  match_id: string;
  idx: number;
  t0: number;
  t1: number;
  cut_t0: number | null;
  tight_start: boolean;
  tight_end: boolean;
  has_clip: boolean;
  note: string | null;
  note_at: string | null;
  theme_ids: string[];
  themes: string[];
  opponent_name: string | null;
  venue: string | null;
  played_at: string | null;
  clip_pads: { pre: number; post: number } | null;
  strictness: string | null;
  match_json_path: string | null;
  has_cut: boolean;
}

/** One theme, as `admin_themes_list` returns it (150). */
export interface ThemeRow {
  id: string;
  label: string;
  points: number;
  created_at: string;
}

/**
 * A theme with the reach of its cards worked out.
 *
 * `cards` and `matches` are the pair worth reading together: eight cards
 * on one match is a bad upload, eight cards on eight matches is a defect
 * in the pipeline. The page puts them side by side for exactly that
 * reason, and sorts on matches first so the general problems rise.
 */
export interface ThemeReach {
  id: string;
  label: string;
  cards: number;
  matches: number;
  venues: string[];
  /** Every card carrying this theme, newest match first. */
  rows: ThemeCardRow[];
}

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

/**
 * Themes with their cards attached, widest reach first.
 *
 * A card carrying three themes appears under all three: it is one piece of
 * footage that is evidence for three different problems, and hiding it
 * under whichever theme happened to be added first would lose two of them.
 *
 * Themes with no cards are dropped rather than listed empty. A theme is
 * created by typing it onto a card, so a themeless one only exists after
 * the last card carrying it was untagged, and an empty row on this page is
 * a dead end rather than information.
 */
export function buildThemeReach(
  themes: ThemeRow[],
  rows: ThemeCardRow[]
): ThemeReach[] {
  const byId = new Map<string, ThemeCardRow[]>();
  for (const row of rows) {
    for (const id of row.theme_ids) {
      const list = byId.get(id);
      if (list) list.push(row);
      else byId.set(id, [row]);
    }
  }

  return themes
    .map((theme) => {
      const own = byId.get(theme.id) ?? [];
      return {
        id: theme.id,
        label: theme.label,
        cards: own.length,
        matches: new Set(own.map((r) => r.match_id)).size,
        venues: uniqueSorted(own.map((r) => r.venue)),
        rows: own,
      };
    })
    .filter((t) => t.cards > 0)
    .sort(
      (a, b) =>
        b.matches - a.matches || b.cards - a.cards || a.label.localeCompare(b.label)
    );
}

/**
 * How a theme's reach reads in one line.
 *
 * Deliberately says "match" and "matches" rather than printing a bare
 * pair of numbers: "3 cards · 3 matches" is a table cell, and this sits
 * under a heading where a sentence belongs.
 */
export function reachLine(theme: ThemeReach): string {
  const cards = `${theme.cards} ${theme.cards === 1 ? "card" : "cards"}`;
  const matches = `${theme.matches} ${
    theme.matches === 1 ? "match" : "matches"
  }`;
  const venues =
    theme.venues.length === 1
      ? theme.venues[0]
      : theme.venues.length > 1
        ? `${theme.venues.length} venues`
        : null;
  return [cards, matches, venues].filter(Boolean).join(" · ");
}

/**
 * Seconds to add to a source time to reach the CUT video, or null when the
 * card has no place in it.
 *
 * This is `cutOffsetFor` from the admin page with the pad rule applied for
 * the caller, so the two surfaces cannot drift: the pad is the match's
 * stored one, narrowed on a split boundary exactly as the owner's player
 * narrows it. Kept as one function because getting it wrong offsets every
 * bounce ring by about a second and still looks entirely plausible.
 */
export function cardCutOffset(
  row: ThemeCardRow,
  pre: number
): number | null {
  if (row.cut_t0 === null || !Number.isFinite(Number(row.cut_t0))) return null;
  return Number(row.cut_t0) + pre - Number(row.t0);
}

/** The matches a set of rows touches, so the page can read each one's
 *  artifacts exactly once rather than once per card. */
export function distinctMatchIds(rows: ThemeCardRow[]): string[] {
  return [...new Set(rows.map((r) => r.match_id))];
}

/** "Young 2 · Westchester TTC" — whichever of the two the row has. */
export function cardWhere(row: ThemeCardRow): string {
  return [row.opponent_name || "Match", row.venue].filter(Boolean).join(" · ");
}

/**
 * Which matches the library needs point rows for.
 *
 * The library used to pull EVERY point in the account on mount and again on
 * every poll — 1.5k rows at 25 matches, growing linearly with the library —
 * purely to compute each card's games-score chip. It only ever needs points
 * for the cards actually on screen.
 *
 * The subtlety, and the reason this is a function with a test rather than an
 * inline filter: the set of cards on screen normally depends on the filters,
 * and one of the filters (Scored / Unscored) depends on the chips this fetch
 * produces. Deriving the fetch target from the score filter would deadlock —
 * no points means no chips, no chips means nothing passes "Scored", nothing
 * rendered means nothing to fetch points for, forever.
 *
 * So the target is built from the score-INDEPENDENT filters only (search,
 * status, type, sort, cap), and any view that genuinely reasons about scores
 * falls back to loading the whole account, which is what this page did
 * before. Correct first, scoped where it's safe to be.
 */

/** The card fields this decision needs — deliberately structural, so the
 *  test doesn't have to build whole match rows. */
export interface ChipTargetCard {
  id: string;
  status: string;
}

export type ChipScoreFilter = "all" | "scored" | "unscored";

/**
 * Match ids whose points must be loaded, or `null` meaning "every point in
 * the account" (the score-aware fallback).
 *
 * `baseFilteredOwn` / `baseFilteredShared` are the rendered lists AFTER the
 * score-independent filters and sort, and BEFORE the cap — mirroring what
 * the grid draws. Own matches are capped; shared ones are never capped in
 * the UI, so they aren't here either.
 */
export function chipTargetIds({
  baseFilteredOwn,
  baseFilteredShared,
  cap,
  scoreFilter,
  tokens,
}: {
  baseFilteredOwn: ChipTargetCard[];
  baseFilteredShared: ChipTargetCard[];
  cap: number;
  scoreFilter: ChipScoreFilter;
  tokens: string[];
}): string[] | null {
  // Filtering by score reasons about matches that were never rendered.
  if (scoreFilter !== "all") return null;

  // Same for searching it: "scored" / "unscored" are tokens in every card's
  // search haystack, so a query that could match them has to see the whole
  // library. Only tokens long enough to be *about* the word count — a bare
  // "s" or "un" matches half the account through names and dates anyway, so
  // treating those as score-aware would give up the optimisation on the
  // first keystroke of any search.
  if (tokens.some((t) => t.length >= 3 && "unscored".includes(t))) return null;

  // Cap first, THEN drop the unready ones: the cap counts cards drawn, and
  // a processing card occupies a slot without owning any points.
  const drawn = [...baseFilteredOwn.slice(0, cap), ...baseFilteredShared];
  return [
    ...new Set(drawn.filter((m) => m.status === "ready").map((m) => m.id)),
  ];
}

import type { NoteFeedRow } from "../types.ts";

/**
 * The starter questions under an empty Ask box.
 *
 * The rule this file exists to enforce: **a suggested question must be
 * answerable.** Suggesting "How do I do against Alex?" and then answering
 * "you have no match with Alex" is worse than suggesting nothing, because
 * it makes the feature look broken at the exact moment someone is trying
 * it for the first time.
 *
 * That is not hypothetical. It shipped. note_feed() is has_match_access
 * scoped, so it hands a coach every note on their students' matches too,
 * and the opponent name was picked from that whole feed — while the Ask
 * corpus deliberately keeps only notes on matches the asker OWNS. The
 * suggestion named an opponent the answer could not see, by construction.
 *
 * So the names here are drawn from exactly the same rows the corpus keeps,
 * and the questions are phrased against the material that produced the
 * name. If a name got into a suggestion, the writing behind it is in the
 * corpus, and the question can be answered.
 */

/**
 * The opponent this player writes about most, counting ONLY their own
 * matches — the same `match_owner_id` filter the corpus applies.
 */
export function topOpponentFromNotes(
  rows: NoteFeedRow[] | null,
  userId: string,
): string | null {
  const counts = new Map<string, number>();
  for (const n of rows ?? []) {
    // The filter that matters. Without it a coach's students' opponents
    // leak into their own suggestions.
    if (n.match_owner_id !== userId) continue;
    const name = n.opponent_name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}

/**
 * Up to three questions. A name only appears when it came from this
 * player's own material, and the question asks about the writing that
 * produced it rather than about match statistics, which a name drawn from
 * notes cannot promise exist.
 */
export function askExamples(opts: {
  coachName?: string | null;
  opponentName?: string | null;
}): string[] {
  const out: string[] = [];
  // Coach names come from the lessons table, which RLS scopes to the
  // author, so a coach name is always the asker's own.
  if (opts.coachName) {
    out.push(`What has ${opts.coachName} told me to work on?`);
  }
  if (opts.opponentName) {
    // Phrased against the notes, not the scoreboard: the name was found
    // in a note, so notes about them certainly exist. "How do I do
    // against X" quietly promises a win-loss record, which only exists
    // once that match has been scored.
    out.push(`What have I written about playing ${opts.opponentName}?`);
  }
  out.push("What keeps costing me points?");
  if (out.length < 3) out.push("What should I work on next?");
  return out.slice(0, 3);
}

/**
 * The sample match: one finished match every signed-in account can read.
 *
 * It is ONE match (migration 20260918030000 flags it and opens the read),
 * owned by us and read by everybody. Nobody gets a copy, so it costs a new
 * account no storage, and every write policy stays owner-scoped, so a reader
 * can look and nothing else.
 *
 * It shows on Home and in the library until the player has scored a match of
 * their own; after that Account -> Support is the way back to it. "Scored"
 * means the same thing the library's chip means (every point answered), so
 * there is one definition of scored in the product, not two.
 */

export const SAMPLE_CHIP = "Demo";
/** The sample is named for what it is, not for who played in it: every
 *  other card names an opponent, and this one has none for the reader. */
export const SAMPLE_TITLE = "PongLens Demo Match";
export const SAMPLE_CTA = "View sample match";
export const SAMPLE_FIRST_STEP = "Review the sample match";
/** The two players, unnamed, wherever the analysis would use real names. */
export const SAMPLE_NEAR_LABEL = "Player 1";
export const SAMPLE_FAR_LABEL = "Player 2";
/** Notes on the sample are ours, so they are signed PongLens rather than
 *  with the name of whoever typed them. */
export const SAMPLE_NOTE_AUTHOR = "PongLens";

export function isSampleMatch(m: { is_sample?: boolean | null }) {
  return m.is_sample === true;
}

/**
 * Has this player finished scoring a match of their own? Pass their own
 * matches (the sample is not one of them) and the score chips the surface
 * already computed.
 */
export function hasOwnScoredMatch(
  ownMatches: { id: string }[],
  chips: Map<string, { complete: boolean }>,
) {
  return ownMatches.some((m) => chips.get(m.id)?.complete === true);
}

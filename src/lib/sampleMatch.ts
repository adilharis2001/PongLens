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
export const SAMPLE_DOOR_TITLE = "See a finished match first";
export const SAMPLE_DOOR_BODY = "Ours, already processed and scored.";
export const SAMPLE_DOOR_CTA = "Open the sample match";
export const SAMPLE_ACCOUNT_ROW = "View sample match";
export const SAMPLE_MATCH_NOTE =
  "A real match between the two of us who built PongLens.";

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

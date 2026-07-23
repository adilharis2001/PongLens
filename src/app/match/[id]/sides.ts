/**
 * Side derivation for server/winner chips.
 *
 * The worker labels points.server with a fixed assumption:
 *   'user'     = the player NEAR the camera
 *   'opponent' = the player FAR from the camera
 * matches.user_side records which side the uploader actually played from.
 * Until it is set, chips use neutral near/far wording so we never show a
 * possibly-wrong "You served".
 */

export type Side = "near" | "far";

export function otherSide(s: Side): Side {
  return s === "near" ? "far" : "near";
}

/**
 * The user's PHYSICAL (camera-frame) side for a given game. Players change
 * ends every game, and matches.user_side is tagged from the first point's
 * frame, i.e. it is the user's side in game 1 (game index 0). Odd game
 * indexes flip it. Game index comes from the confirmed score's game
 * boundaries; with no confirmed games everything is game 0.
 */
export function physicalSideForGame(userSide: Side, gameIndex: number): Side {
  return gameIndex % 2 === 0 ? userSide : otherSide(userSide);
}

/** The table side points.server refers to (worker semantics). */
export function serverSide(server: "user" | "opponent"): Side {
  return server === "user" ? "near" : "far";
}

export function serverChip(
  server: "user" | "opponent",
  userSide: Side | null,
  isOwner: boolean
): { label: string; tone: "user" | "opponent" | "neutral" } {
  const side = serverSide(server);
  if (!userSide) {
    return {
      label: side === "near" ? "Near player served" : "Far player served",
      tone: "neutral",
    };
  }
  const servedByUser = side === userSide;
  if (servedByUser) {
    return { label: isOwner ? "I served" : "Player served", tone: "user" };
  }
  return {
    label: isOwner ? "They served" : "Opponent served",
    tone: "opponent",
  };
}

export const CHIP_TONE: Record<"user" | "opponent" | "neutral", string> = {
  user: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
  opponent: "border-magenta-glow/40 bg-magenta-glow/10 text-magenta-soft",
  neutral: "border-edge bg-ink/40 text-zinc-400",
};

/**
 * The AI suggestion's winner is stored with the same near=user assumption.
 * Flip it when the uploader was actually the far player.
 */
export function suggestedWinnerFor(
  winner: "user" | "opponent" | null | undefined,
  userSide: Side | null
): "user" | "opponent" | null {
  if (!winner) return null;
  if (!userSide) return null; // no prefill until sides are confirmed
  if (userSide === "near") return winner;
  return winner === "user" ? "opponent" : "user";
}

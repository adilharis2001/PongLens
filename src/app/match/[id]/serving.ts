import type { Point } from "@/lib/types";
import type { Side } from "./sides";

/**
 * ITTF serve rotation — the source of truth for "who served".
 *
 * Once the owner sets matches.first_server ('user' = the uploader), the
 * displayed server for every non-deleted, non-let point is
 * computed here:
 *   - 2-serve blocks, alternating;
 *   - from 10-10 in the current game's CONFIRMED score, alternate each
 *     point (deuce);
 *   - the first server swaps at every game boundary (same 11-with-2-clear
 *     heuristic as gameScore.ts, confirmed points only);
 *   - skipped points (is_let — lets, misrecordings, anything the owner
 *     excluded) keep the same server and don't advance the rotation or
 *     score;
 *   - points.server_override is both the displayed server for its point
 *     and the rotation anchor for everything after it (rotation is
 *     anchored to the most recent override before each point). An
 *     override that contradicts the computed walk re-anchors the WHOLE
 *     downstream walk — including which side the current game's first
 *     server was, so later game boundaries alternate from the corrected
 *     parity, not from the original first_server.
 *
 * Auto-detected points.server (worker near/far frame) is only the default
 * guess for first_server and the display fallback while rotation can't be
 * computed.
 */

export type MatchServer = "user" | "opponent";

export interface ServeInfo {
  /** Computed server in the uploader frame; null = fall back to auto. */
  server: MatchServer | null;
  source: "rotation" | "override" | "auto";
  isLet: boolean;
}

export function otherServer(s: MatchServer): MatchServer {
  return s === "user" ? "opponent" : "user";
}

/** Chip for a rotation-computed server (uploader frame, no side needed). */
export function rotationChip(
  server: MatchServer,
  isOwner: boolean
): { label: string; tone: "user" | "opponent" } {
  if (server === "user") {
    return { label: isOwner ? "You served" : "Player served", tone: "user" };
  }
  return {
    label: isOwner ? "They served" : "Opponent served",
    tone: "opponent",
  };
}

/**
 * Default guess for first_server: majority-vote the first two points with
 * an auto-detected server. Detection is in the worker's near/far frame, so
 * the guess needs user_side to translate into the uploader frame.
 */
export function firstServerGuess(
  visiblePoints: Point[],
  userSide: Side | null
): MatchServer | null {
  if (!userSide) return null;
  const detected = visiblePoints
    .map((p) => p.server)
    .filter((s): s is MatchServer => s !== null)
    .slice(0, 2);
  if (detected.length === 0) return null;
  // Points 1 and 2 share a server under ITTF rotation, so agreement
  // confirms the vote; on a split (or a single sample) trust the first.
  const vote = detected[0];
  const servedSide: Side = vote === "user" ? "near" : "far";
  return servedSide === userSide ? "user" : "opponent";
}

/**
 * Compute the displayed server for each visible point.
 * `visiblePoints` must be the timeline: non-deleted, in order.
 */
export function computeServing(
  visiblePoints: Point[],
  firstServer: MatchServer | null
): Map<string, ServeInfo> {
  const result = new Map<string, ServeInfo>();
  let cur: MatchServer | null = firstServer;
  let gameFirst: MatchServer | null = firstServer;
  let servesInBlock = 0;
  let you = 0;
  let them = 0;

  for (const p of visiblePoints) {
    if (p.server_override) {
      // Anchor: this point's server is the override, and the rotation
      // continues from here. Chosen semantics:
      //
      //  - The rotation keeps its slot phase (servesInBlock is NOT
      //    reset): an override relabels WHO is serving, not where the
      //    2-serve block boundaries fall — real servers alternate on
      //    the point count, which a correction can't move.
      //  - The game's first-server parity re-anchors with it: if the
      //    override contradicts the computed walk, everything the walk
      //    believed about this game was inverted — including who served
      //    first — so gameFirst flips too, and the next game boundary
      //    alternates from the CORRECTED first server (ITTF 2.13.3),
      //    not from the original first_server anchor.
      //  - An override that agrees with the walk is a pure pin:
      //    nothing changes.
      if (cur !== null && gameFirst !== null && p.server_override !== cur) {
        gameFirst = otherServer(gameFirst);
      }
      if (cur === null) {
        // First anchor of the whole walk (first_server unknown): there
        // is no existing phase to preserve — start a fresh 2-serve
        // block and let this game's first server default to the anchor.
        servesInBlock = 0;
      }
      cur = p.server_override;
      if (gameFirst === null) gameFirst = cur;
    }

    if (p.is_let) {
      // Skipped (let / misrecorded / other): same server serves again;
      // no rotation or score advance.
      result.set(p.id, {
        server: cur,
        source: p.server_override
          ? "override"
          : cur !== null
            ? "rotation"
            : "auto",
        isLet: true,
      });
      continue;
    }

    result.set(p.id, {
      server: cur,
      source: p.server_override
        ? "override"
        : cur !== null
          ? "rotation"
          : "auto",
      isLet: false,
    });

    // Advance the rotation.
    servesInBlock += 1;
    if (p.confirmed_winner === "user") you += 1;
    else if (p.confirmed_winner === "opponent") them += 1;
    const deuce = you >= 10 && them >= 10;
    if (cur !== null && servesInBlock >= (deuce ? 1 : 2)) {
      cur = otherServer(cur);
      servesInBlock = 0;
    }

    // Game boundary (same heuristic as computeMatchScore).
    if ((you >= 11 || them >= 11) && Math.abs(you - them) >= 2) {
      you = 0;
      them = 0;
      servesInBlock = 0;
      if (gameFirst !== null) {
        gameFirst = otherServer(gameFirst);
        cur = gameFirst;
      }
    }
  }
  return result;
}

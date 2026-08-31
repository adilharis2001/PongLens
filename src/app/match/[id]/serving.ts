import type { Point } from "@/lib/types";
import {
  createBoundaryWalk,
  stepBoundaryWalk,
  type GameEndOverride,
} from "./gameScore.ts";
import type { Side } from "./sides.ts";

/**
 * ITTF serve rotation — the source of truth for "who served".
 *
 * Once the owner sets matches.first_server ('user' = the uploader), the
 * displayed server for every non-deleted, non-let point is
 * computed here:
 *   - 2-serve blocks, alternating;
 *   - from 10-10 in the current game's CONFIRMED score, alternate each
 *     point (deuce);
 *   - the first server swaps at every game boundary — boundaries come
 *     from gameScore.ts stepBoundaryWalk, the SAME walk computeMatchScore
 *     uses (11-with-2-clear plus the owner's game_end_override
 *     end/continue pins — POSITIONAL, honored on unscored and skipped
 *     points too), so score dividers and serve rotation can never
 *     disagree about where a game ends;
 *   - skipped points (is_let — lets, misrecordings, anything the owner
 *     excluded) keep the same server and don't advance the rotation or
 *     score — but a boundary override pinned on one still closes the
 *     game there (first server alternates for the next point);
 *   - points.server_override is both the displayed server for its point
 *     and the rotation anchor for everything after it (rotation is
 *     anchored to the most recent override before each point). An
 *     override that contradicts the computed walk re-anchors the WHOLE
 *     downstream walk — it starts a fresh 2-serve block here, and the
 *     current game's first-server parity flips with it, so later game
 *     boundaries alternate from the corrected parity rather than from
 *     the original first_server.
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

/**
 * Chip for a rotation-computed server (uploader frame, no side needed).
 * neutralLabels names the two players by side ("{name} served") for a
 * neutral / third-party match, where "I"/"They" would misattribute play to
 * the uploader (see MatchView's `neutral`).
 */
export function rotationChip(
  server: MatchServer,
  isOwner: boolean,
  neutralLabels?: { you: string; them: string }
): { label: string; tone: "user" | "opponent" } {
  if (server === "user") {
    const label = neutralLabels
      ? `${neutralLabels.you} served`
      : isOwner
        ? "I served"
        : "Player served";
    return { label, tone: "user" };
  }
  const label = neutralLabels
    ? `${neutralLabels.them} served`
    : isOwner
      ? "They served"
      : "Opponent served";
  return { label, tone: "opponent" };
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
  firstServer: MatchServer | null,
  detectedOverrides: ReadonlyMap<string, GameEndOverride> = new Map()
): Map<string, ServeInfo> {
  const result = new Map<string, ServeInfo>();
  let cur: MatchServer | null = firstServer;
  let gameFirst: MatchServer | null = firstServer;
  let servesInBlock = 0;
  // Shared boundary walk (gameScore.ts): carries the current game's
  // confirmed score for the deuce check AND decides game boundaries —
  // identical to computeMatchScore's, overrides included.
  const walk = createBoundaryWalk();

  for (const p of visiblePoints) {
    if (p.server_override) {
      // Anchor: this point's server is the override, and the rotation
      // continues from here. Chosen semantics:
      //
      //  - A CONTRADICTING override starts a new 2-serve block here
      //    (servesInBlock resets). It used to preserve the block phase
      //    on the reasoning that a correction relabels who serves
      //    without moving where the blocks fall — but the commonest
      //    reason a rotation is wrong is a rally the cut MISSED, and a
      //    missing rally IS a block boundary that moved. Preserving the
      //    phase there left the walk right on every other card, so
      //    fixing one match took an override on every remaining point
      //    (measured: 7 taps over 12 cards). Restarting the block takes
      //    one. Someone saying "he started serving here" means exactly
      //    that, which is also the only reading that can express a
      //    dropped point.
      //  - The game's first-server parity re-anchors with it: if the
      //    override contradicts the computed walk, everything the walk
      //    believed about this game was inverted — including who served
      //    first — so gameFirst flips too, and the next game boundary
      //    alternates from the CORRECTED first server (ITTF 2.13.3),
      //    not from the original first_server anchor.
      //  - An override that AGREES with the walk is a pure pin: the
      //    block phase and the parity both stand, nothing changes.
      if (cur === null || p.server_override !== cur) {
        if (cur !== null && gameFirst !== null) {
          gameFirst = otherServer(gameFirst);
        }
        servesInBlock = 0;
      }
      cur = p.server_override;
      if (gameFirst === null) gameFirst = cur;
    }

    if (p.is_let) {
      // Skipped (let / misrecorded / other): same server serves again;
      // no rotation or score advance. Its boundary override is still
      // POSITIONAL though — an 'end' pinned here closes the game and the
      // next point starts the new game with the alternated first server
      // (identical partition to computeMatchScore's walk).
      result.set(p.id, {
        server: cur,
        source: p.server_override
          ? "override"
          : cur !== null
            ? "rotation"
            : "auto",
        isLet: true,
      });
      const endedAtLet = stepBoundaryWalk(
        walk,
        null,
        p.game_end_override ?? detectedOverrides.get(p.id) ?? null
      );
      if (endedAtLet) {
        servesInBlock = 0;
        if (gameFirst !== null) {
          gameFirst = otherServer(gameFirst);
          cur = gameFirst;
        }
      }
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

    // Advance the rotation. EVERY visible non-let point folds through the
    // shared walk: a scored one contributes its winner, an unscored one
    // contributes null (no score movement) — but both consume their
    // positional game_end_override, exactly like computeMatchScore.
    servesInBlock += 1;
    const ended = stepBoundaryWalk(
      walk,
      p.confirmed_winner ?? null,
      p.game_end_override ?? detectedOverrides.get(p.id) ?? null
    );
    // Deuce check on the post-point score. When the point just closed a
    // game the walk has already reset (0-0, deuce false) — irrelevant:
    // the boundary branch below overwrites cur/servesInBlock anyway.
    const deuce = walk.you >= 10 && walk.them >= 10;
    if (cur !== null && servesInBlock >= (deuce ? 1 : 2)) {
      cur = otherServer(cur);
      servesInBlock = 0;
    }

    // Game boundary (identical to computeMatchScore — same walk).
    if (ended) {
      servesInBlock = 0;
      if (gameFirst !== null) {
        gameFirst = otherServer(gameFirst);
        cur = gameFirst;
      }
    }
  }
  return result;
}

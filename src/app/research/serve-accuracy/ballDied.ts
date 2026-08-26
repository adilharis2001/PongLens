import type { DetectedEvent } from "./serveAccuracyModel";
import {
  deadRunLoser,
  deadRunReasonCopy,
  findDeadRuns,
  type DeadRun,
} from "./deadRun";
import { findNetDeath, netDeathLoser, type NetDeath } from "./netDeath";

/**
 * The ball died on the table, and the side it died on lost the point.
 *
 * One rule, two witnesses. Adil noticed they were describing the same
 * thing and asked whether they should be one, and the corpus agrees:
 * where both can see a point they fire together on 24 and disagree on
 * none. Neither contains the other, though, which is why both stay:
 *
 * - THE BOUNCES. Three or more on one half in quick succession with
 *   nobody hitting the ball between them. Needs no ball track, and reads
 *   two physically different endings — a player putting it into the net
 *   (18 of 37) and a ball nobody could return (19 of 37). Only about half
 *   of these involve the net at all, which is what the old "dead run"
 *   name got wrong.
 *
 * - THE TURN. The ball's track reversing at the net line, then dropping
 *   twice on the half it came back to. Needs the track, but only two
 *   bounces — so it sees the eight points where the ball simply never
 *   bounced a third time, which the bounce witness cannot reach at all.
 *
 * Merging them changes no verdict: bounces first, turn second, and the
 * combined rule sits where the bounce rule used to. That is safe because
 * the turn and the off-table read never both fire on the same point —
 * measured, zero of 174 — so promoting the turn ahead of off-table takes
 * nothing away from it. 45 of 174 scored points, 43 right.
 */

export type BallDiedVia = "bounces" | "turn";

export interface BallDiedCall {
  loser: "near" | "far";
  via: BallDiedVia;
  /** Set when the bounces were the witness. */
  run: DeadRun | null;
  /** Set when the turn at the net was the witness. */
  turn: NetDeath | null;
}

export function findBallDied(
  events: readonly DetectedEvent[],
  track: readonly (readonly number[])[] | null,
  corners: Record<string, [number, number]> | null,
  clipT0: number | null,
  source: { width: number; height: number } | null,
  userPhysicalSide: "near" | "far" | null,
): BallDiedCall | null {
  const runs = findDeadRuns(events);
  const byBounce = deadRunLoser(runs, userPhysicalSide);
  if (byBounce !== null && userPhysicalSide !== null) {
    const run = runs[runs.length - 1];
    return {
      loser: byBounce === "user" ? userPhysicalSide
        : userPhysicalSide === "near" ? "far" : "near",
      via: "bounces",
      run,
      turn: null,
    };
  }
  const turn = findNetDeath(events, track, corners, clipT0, source);
  if (netDeathLoser(turn, userPhysicalSide) !== null && turn !== null) {
    return { loser: turn.loser, via: "turn", run: null, turn };
  }
  return null;
}

export function ballDiedLoser(
  call: BallDiedCall | null,
  userPhysicalSide: "near" | "far" | null,
): "user" | "opponent" | null {
  if (call === null || userPhysicalSide === null) return null;
  return call.loser === userPhysicalSide ? "user" : "opponent";
}

/** What happened, said from the losing player's side. */
export function ballDiedReasonCopy(call: BallDiedCall): string {
  if (call.via === "bounces" && call.run) return deadRunReasonCopy(call.run);
  if (call.turn) {
    return `turned ${call.turn.distM.toFixed(2)} m from the net and died there`;
  }
  return "let the ball die there";
}

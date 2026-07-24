import type { Point } from "@/lib/types";
import type { MatchScore } from "./gameScore";
import type { ServeInfo } from "./serving";

/**
 * Match statistics DERIVED from the scored points — nothing here leans on
 * the vision's how-suggestions. Every input is user-confirmed or
 * rotation-derived:
 *   - a point counts only when SCORED (confirmed_winner set, not skipped);
 *   - the server per point comes from computeServing (ITTF rotation +
 *     overrides), so it matches the chip shown on the point;
 *   - the 2nd-serve split uses ServeInfo.serveInBlock, which the same
 *     rotation walk fills in (pre-deuce only — see serving.ts).
 *
 * "You" is always the uploader ('user'); percentages are null when there's
 * nothing to divide by, so callers can render an honest "—".
 */

interface Rate {
  played: number;
  won: number;
  /** whole-number win % over `played`, or null when played is 0 */
  pct: number | null;
}

export interface MatchStats {
  /** any confirmed-winner points at all — the section unlocks on this */
  hasData: boolean;
  /** are servers known (first_server set)? gates the serve-based rows */
  serverKnown: boolean;
  won: number;
  lost: number;
  serve: Rate;
  secondServe: Rate;
  receive: Rate;
  gamesYou: number;
  gamesThem: number;
  /** longest run of consecutive scored points you won */
  longestStreak: number;
}

function rate(won: number, played: number): Rate {
  return { played, won, pct: played > 0 ? Math.round((won / played) * 100) : null };
}

export function computeMatchStats(
  points: Point[],
  serving: Map<string, ServeInfo>,
  score: MatchScore
): MatchStats {
  let won = 0;
  let lost = 0;
  let servePlayed = 0;
  let serveWon = 0;
  let secondPlayed = 0;
  let secondWon = 0;
  let recvPlayed = 0;
  let recvWon = 0;
  let streak = 0;
  let longestStreak = 0;

  for (const p of points) {
    // Only SCORED points: a confirmed winner, not skipped.
    if (p.is_let || p.confirmed_winner === null) continue;
    const iWon = p.confirmed_winner === "user";
    if (iWon) {
      won += 1;
      streak += 1;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      lost += 1;
      streak = 0;
    }

    const server = serving.get(p.id)?.server ?? null;
    if (server === "user") {
      servePlayed += 1;
      if (iWon) serveWon += 1;
      // serveInBlock === 2 is a second serve in a 2-serve block, which the
      // rotation only ever reaches pre-deuce (single serves at 10-10+).
      if (serving.get(p.id)?.serveInBlock === 2) {
        secondPlayed += 1;
        if (iWon) secondWon += 1;
      }
    } else if (server === "opponent") {
      recvPlayed += 1;
      if (iWon) recvWon += 1;
    }
  }

  return {
    // Stats only mean something once a full game is on the board — a
    // handful of points reads as "100% on serve" and misleads.
    hasData: score.gamesYou + score.gamesThem > 0,
    serverKnown: servePlayed + recvPlayed > 0,
    won,
    lost,
    serve: rate(serveWon, servePlayed),
    secondServe: rate(secondWon, secondPlayed),
    receive: rate(recvWon, recvPlayed),
    gamesYou: score.gamesYou,
    gamesThem: score.gamesThem,
    longestStreak,
  };
}

/** Tiny right-side summary for the Tools "Match Statistics" row. */
export function statsRowSummary(stats: MatchStats): string {
  if (!stats.hasData) return "Finish a game first";
  if (stats.serve.pct !== null) return `${stats.serve.pct}% on serve`;
  return `${stats.won}–${stats.lost}`;
}

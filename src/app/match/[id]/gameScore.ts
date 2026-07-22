import type { Point } from "@/lib/types";

/**
 * Running match score from the confirmed-winner sequence, with game
 * boundaries auto-detected by the standard 11-with-2-clear heuristic:
 * a game ends the moment someone has >= 11 points and leads by 2 (which
 * handles deuce for free). Unconfirmed points simply don't count.
 */
export interface GameSummary {
  you: number;
  them: number;
}

/** A completed game's divider info, keyed by the point that finished it. */
export interface GameBoundary {
  /** the completed game's number (1-based) */
  game: number;
  /** the completed game's final score */
  you: number;
  them: number;
}

export interface MatchScore {
  /** completed games, in order */
  games: GameSummary[];
  /** running score of the game in progress */
  current: GameSummary;
  confirmedCount: number;
  gamesYou: number;
  gamesThem: number;
  /** point id -> the game that ENDS at this point (divider after the card) */
  boundaryAfter: Map<string, GameBoundary>;
}

export function computeMatchScore(orderedPoints: Point[]): MatchScore {
  const games: GameSummary[] = [];
  const boundaryAfter = new Map<string, GameBoundary>();
  let you = 0;
  let them = 0;
  let confirmedCount = 0;
  for (const p of orderedPoints) {
    if (!p.confirmed_winner) continue;
    confirmedCount += 1;
    if (p.confirmed_winner === "user") you += 1;
    else them += 1;
    if ((you >= 11 || them >= 11) && Math.abs(you - them) >= 2) {
      games.push({ you, them });
      boundaryAfter.set(p.id, { game: games.length, you, them });
      you = 0;
      them = 0;
    }
  }
  return {
    games,
    current: { you, them },
    confirmedCount,
    gamesYou: games.filter((g) => g.you > g.them).length,
    gamesThem: games.filter((g) => g.them > g.you).length,
    boundaryAfter,
  };
}

/** Timeline order: by source-video time, worker idx as tiebreak/fallback. */
export function sortPoints(points: Point[]): Point[] {
  return [...points].sort((a, b) => {
    if (a.t0 !== null && b.t0 !== null) {
      const d = Number(a.t0) - Number(b.t0);
      if (d !== 0) return d;
    }
    return a.idx - b.idx;
  });
}

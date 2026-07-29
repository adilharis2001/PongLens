import type { Point } from "@/lib/types";
import {
  createBoundaryWalk,
  stepBoundaryWalk,
  type GameEndOverride,
  type MatchScore,
} from "./gameScore";
import type { ServeInfo } from "./serving";

/**
 * Match statistics DERIVED from the scored points — nothing here leans on
 * the vision's how-suggestions. Every input is user-confirmed or
 * rotation-derived:
 *   - a point counts only when SCORED (confirmed_winner set, not skipped);
 *   - the server per point comes from computeServing (ITTF rotation +
 *     overrides), so it matches the chip shown on the point.
 *
 * "You" is always the uploader ('user'); percentages are null when there's
 * nothing to divide by, so callers can render an honest "—".
 */

export interface Rate {
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
  receive: Rate;
  gamesYou: number;
  gamesThem: number;
  /** longest run of consecutive scored points you won */
  longestStreak: number;
  /** scored points that also say HOW they ended — the analysis only gets
   *  sharper as this closes on won + lost, so it drives the nudge. */
  detailed: number;
  /** points played at the business end (either side on 9+ entering it) */
  pressure: Rate;
  /** of the points right after one you lost, how many you took back */
  bounceBack: Rate;
}

export function rate(won: number, played: number): Rate {
  return { played, won, pct: played > 0 ? Math.round((won / played) * 100) : null };
}

export function computeMatchStats(
  points: Point[],
  serving: Map<string, ServeInfo>,
  score: MatchScore,
  detectedOverrides: ReadonlyMap<string, GameEndOverride> = new Map()
): MatchStats {
  let won = 0;
  let lost = 0;
  let servePlayed = 0;
  let serveWon = 0;
  let recvPlayed = 0;
  let recvWon = 0;
  let streak = 0;
  let longestStreak = 0;
  let pressurePlayed = 0;
  let pressureWon = 0;
  let bouncePlayed = 0;
  let bounceWon = 0;
  let lastWasLoss = false;
  let detailed = 0;

  // Running game score, for "was this a pressure point". Same walk the
  // dividers and the rotation use, so 9-9 here means 9-9 on the scorebug.
  const walk = createBoundaryWalk();

  for (const p of points) {
    // Only SCORED points: a confirmed winner, not skipped. Skipped points
    // still consume their positional boundary override.
    if (p.is_let || p.confirmed_winner === null) {
      stepBoundaryWalk(
        walk,
        null,
        p.game_end_override ?? detectedOverrides.get(p.id) ?? null
      );
      continue;
    }
    const iWon = p.confirmed_winner === "user";
    if (p.confirmed_how) detailed += 1;
    // Score ENTERING the point decides whether it was played under pressure.
    const tight = walk.you >= 9 || walk.them >= 9;
    if (tight) {
      pressurePlayed += 1;
      if (iWon) pressureWon += 1;
    }
    if (lastWasLoss) {
      bouncePlayed += 1;
      if (iWon) bounceWon += 1;
    }
    lastWasLoss = !iWon;
    stepBoundaryWalk(
      walk,
      p.confirmed_winner,
      p.game_end_override ?? detectedOverrides.get(p.id) ?? null
    );
    if (iWon) {
      won += 1;
      streak += 1;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      lost += 1;
      streak = 0;
    }

    const info = serving.get(p.id);
    const server = info?.server ?? null;
    if (server === "user") {
      servePlayed += 1;
      if (iWon) serveWon += 1;
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
    receive: rate(recvWon, recvPlayed),
    gamesYou: score.gamesYou,
    gamesThem: score.gamesThem,
    longestStreak,
    detailed,
    pressure: rate(pressureWon, pressurePlayed),
    bounceBack: rate(bounceWon, bouncePlayed),
  };
}

/**
 * Right-side summary for the Tools "Match analysis" row.
 *
 * Deliberately NOT a bare percentage. "55% on serve" out of context tells
 * you nothing about whether the analysis is worth opening — it looks like a
 * number the app invented. What matters at this level is how much of the
 * analysis you have actually earned, so the row reports readiness and then
 * completeness, and says what to do when it is short of either.
 */
export function statsRowSummary(stats: MatchStats): string {
  const scored = stats.won + stats.lost;
  if (scored === 0) return "Score points to unlock";
  if (!stats.hasData) return "Finish a game to unlock";
  if (stats.detailed === 0) return `${scored} scored · add detail`;
  if (stats.detailed < scored) return `${stats.detailed}/${scored} detailed`;
  return `${scored} points · complete`;
}

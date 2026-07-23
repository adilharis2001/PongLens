import type { Point } from "@/lib/types";

/**
 * Running match score from the confirmed-winner sequence, with game
 * boundaries auto-detected by the standard 11-with-2-clear heuristic:
 * a game ends the moment someone has >= 11 points and leads by 2 (which
 * handles deuce for free). Unconfirmed points simply don't count.
 *
 * OWNER OVERRIDES (points.game_end_override): one mis-scored point makes
 * the auto boundary fire somewhere reality didn't — the video's visible
 * side-switch is the truth — so the walk consumes per-point overrides:
 *   'end'      — a game closes after this point regardless of the score;
 *   'continue' — the game does NOT close here, and the auto rule stays
 *                suppressed (no re-firing at 12-7, 13-7, ...) until a
 *                later explicit 'end'. With no later 'end', the game
 *                simply runs on as the current game;
 *   null       — automatic.
 * Overrides are only read on scored points — a skipped/unscored point
 * contributes neither score nor boundary.
 *
 * stepBoundaryWalk below is the SINGLE boundary authority: this file,
 * serving.ts (serve rotation + first-server alternation) and
 * /api/reel/route.ts (games_detail) all fold points through it, so game
 * boundaries can never disagree across surfaces.
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

export type GameEndOverride = "end" | "continue" | null;

/** Mutable state for one pass of the shared boundary walk. */
export interface BoundaryWalk {
  /** current game's running score */
  you: number;
  them: number;
  /** a 'continue' override is active: auto boundaries stay suppressed
   *  until an explicit 'end' closes the game */
  open: boolean;
}

export function createBoundaryWalk(): BoundaryWalk {
  return { you: 0, them: 0, open: false };
}

/**
 * Fold one SCORED point (confirmed winner, not skipped) into the walk.
 * Returns the completed game's final score when a game ends AT this point
 * (auto or override) — the walk resets itself for the next game — else
 * null. Callers pass the point's game_end_override (`?? null` for row
 * shapes that don't select it).
 */
export function stepBoundaryWalk(
  walk: BoundaryWalk,
  winner: "user" | "opponent",
  override: GameEndOverride
): GameSummary | null {
  if (winner === "user") walk.you += 1;
  else walk.them += 1;
  let ends: boolean;
  if (override === "end") {
    ends = true;
  } else if (override === "continue") {
    walk.open = true;
    ends = false;
  } else if (walk.open) {
    // A prior 'continue' holds the game open past any auto condition.
    ends = false;
  } else {
    ends =
      (walk.you >= 11 || walk.them >= 11) &&
      Math.abs(walk.you - walk.them) >= 2;
  }
  if (!ends) return null;
  const final = { you: walk.you, them: walk.them };
  walk.you = 0;
  walk.them = 0;
  walk.open = false;
  return final;
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
  /** scored point ids after which the game is held open by a 'continue'
   *  override (auto boundaries suppressed until an explicit 'end') */
  openAfter: Set<string>;
  /** the walk ended still held open by a 'continue' with no closing 'end' */
  open: boolean;
}

export function computeMatchScore(orderedPoints: Point[]): MatchScore {
  const games: GameSummary[] = [];
  const boundaryAfter = new Map<string, GameBoundary>();
  const openAfter = new Set<string>();
  const walk = createBoundaryWalk();
  let confirmedCount = 0;
  for (const p of orderedPoints) {
    // Skipped (is_let: let / misrecorded / other): never counts.
    if (p.is_let) continue;
    if (!p.confirmed_winner) continue;
    confirmedCount += 1;
    const ended = stepBoundaryWalk(
      walk,
      p.confirmed_winner,
      p.game_end_override ?? null
    );
    if (ended) {
      games.push(ended);
      boundaryAfter.set(p.id, { game: games.length, ...ended });
    } else if (walk.open) {
      openAfter.add(p.id);
    }
  }
  return {
    games,
    current: { you: walk.you, them: walk.them },
    confirmedCount,
    gamesYou: games.filter((g) => g.you > g.them).length,
    gamesThem: games.filter((g) => g.them > g.you).length,
    boundaryAfter,
    openAfter,
    open: walk.open,
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

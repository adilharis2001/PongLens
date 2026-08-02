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
 * Overrides are POSITIONAL: they are read on EVERY visible point —
 * scored, skipped, or unscored alike. An 'end' pinned on an unscored
 * point still closes the game right there (later points belong to the
 * next game); the owner pauses the video where the players switched
 * sides and pins the boundary on the rally on screen, whether or not
 * that rally has been scored yet. Score contribution is unchanged: a
 * skipped/unscored point adds nothing to the count — only its override
 * is consumed.
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

/** What it takes to win a game: 11 points, clear by 2. */
const GAME_TARGET = 11;
const CLEAR_BY = 2;

/**
 * Who WON a completed game — or null when nobody did.
 *
 * A game segment closes for two reasons, and only one of them proves a
 * winner. The auto rule fires BECAUSE someone got to 11 clear by 2, so
 * those games always name a winner. An owner's 'end' pin closes the game
 * wherever the players switched sides, no matter what the score says — and
 * when the points inside that game are still mostly unscored, the score
 * says almost nothing. A game the owner pinned but has only scored one
 * point of stands at 0-1: that is a lead over nothing, not a game won, and
 * counting it hands the match to whoever happens to be ahead in the
 * scoring you have not finished yet.
 *
 * So the games tally only counts what the score itself can prove. An
 * unfinished game counts for neither side until it is scored out.
 */
export function gameWinner(g: GameSummary): "user" | "opponent" | null {
  if (Math.max(g.you, g.them) < GAME_TARGET) return null;
  if (Math.abs(g.you - g.them) < CLEAR_BY) return null;
  return g.you > g.them ? "user" : "opponent";
}

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
 * Fold one VISIBLE point into the walk. `winner` is the point's score
 * contribution: 'user'/'opponent' for a scored point, null for a skipped
 * or unscored one (adds nothing to the count). The point's override is
 * consumed either way — boundaries are POSITIONAL, so an 'end' pinned on
 * an unscored/skipped point still closes the game at this point. Returns
 * the completed game's final score when a game ends AT this point (auto
 * or override) — the walk resets itself for the next game — else null.
 * Callers pass the point's game_end_override (`?? null` for row shapes
 * that don't select it).
 */
export function stepBoundaryWalk(
  walk: BoundaryWalk,
  winner: "user" | "opponent" | null,
  override: GameEndOverride
): GameSummary | null {
  if (winner === "user") walk.you += 1;
  else if (winner === "opponent") walk.them += 1;
  let ends: boolean;
  if (override === "end") {
    ends = true;
  } else if (override === "continue") {
    walk.open = true;
    ends = false;
  } else if (walk.open) {
    // A prior 'continue' holds the game open past any auto condition.
    ends = false;
  } else if (winner === null) {
    // No score movement: the auto rule can't newly fire here.
    ends = false;
  } else {
    // Same test the tally uses, so "the game ended here" and "this player
    // won it" can never come apart on an auto boundary.
    ends = gameWinner({ you: walk.you, them: walk.them }) !== null;
  }
  if (!ends) return null;
  const final = { you: walk.you, them: walk.them };
  walk.you = 0;
  walk.them = 0;
  walk.open = false;
  return final;
}

/**
 * What the game-boundary control offers on one point.
 *
 * ONE RULE: the label names what the TAP DOES, never what is true. If a
 * game closes at this point the button offers to reopen it; otherwise it
 * offers to close it here. Nothing else, and no lit/unlit state — where
 * the games actually break is visible on the timeline's dividers, and a
 * button that reports as well as acts is one you have to decode before
 * every tap.
 *
 * `next` is whichever value achieves the flip, so every tap has a defined
 * inverse: clearing to automatic is enough when automatic already agrees
 * with where you are going, otherwise it takes an explicit pin.
 *
 * Undoing your own 'end' clears to automatic rather than pinning
 * 'continue', because undoing a pin is what you asked for — and 'continue'
 * would go further, suppressing the auto rule for the rest of the game.
 * The cost is one unreachable-by-design case: if you pinned 'end' where
 * the 11-point rule would ALSO fire, clearing leaves the game ending there
 * and the button still offering "Didn't end" — a second tap then pins
 * 'continue' and does reopen it. The control never offers to pin 'end'
 * where the rule already ends the game, so getting there takes later
 * scoring moving the rule onto a point you had already pinned.
 */
export interface GameBoundaryAction {
  label: "Game ended" | "Didn't end";
  next: GameEndOverride;
  /** whether a game closes here as things stand */
  endsHere: boolean;
}

export function gameBoundaryAction(
  /** this point's own override */
  override: GameEndOverride,
  /** what the walk says about this point (already folds in every override) */
  walkEndsHere: boolean
): GameBoundaryAction {
  const endsHere =
    override === "end" ? true : override === "continue" ? false : walkEndsHere;
  return endsHere
    ? {
        label: "Didn't end",
        next: override === "end" ? null : "continue",
        endsHere,
      }
    : {
        label: "Game ended",
        next: override === "continue" ? null : "end",
        endsHere,
      };
}

export interface MatchScore {
  /** closed games, in order — including ones nobody has been shown to win */
  games: GameSummary[];
  /** running score of the game in progress */
  current: GameSummary;
  confirmedCount: number;
  /** games the score proves you won (see gameWinner) — not every closed one */
  gamesYou: number;
  gamesThem: number;
  /** point id -> the game that ENDS at this point (divider after the card) */
  boundaryAfter: Map<string, GameBoundary>;
  /** visible point ids after which the game is held open by a 'continue'
   *  override (auto boundaries suppressed until an explicit 'end') */
  openAfter: Set<string>;
  /** the walk ended still held open by a 'continue' with no closing 'end' */
  open: boolean;
}

export function computeMatchScore(
  orderedPoints: Point[],
  detectedOverrides: ReadonlyMap<string, GameEndOverride> = new Map()
): MatchScore {
  const games: GameSummary[] = [];
  const boundaryAfter = new Map<string, GameBoundary>();
  const openAfter = new Set<string>();
  const walk = createBoundaryWalk();
  let confirmedCount = 0;
  for (const p of orderedPoints) {
    // Score contribution: skipped (is_let: let / misrecorded / other) and
    // unscored points count nothing — but their overrides are POSITIONAL
    // boundaries, so every visible point folds through the walk.
    const winner = !p.is_let ? (p.confirmed_winner ?? null) : null;
    if (winner !== null) confirmedCount += 1;
    const override =
      p.game_end_override ?? detectedOverrides.get(p.id) ?? null;
    const ended = stepBoundaryWalk(walk, winner, override);
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
    gamesYou: games.filter((g) => gameWinner(g) === "user").length,
    gamesThem: games.filter((g) => gameWinner(g) === "opponent").length,
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

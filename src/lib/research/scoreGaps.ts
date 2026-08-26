import {
  createBoundaryWalk,
  resolvedGameWinner,
  stepBoundaryWalk,
  type GameEndOverride,
} from "../../app/match/[id]/gameScore.ts";

/**
 * The scoring a match's owner did, folded into games, and whether each game
 * could have ended the way it is recorded.
 *
 * A game of table tennis ends at 11, and past 10-all at the first two-point
 * lead. So a game recorded as 9-5 did not end: the person scoring ran out of
 * footage before the game ran out of points, which means rallies that were
 * played are not in the cut. That makes the scoring itself a detector for
 * dropped play — it costs nothing, needs no model, and its ground truth is
 * the rules of the game rather than anybody's judgement.
 *
 * Two things are worth separating, and the first version of this did not:
 *
 *   the LAST game of a match is short all the time, because the recording
 *   stopped. That is not a defect and counting it buries the real signal;
 *
 *   a short game with another game AFTER it is a defect, because play
 *   demonstrably carried on past it, so the missing points existed.
 *
 * The boundary walk is imported rather than restated. `stepBoundaryWalk` is
 * the single authority for where games break — the match page, the serve
 * rotation and the reel all fold through it — and a research page that
 * disagreed with the match page about which points are in game 2 would be
 * measuring its own second opinion.
 */

/** The point fields this reads. A full `Point` satisfies it. */
export interface ScoringPoint {
  readonly id: string;
  readonly idx: number;
  readonly t0: number | null;
  readonly t1: number | null;
  readonly is_let: boolean;
  readonly confirmed_winner: "user" | "opponent" | null;
  readonly game_end_override: GameEndOverride;
  readonly game_winner_override?: "user" | "opponent" | null;
}

export interface ScoredPoint {
  readonly id: string;
  readonly t0: number;
  readonly t1: number;
  /** null for a point that is skipped or simply not scored yet */
  readonly winner: "user" | "opponent" | null;
  readonly skipped: boolean;
  /** 1-based game this point belongs to */
  readonly game: number;
  /** the score once this point had been played */
  readonly you: number;
  readonly them: number;
  readonly endsGame: boolean;
}

/** A gap between two consecutive points, far longer than this game's own. */
export interface ScoreGap {
  /** where the gap opens: the end of the earlier point */
  readonly t: number;
  readonly seconds: number;
}

export interface ScoredGame {
  readonly game: number;
  readonly you: number;
  readonly them: number;
  readonly t0: number;
  readonly t1: number;
  /** could a real game have ended on this score */
  readonly legal: boolean;
  /** the match's last game: short here means the recording stopped */
  readonly final: boolean;
  /** short with play carrying on afterwards: points went missing */
  readonly suspect: boolean;
  readonly winner: "user" | "opponent" | null;
  /** how many points of this game carry a winner */
  readonly scored: number;
  /** points in this game with no winner and no skip reason: scoring the
   *  owner has not finished. A short game full of these is not evidence. */
  readonly unscored: number;
  /** ran past eleven without a game ending, rather than stopping short */
  readonly overrun: boolean;
  readonly points: readonly ScoredPoint[];
  readonly gaps: readonly ScoreGap[];
}

export interface MatchScoring {
  readonly points: readonly ScoredPoint[];
  readonly games: readonly ScoredGame[];
  /** points carrying a winner, and visible points in total */
  readonly scored: number;
  readonly visible: number;
  /** games short, fully scored, with play continuing after them */
  readonly suspect: number;
  /** games whose score ran past eleven without the game ending */
  readonly overrun: number;
  /** the fewest points that must be missing to explain those games */
  readonly missing: number;
}

const GAME_TARGET = 11;

/**
 * Could a real game have ended on this score?
 *
 * Not "somebody reached 11 and led by two" — that is the test for whether a
 * game ends AT a point, and applied to a final score it lets impossible ones
 * through. A game recorded 17-7 passes it, and 17-7 cannot happen: at 11-7
 * the game was already over. So there are exactly two legal shapes:
 *
 *   11 to nine or fewer, the ordinary win;
 *   past 10-all, two clear with the loser on ten or more.
 *
 * 12-10 and 13-11 are games. 14-10 is not, and neither is 11-10.
 */
export function couldHaveEnded(you: number, them: number): boolean {
  const hi = Math.max(you, them);
  const lo = Math.min(you, them);
  if (hi < GAME_TARGET) return false;
  if (hi === GAME_TARGET) return lo <= 9;
  return hi - lo === 2 && lo >= 10;
}

/**
 * The fewest rallies that have to be added to make this a game that could
 * have ended. Two rallies short of eleven is two; 11-10 is one, because
 * deuce needs a twelfth point. It is a floor, not an estimate: the real
 * number is whatever the players actually played.
 */
export function pointsShort(you: number, them: number): number {
  const hi = Math.max(you, them);
  const lo = Math.min(you, them);
  if (hi < GAME_TARGET) return GAME_TARGET - hi;
  if (hi - lo < 2) return 2 - (hi - lo);
  return 0;
}

/**
 * Gaps that stand out against the game they sit in, rather than against a
 * fixed number of seconds. A knock-up between games and a scramble for the
 * ball are both long; what marks a dropped rally is being long for THIS
 * game, whose own median gap already carries how quickly these two players
 * get on with it. The `median + 12` arm keeps a fast game from flagging
 * every ordinary pause: three times a 2-second median is 6 seconds, which
 * is just someone picking the ball up.
 */
function longGaps(points: readonly ScoredPoint[]): ScoreGap[] {
  if (points.length < 2) return [];
  const gaps = points
    .slice(0, -1)
    .map((p, i) => ({ t: p.t1, seconds: points[i + 1].t0 - p.t1 }));
  const sorted = [...gaps].map((g) => g.seconds).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!(median > 0)) return [];
  const limit = Math.max(3 * median, median + 12);
  return gaps.filter((g) => g.seconds > limit);
}

/**
 * Timeline order, matching `sortPoints`: by source time, worker idx as the
 * tiebreak. Ordering by idx alone is wrong on any match that has been split
 * — `split_point` gives the child `max(idx) + 1`, so it lands at the end of
 * the list and every game boundary after it falls in the wrong place.
 */
function byTime(a: ScoringPoint, b: ScoringPoint): number {
  if (a.t0 !== null && b.t0 !== null) {
    const d = a.t0 - b.t0;
    if (d !== 0) return d;
  }
  return a.idx - b.idx;
}

export function scoreMatch(visiblePoints: readonly ScoringPoint[]): MatchScoring {
  const ordered = [...visiblePoints].sort(byTime);
  const points: ScoredPoint[] = [];
  const walk = createBoundaryWalk();
  let game = 1;
  let scored = 0;
  const closed: {
    game: number;
    you: number;
    them: number;
    winner: "user" | "opponent" | null;
  }[] = [];

  for (const p of ordered) {
    // Score contribution: a skipped point counts nothing, but its override
    // is still a positional boundary. Same reading as computeMatchScore.
    const winner = !p.is_let ? (p.confirmed_winner ?? null) : null;
    if (winner !== null) scored += 1;
    const ended = stepBoundaryWalk(walk, winner, p.game_end_override ?? null);
    points.push({
      id: p.id,
      t0: p.t0 ?? 0,
      t1: p.t1 ?? p.t0 ?? 0,
      winner,
      skipped: p.is_let,
      game,
      you: ended ? ended.you : walk.you,
      them: ended ? ended.them : walk.them,
      endsGame: ended !== null,
    });
    if (ended) {
      closed.push({
        game,
        you: ended.you,
        them: ended.them,
        winner: resolvedGameWinner(
          p.game_winner_override
            ? { ...ended, winnerOverride: p.game_winner_override }
            : ended,
        ),
      });
      game += 1;
    }
  }

  // The game still running when the points ran out is a game too, and it is
  // the one most likely to be short. computeMatchScore reports it as
  // `current` rather than pushing it, which is right for a live scoreboard
  // and wrong here.
  const trailing = points.filter((p) => p.game === game);
  if (trailing.length) {
    closed.push({ game, you: walk.you, them: walk.them, winner: null });
  }

  const games: ScoredGame[] = closed.map((g, i) => {
    const own = points.filter((p) => p.game === g.game);
    const legal = couldHaveEnded(g.you, g.them);
    const unscored = own.filter((p) => p.winner === null && !p.skipped).length;
    const overrun = Math.max(g.you, g.them) > GAME_TARGET && !legal;
    return {
      game: g.game,
      you: g.you,
      them: g.them,
      t0: own.length ? own[0].t0 : 0,
      t1: own.length ? own[own.length - 1].t1 : 0,
      legal,
      final: i === closed.length - 1,
      // Three ordinary explanations are excused first, because each is a
      // different reason for a score that does not add up and none of them
      // is a missing rally. The last game of a match is short because the
      // recording stopped. A game with points still unscored is short
      // because the scoring is unfinished. A game that ran PAST eleven has
      // too many points rather than too few, which is a boundary in the
      // wrong place. What is left is a game whose every rally was watched
      // and called, which still did not reach eleven, and which had play
      // carry on after it: those rallies were played and are not in the cut.
      suspect:
        !legal && i !== closed.length - 1 && unscored === 0 && !overrun,
      winner: g.winner,
      scored: own.filter((p) => p.winner !== null).length,
      unscored,
      overrun,
      points: own,
      gaps: longGaps(own),
    };
  });

  const suspects = games.filter((g) => g.suspect);
  return {
    points,
    games,
    scored,
    visible: ordered.length,
    suspect: suspects.length,
    overrun: games.filter((g) => g.overrun).length,
    missing: suspects.reduce((n, g) => n + pointsShort(g.you, g.them), 0),
  };
}

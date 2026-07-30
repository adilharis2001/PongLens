import type { Match, Point } from "@/lib/types";
import {
  computeMatchScore,
  sortPoints,
} from "@/app/match/[id]/gameScore";
import { computeServing } from "@/app/match/[id]/serving";
import {
  computeMatchStats,
  rate,
  type Rate,
} from "@/app/match/[id]/matchStats";
import {
  computeMatchAnalysis,
  LENGTH_ORDER,
  SPIN_ORDER,
  type Count,
  type Tally,
} from "@/app/match/[id]/matchAnalysis";
import { userConfirmedFirstServer } from "@/app/match/[id]/matchStructure";

/**
 * Cross-match aggregation for /stats — YOUR game across every match.
 *
 * Everything folds through the SAME pure walks the match page uses
 * (gameScore / serving / matchStats / matchAnalysis), so a number here can
 * never disagree with the number on a match. This is deliberately client
 * code, not SQL: the ITTF rotation with overrides is the single boundary
 * authority and duplicating it in Postgres is how two surfaces drift apart.
 *
 * Ground rules, same contract as the per-match stats:
 *   - only user-confirmed or rotation-derived inputs, never vision guesses;
 *   - point-level cuts count every SCORED point, from any match;
 *   - the match RECORD counts only FULLY scored matches (a partial score
 *     next to a real one is ambiguous — same rule as the library's chips);
 *   - neutral / third-party matches are excluded entirely: these are your
 *     stats, and those matches belong to a named player who isn't you.
 */

export type MatchLite = Pick<
  Match,
  | "id"
  | "opponent_name"
  | "match_type"
  | "played_at"
  | "first_server"
  | "first_server_source"
  | "user_side"
  | "player_near_name"
  | "player_far_name"
>;

export interface MatchResult {
  id: string;
  played_at: string;
  opponent: string | null;
  match_type: Match["match_type"];
  gamesYou: number;
  gamesThem: number;
  ptsYou: number;
  ptsThem: number;
}

export interface OpponentRecord {
  name: string;
  matches: number;
  won: number;
  lost: number;
}

export interface AggregateStats {
  /** own (non-neutral) matches with at least one scored point */
  matchesWithScores: number;
  /** every scored point, across all matches */
  points: { won: number; lost: number };
  games: { you: number; them: number };
  /** fully scored matches, oldest first (the results timeline) */
  results: MatchResult[];
  /** games that reached 10-10 */
  deuceGames: { won: number; lost: number };
  serve: Rate;
  receive: Rate;
  pressure: Rate;
  bounceBack: Rate;
  longestStreak: number;
  serveMine: { spins: Tally[]; lengths: Tally[]; count: number };
  serveTheirs: { spins: Tally[]; count: number };
  errors: Count[];
  lossReasons: Count[];
  totalLost: number;
  direction: { won: Count[]; lost: Count[]; total: number };
  opponents: OpponentRecord[];
}

/** Same judgement as the library cards (dashboard/shared.tsx): the owner
 *  named their OWN side as someone who isn't the account holder. */
function isNeutral(m: MatchLite, accountName: string | null): boolean {
  const ownSide = (
    (m.user_side === "far" ? m.player_far_name : m.player_near_name) ?? ""
  ).trim();
  const acct = (accountName ?? "").trim().toLowerCase();
  return ownSide !== "" && (acct === "" || ownSide.toLowerCase() !== acct);
}

function mergeTallies(into: Map<string, Tally>, list: Tally[]) {
  for (const t of list) {
    const cur = into.get(t.label) ?? { label: t.label, won: 0, lost: 0 };
    cur.won += t.won;
    cur.lost += t.lost;
    into.set(t.label, cur);
  }
}

function mergeCounts(into: Map<string, number>, list: Count[]) {
  for (const c of list) into.set(c.label, (into.get(c.label) ?? 0) + c.count);
}

/** Fixed reading order first, anything unexpected appended. */
function orderedTallies(map: Map<string, Tally>, order: string[]): Tally[] {
  const seen = order
    .map((l) => map.get(l))
    .filter((t): t is Tally => !!t);
  const extra = [...map.values()].filter((t) => !order.includes(t.label));
  return [...seen, ...extra];
}

function orderedCounts(map: Map<string, number>, order: string[]): Count[] {
  const labels = [
    ...order.filter((l) => map.has(l)),
    ...[...map.keys()].filter((l) => !order.includes(l)),
  ];
  return labels.map((label) => ({ label, count: map.get(label) ?? 0 }));
}

export function aggregateStats(
  matches: MatchLite[],
  pointsByMatch: Map<string, Point[]>,
  accountName: string | null
): AggregateStats {
  let matchesWithScores = 0;
  let won = 0;
  let lost = 0;
  let gamesYou = 0;
  let gamesThem = 0;
  let deuceWon = 0;
  let deuceLost = 0;
  let servePlayed = 0;
  let serveWon = 0;
  let recvPlayed = 0;
  let recvWon = 0;
  let pressurePlayed = 0;
  let pressureWon = 0;
  let bouncePlayed = 0;
  let bounceWon = 0;
  let longestStreak = 0;

  const mySpin = new Map<string, Tally>();
  const myLength = new Map<string, Tally>();
  const theirSpin = new Map<string, Tally>();
  let mineCount = 0;
  let theirsCount = 0;

  const errorMap = new Map<string, number>();
  const reasonMap = new Map<string, number>();
  let totalLost = 0;

  const wonDir = new Map<string, number>();
  const lostDir = new Map<string, number>();
  let dirTotal = 0;

  const results: MatchResult[] = [];
  const opponents = new Map<string, OpponentRecord>();

  for (const m of matches) {
    if (isNeutral(m, accountName)) continue;
    const pts = sortPoints(pointsByMatch.get(m.id) ?? []);
    if (pts.length === 0) continue;

    const score = computeMatchScore(pts);
    const serving = computeServing(pts, userConfirmedFirstServer(m));
    const stats = computeMatchStats(pts, serving, score);
    const scored = stats.won + stats.lost;
    if (scored === 0) continue;
    matchesWithScores += 1;

    won += stats.won;
    lost += stats.lost;
    gamesYou += score.gamesYou;
    gamesThem += score.gamesThem;
    servePlayed += stats.serve.played;
    serveWon += stats.serve.won;
    recvPlayed += stats.receive.played;
    recvWon += stats.receive.won;
    pressurePlayed += stats.pressure.played;
    pressureWon += stats.pressure.won;
    bouncePlayed += stats.bounceBack.played;
    bounceWon += stats.bounceBack.won;
    if (stats.longestStreak > longestStreak) {
      longestStreak = stats.longestStreak;
    }

    for (const g of score.games) {
      if (g.you >= 10 && g.them >= 10) {
        if (g.you > g.them) deuceWon += 1;
        else deuceLost += 1;
      }
    }

    const analysis = computeMatchAnalysis(pts, serving);
    mergeTallies(mySpin, analysis.serve.mine.spins);
    mergeTallies(myLength, analysis.serve.mine.lengths);
    mergeTallies(theirSpin, analysis.serve.theirs.spins);
    mineCount += analysis.serve.mine.count;
    theirsCount += analysis.serve.theirs.count;
    mergeCounts(errorMap, analysis.mistakes.errors);
    mergeCounts(reasonMap, analysis.mistakes.reasons);
    totalLost += analysis.mistakes.totalLost;
    mergeCounts(wonDir, analysis.placement.won);
    mergeCounts(lostDir, analysis.placement.lost);
    dirTotal += analysis.placement.total;

    // The record: only a FULLY scored match yields a result. A skipped
    // point counts as handled; a real un-decided point makes it partial.
    const fully =
      !pts.some((p) => p.confirmed_winner === null && !p.is_let) &&
      score.games.length > 0;
    if (!fully) continue;
    const opponent = (m.opponent_name ?? "").trim() || null;
    results.push({
      id: m.id,
      played_at: m.played_at,
      opponent,
      match_type: m.match_type,
      gamesYou: score.gamesYou,
      gamesThem: score.gamesThem,
      ptsYou: stats.won,
      ptsThem: stats.lost,
    });
    if (opponent) {
      const rec = opponents.get(opponent.toLowerCase()) ?? {
        name: opponent,
        matches: 0,
        won: 0,
        lost: 0,
      };
      rec.matches += 1;
      if (score.gamesYou > score.gamesThem) rec.won += 1;
      else if (score.gamesThem > score.gamesYou) rec.lost += 1;
      opponents.set(opponent.toLowerCase(), rec);
    }
  }

  results.sort(
    (a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime()
  );

  // Direction labels come through matchAnalysis already humanized.
  const DIR_LABELS = ["Backhand", "Middle", "Forehand"];

  return {
    matchesWithScores,
    points: { won, lost },
    games: { you: gamesYou, them: gamesThem },
    results,
    deuceGames: { won: deuceWon, lost: deuceLost },
    serve: rate(serveWon, servePlayed),
    receive: rate(recvWon, recvPlayed),
    pressure: rate(pressureWon, pressurePlayed),
    bounceBack: rate(bounceWon, bouncePlayed),
    longestStreak,
    serveMine: {
      spins: orderedTallies(mySpin, SPIN_ORDER),
      lengths: orderedTallies(myLength, LENGTH_ORDER),
      count: mineCount,
    },
    serveTheirs: {
      spins: orderedTallies(theirSpin, SPIN_ORDER),
      count: theirsCount,
    },
    errors: [...errorMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    lossReasons: [...reasonMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    totalLost,
    direction: {
      won: orderedCounts(wonDir, DIR_LABELS),
      lost: orderedCounts(lostDir, DIR_LABELS),
      total: dirTotal,
    },
    opponents: [...opponents.values()].sort(
      (a, b) => b.matches - a.matches || a.name.localeCompare(b.name)
    ),
  };
}

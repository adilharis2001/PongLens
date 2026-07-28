import type { Point } from "@/lib/types";
import { createBoundaryWalk, stepBoundaryWalk } from "./gameScore";
import {
  directionLabel,
  howLabel,
  lossReasonLabel,
  serveLengthLabel,
  serveSpinLabel,
} from "./scorecard";
import type { ServeInfo } from "./serving";

/**
 * The deeper cuts behind the analysis cards. Same contract as matchStats.ts:
 * every input is user-confirmed or rotation-derived, nothing leans on the
 * vision's guesses, and a cut with no data reports zero rather than an
 * invented number so the card can say so honestly.
 *
 * "You" is always the uploader ('user').
 */

export interface Tally {
  label: string;
  won: number;
  lost: number;
}

export interface Count {
  label: string;
  count: number;
}

export interface MomentumStep {
  /** running (your points - their points) across the whole match */
  diff: number;
  /** 0-based game this point belongs to */
  game: number;
  /** true on the last point of a completed game */
  endsGame: boolean;
}

export interface MatchAnalysis {
  momentum: {
    steps: MomentumStep[];
    /** furthest ahead and furthest behind the differential ever got */
    peak: number;
    trough: number;
    /** longest run of consecutive points, and who won it */
    bestRun: { len: number; who: "user" | "opponent" } | null;
    /** how many times the differential crossed level */
    leadChanges: number;
  };
  /**
   * Split by WHOSE serve it was, because the two answer different questions
   * and merging them makes the number meaningless: "Side-under 31%" would
   * mix serves you hit with serves you received. Which side of the table a
   * serve came from is the rotation's call, not the describer's.
   */
  serve: {
    mine: { spins: Tally[]; lengths: Tally[]; count: number };
    theirs: { spins: Tally[]; count: number };
    /** points where the serve was described at all */
    described: number;
  };
  mistakes: {
    /** YOUR misses, by where the ball went */
    errors: Count[];
    /** self-reported reasons, most frequent first */
    reasons: Count[];
    totalLost: number;
    reasonsGiven: number;
  };
  placement: {
    won: Count[];
    lost: Count[];
    total: number;
  };
}

/** Order the cuts read in, rather than by whatever the data happened to hit.
 *  Exported orders are shared with the cross-match aggregation (/stats). */
const ERROR_HOWS = ["hit_into_net", "missed_long", "missed_wide"];
const DIRECTIONS = ["bh", "mid", "fh"];
export const SPIN_ORDER = [
  "Side-under",
  "Side-top",
  "Sidespin",
  "Backspin",
  "Topspin",
  "No spin",
];
export const LENGTH_ORDER = ["Short", "Half-long", "Long"];

function tallyList(
  map: Map<string, Tally>,
  order: string[]
): Tally[] {
  const seen = order
    .map((label) => map.get(label))
    .filter((t): t is Tally => !!t);
  // Anything the fixed order missed (shouldn't happen) still shows up.
  const extra = [...map.values()].filter((t) => !order.includes(t.label));
  return [...seen, ...extra];
}

export function computeMatchAnalysis(
  points: Point[],
  serving: Map<string, ServeInfo>
): MatchAnalysis {
  const steps: MomentumStep[] = [];
  let diff = 0;
  let peak = 0;
  let trough = 0;
  let game = 0;
  let leadChanges = 0;
  let prevSign = 0;
  let runLen = 0;
  let runWho: "user" | "opponent" | null = null;
  let bestRun: { len: number; who: "user" | "opponent" } | null = null;

  const mySpin = new Map<string, Tally>();
  const myLength = new Map<string, Tally>();
  const theirSpin = new Map<string, Tally>();
  let described = 0;
  let mineCount = 0;
  let theirsCount = 0;

  const errorMap = new Map<string, number>();
  const reasonMap = new Map<string, number>();
  let totalLost = 0;
  let reasonsGiven = 0;

  const wonDir = new Map<string, number>();
  const lostDir = new Map<string, number>();
  let dirTotal = 0;

  const walk = createBoundaryWalk();

  for (const p of points) {
    // Skipped points score nothing, so they move no line and no tally, but
    // their positional boundary override still has to fold through the walk.
    if (p.is_let || p.confirmed_winner === null) {
      const ended = stepBoundaryWalk(walk, null, p.game_end_override ?? null);
      if (ended) game += 1;
      continue;
    }

    const iWon = p.confirmed_winner === "user";
    diff += iWon ? 1 : -1;
    if (diff > peak) peak = diff;
    if (diff < trough) trough = diff;

    // A lead change is the differential crossing level, not touching it.
    const sign = Math.sign(diff);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) leadChanges += 1;
    if (sign !== 0) prevSign = sign;

    const who = iWon ? "user" : "opponent";
    if (who === runWho) runLen += 1;
    else {
      runWho = who;
      runLen = 1;
    }
    if (!bestRun || runLen > bestRun.len) bestRun = { len: runLen, who };

    const ended = stepBoundaryWalk(
      walk,
      p.confirmed_winner,
      p.game_end_override ?? null
    );
    steps.push({ diff, game, endsGame: !!ended });
    if (ended) game += 1;

    // Serve cuts: only points where the serve was actually described, and
    // only where the rotation knows whose serve it was.
    const spin = serveSpinLabel(p.serve_spin, p.serve_sidespin);
    const length = serveLengthLabel(p.serve_length);
    const server = serving.get(p.id)?.server ?? null;
    if ((spin || length) && server !== null) {
      described += 1;
      const bump = (m: Map<string, Tally>, label: string) => {
        const t = m.get(label) ?? { label, won: 0, lost: 0 };
        if (iWon) t.won += 1;
        else t.lost += 1;
        m.set(label, t);
      };
      if (server === "user") {
        mineCount += 1;
        if (spin) bump(mySpin, spin);
        if (length) bump(myLength, length);
      } else {
        theirsCount += 1;
        // Length is only broken out for YOUR serves: it's the dimension you
        // can actually change. Against theirs, reading the spin is the skill.
        if (spin) bump(theirSpin, spin);
      }
    }

    if (!iWon) {
      totalLost += 1;
      const how = p.confirmed_how ?? "";
      if (ERROR_HOWS.includes(how)) {
        errorMap.set(how, (errorMap.get(how) ?? 0) + 1);
      }
      if (p.loss_reasons?.length) {
        reasonsGiven += 1;
        for (const r of p.loss_reasons) {
          reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1);
        }
      }
    }

    // Placement of the deciding ball, split by who it was working for.
    if (p.direction) {
      dirTotal += 1;
      const target = iWon ? wonDir : lostDir;
      target.set(p.direction, (target.get(p.direction) ?? 0) + 1);
    }
  }

  const dirCounts = (m: Map<string, number>): Count[] =>
    DIRECTIONS.filter((d) => m.has(d)).map((d) => ({
      label: directionLabel(d) ?? d,
      count: m.get(d) ?? 0,
    }));

  return {
    momentum: { steps, peak, trough, bestRun, leadChanges },
    serve: {
      mine: {
        spins: tallyList(mySpin, SPIN_ORDER),
        lengths: tallyList(myLength, LENGTH_ORDER),
        count: mineCount,
      },
      theirs: { spins: tallyList(theirSpin, SPIN_ORDER), count: theirsCount },
      described,
    },
    mistakes: {
      errors: ERROR_HOWS.filter((h) => errorMap.has(h)).map((h) => ({
        label: howLabel(h) ?? h,
        count: errorMap.get(h) ?? 0,
      })),
      reasons: [...reasonMap.entries()]
        .map(([value, count]) => ({
          label: lossReasonLabel(value) ?? value,
          count,
        }))
        .sort((a, b) => b.count - a.count),
      totalLost,
      reasonsGiven,
    },
    placement: {
      won: dirCounts(wonDir),
      lost: dirCounts(lostDir),
      total: dirTotal,
    },
  };
}

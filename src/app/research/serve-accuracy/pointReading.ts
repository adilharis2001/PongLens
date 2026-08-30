import { ballDiedLoser, ballDiedReasonCopy, findBallDied } from "./ballDied.ts";
import {
  findOffTable,
  offTableLoser,
  offTableWithheld,
  type OffTableCall,
} from "./offTable.ts";
import { findNoReturn, noReturnLoser } from "./noReturn.ts";
import { isRecovered, repairEvents, repairTrust, type RepairTrust } from "./segments.ts";
import {
  type DetectedEvent,
  type ServeAccuracyMatch,
  type ServeAccuracyRow,
} from "./serveAccuracyModel.ts";

/**
 * One reading of one point, and the only one the page makes.
 *
 * The three rules used to be run from a dozen places — the row, the map,
 * the counters, each filter chip — each rebuilding the chain by hand. That
 * was already a liability and the repair layer would have made it a bug:
 * a page where the summary counts repaired calls and the row does not is
 * worse than one that never repaired anything.
 *
 * The ladder is: ask the rules what the worker recorded. If they answer,
 * that is the answer and nothing is repaired — so no point that was
 * already called can change, by construction. Only when they refuse does
 * the ball track get read as flights, the missing events put back, and
 * the same three rules asked again.
 */

type Corners = ServeAccuracyMatch["corners"];
type SourceDims = ServeAccuracyMatch["source"];
export type Tracks = Record<string, (readonly number[])[]>;

export interface RuleVerdict {
  name: "ball died" | "off table" | "no return";
  verdict: "user" | "opponent";
  /** What the loser did, in the words a player would use. */
  why: string;
}

export interface PointReading {
  /** The events the verdict was reached on: recorded, or recorded plus
   *  recovered where the first pass refused. */
  events: DetectedEvent[];
  /** Events the flights put back. Empty unless the repair ran and spoke. */
  recovered: DetectedEvent[];
  /** Set when the reading came from repaired events. */
  trust: RepairTrust | null;
  /** Every rule that answered, in order; the first one is the call. */
  verdicts: RuleVerdict[];
  winner: "user" | "opponent" | null;
  rule: RuleVerdict["name"] | null;
  /** What the loser did, from the rule that made the call. */
  why: string | null;
  /** Why no call was made, when none was. */
  refusal: string | null;
}

const flip = (l: "user" | "opponent" | null) =>
  l === null ? null : l === "user" ? ("opponent" as const) : ("user" as const);

/**
 * How the ball left the table, said the way a player would say it.
 *
 * "Long" and "wide" are not here, and it is not for want of trying. The
 * off-table rule ends a point on a floor bounce, and over both matches not
 * one of those 38 floor bounces carries a table coordinate: 16 have pixels
 * only and 22 are not recorded at all, the point having ended with nothing
 * following the last landing. That is not a gap in the data so much as the
 * geometry — the ball is on the floor, three quarters of a metre below the
 * plane the homography describes, so where it "lands on the table" is a
 * number about a place the ball never was.
 *
 * The branch that split long from wide was written, measured, and found to
 * fire zero times. It is gone rather than left in to imply a distinction
 * the page cannot make.
 */
function offTableWhy(call: OffTableCall): string {
  return call.via === "unreturned" ? "never got it back" : "missed the table";
}

function askTheRules(
  row: ServeAccuracyRow,
  events: readonly DetectedEvent[],
  corners: Corners,
  track: (readonly number[])[] | null,
  source: SourceDims,
): { verdicts: RuleVerdict[]; refusal: string | null } {
  const side = row.userPhysicalSide;
  const verdicts: RuleVerdict[] = [];
  const death = findBallDied(events, track, corners, row.clipT0, source, side);
  const died = flip(ballDiedLoser(death, side));
  if (died && death) {
    verdicts.push({
      name: "ball died", verdict: died,
      why: death.via === "turn" ? "hit the net" : ballDiedReasonCopy(death),
    });
  }
  const call = findOffTable(events, corners ? { corners } : null);
  const off = flip(offTableLoser(call, side));
  if (off && call) {
    verdicts.push({ name: "off table", verdict: off, why: offTableWhy(call) });
  }
  const ret = flip(noReturnLoser(
    findNoReturn(events, track, corners, row.clipT0, source), side));
  if (ret) {
    verdicts.push({ name: "no return", verdict: ret, why: "never got it back" });
  }
  return {
    verdicts,
    refusal: verdicts.length ? null : offTableWithheld(call) ?? "nothing to go on",
  };
}

export function readPoint(
  row: ServeAccuracyRow,
  corners: Corners,
  tracks: Tracks | null,
  source: SourceDims,
): PointReading {
  const track = tracks?.[row.pointId] ?? null;
  const first = askTheRules(row, row.events, corners, track, source);
  if (first.verdicts.length) {
    return {
      events: row.events, recovered: [], trust: null,
      verdicts: first.verdicts,
      winner: first.verdicts[0].verdict,
      rule: first.verdicts[0].name,
      why: first.verdicts[0].why,
      refusal: null,
    };
  }

  const repaired = repairEvents(
    row.events, track, corners, row.clipT0, source, {}, row.userPhysicalSide);
  const recovered = repaired.filter(isRecovered);
  const blank = {
    events: row.events, recovered: [] as DetectedEvent[], trust: null,
    verdicts: [] as RuleVerdict[], winner: null, rule: null, why: null,
    refusal: first.refusal,
  };
  if (!recovered.length) return blank;

  const second = askTheRules(row, repaired, corners, track, source);
  if (!second.verdicts.length) {
    return { ...blank, events: repaired, recovered, refusal: second.refusal };
  }
  const trust = repairTrust(repaired, track, corners, row.clipT0, source);
  if (!trust.trusted) {
    return {
      ...blank, events: repaired, recovered, trust,
      refusal: trust.fullAlternation
        ? "repaired, but the ball was never seen leaving"
        : "repaired, but the rally still has a hole",
    };
  }
  return {
    events: repaired, recovered, trust,
    verdicts: second.verdicts,
    winner: second.verdicts[0].verdict,
    rule: second.verdicts[0].name,
    why: second.verdicts[0].why,
    refusal: null,
  };
}

/** Two rules both spoke and named different winners. */
export function rulesDisagree(r: PointReading): boolean {
  return r.verdicts.length > 1
    && r.verdicts.some((v) => v.verdict !== r.verdicts[0].verdict);
}

/** Fired, the point is scored, and it named the wrong player. */
export function readingIsWrong(row: ServeAccuracyRow, r: PointReading): boolean {
  return r.winner !== null && row.winner !== null && r.winner !== row.winner;
}

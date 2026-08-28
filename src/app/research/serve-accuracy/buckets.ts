import type { PointReading } from "./pointReading.ts";
import type { ServeAccuracyRow } from "./serveAccuracyModel.ts";

/**
 * How the page files a point, and how it counts the piles.
 *
 * Pulled out of the component so it can be tested against real matches.
 * The component renders it and nothing more; every number on the page is
 * decided here, which is the only reason the tables can be trusted to add
 * up to the list underneath them.
 */

export type Outcome = "right" | "wrong" | "unchecked" | "nocall";

export interface Bucketed {
  outcome: Outcome;
  /** The ending it named, or the reason it refused. One string either way,
   *  because a point is always in exactly one of the two states. */
  reason: string;
}

/**
 * The ending, as a bucket name.
 *
 * "turned 0.42 m from the net and died there" carries a measurement, so
 * left alone it makes one bucket per point instead of one per kind — a
 * table with 30 rows of one is not a table.
 */
export function endingLabel(read: PointReading): string {
  const why = read.why ?? "";
  const tidy = /^turned .* died there$/.test(why)
    ? "turned at the net and died there"
    : why;
  return `${read.rule} — ${tidy}`;
}

/**
 * Which pile a point belongs in.
 *
 * "unchecked" is its own state rather than folded into "right": a call on
 * a point nobody scored has nothing to be right or wrong about, and
 * counting it either way would flatter or damn the rules for free.
 */
export function classify(
  row: ServeAccuracyRow,
  read: PointReading,
): Bucketed {
  if (read.winner === null) {
    return { outcome: "nocall", reason: read.refusal ?? "no reason given" };
  }
  const outcome: Outcome = row.winner === null
    ? "unchecked"
    : read.winner === row.winner
      ? "right"
      : "wrong";
  return { outcome, reason: endingLabel(read) };
}

export interface ReasonCell {
  reason: string;
  points: number;
  right: number;
  wrong: number;
  unchecked: number;
  /** True for an ending we called, false for a reason we refused. */
  called: boolean;
}

/**
 * One row per reason, biggest pile first, split into the two tables.
 *
 * A reason is only ever one or the other — a refusal string never names an
 * ending — so a reason appearing in both tables would mean the reading
 * contradicted itself, and the split is by the outcome of the first point
 * that carried it.
 */
export function reasonSummary(
  items: readonly Bucketed[],
): { called: ReasonCell[]; refused: ReasonCell[] } {
  const map = new Map<string, ReasonCell>();
  for (const it of items) {
    let c = map.get(it.reason);
    if (!c) {
      c = {
        reason: it.reason, points: 0, right: 0, wrong: 0, unchecked: 0,
        called: it.outcome !== "nocall",
      };
      map.set(it.reason, c);
    }
    c.points += 1;
    if (it.outcome !== "nocall") c[it.outcome] += 1;
  }
  const all = [...map.values()].sort((a, b) => b.points - a.points);
  return {
    called: all.filter((c) => c.called),
    refused: all.filter((c) => !c.called),
  };
}

/** The headline strip: how many points are in each pile. */
export function outcomeTotals(items: readonly Bucketed[]) {
  const t = { all: items.length, right: 0, wrong: 0, unchecked: 0, nocall: 0 };
  for (const it of items) t[it.outcome] += 1;
  return t;
}

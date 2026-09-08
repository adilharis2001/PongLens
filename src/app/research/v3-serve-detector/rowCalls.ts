/**
 * Adil's calls on the ROWS of a research card page.
 *
 * A page judges an assembler's cards against a reference: his own scoring
 * (the production cards he kept or deleted, his winner taps), or production's
 * cards on a match he never scored. The reference is wrong some of the time:
 * the taps 10 to 20 percent, more on split points. So a row flagged "no
 * card" or "misses your press" may be the reference's fault, and the only
 * person who can say is the one watching the footage.
 *
 * A row call is one of three words about MY card on that row:
 *
 *   fine    fine as it is; the tap or production card is what is off, or
 *           the flag does not matter
 *   wrong   my card is genuinely wrong here
 *   unsure
 *
 * Everything the page counts is counted twice: as flagged, and with the rows
 * called "fine" set aside. The lab reads the same table
 * (research_row_verdicts) and applies the same arithmetic, so a number on
 * the page and a number in a research note agree.
 *
 * Keyed by the row's reference time, never by a card number: production's
 * card start where the row has one, otherwise my card's start, to a tenth of
 * a second. The reference does not move when the assembler's rules change.
 */

export type RowCallVerdict = "fine" | "wrong" | "unsure";

export interface RowVerdict {
  page?: string;
  match_id: string;
  row_s: number | string;
  verdict: string;
  note?: string | null;
}

export interface RowLike {
  kind?: string;
  verdict?: string;
  holds_press?: boolean | null;
  prod_t0?: number | null;
  tap?: number | null;
  mine?: { t0: number }[] | null;
}

/** The time this row is keyed by, or null for a row with no time at all. */
export function rowKey(r: RowLike): number | null {
  const t =
    r.prod_t0 != null
      ? r.prod_t0
      : r.mine && r.mine.length
        ? r.mine[0].t0
        : null;
  return t == null || !Number.isFinite(t) ? null : Math.round(t * 10) / 10;
}

export function callKey(matchId: string, key: number): string {
  return `${matchId}|${key.toFixed(1)}`;
}

/** A row the page flags: not a clean single card, or a card that ends before the press. */
export function isProblem(r: RowLike): boolean {
  return (r.verdict ?? "ok") !== "ok" || r.holds_press === false;
}

export interface Excused {
  missed: number;
  fused: number;
  extra: number;
  short: number;
  junk: number;
  problemPoints: number;
}

const JUNK = new Set(["junk_deleted", "junk_unknown"]);

/** How many rows in each flagged bucket Adil has called "fine". */
export function excusedCounts(
  rows: RowLike[],
  callOf: (r: RowLike) => string | null | undefined,
): Excused {
  const ex: Excused = { missed: 0, fused: 0, extra: 0, short: 0, junk: 0, problemPoints: 0 };
  for (const r of rows) {
    if (callOf(r) !== "fine") continue;
    const v = r.verdict ?? "ok";
    if (r.kind === "point") {
      if (v === "missed") ex.missed++;
      if (v === "fused") ex.fused++;
      if (v === "extra") ex.extra++;
      if (v !== "ok") ex.problemPoints++;
      if (r.tap != null && r.holds_press === false) ex.short++;
    }
    if (JUNK.has(v)) ex.junk++;
  }
  return ex;
}

export interface StatPair {
  /** numerator, denominator as flagged */
  raw: [number, number];
  /** the same with the rows called "fine" set aside */
  adjusted: [number, number];
}

export interface Stats {
  found: StatPair;
  clean: StatPair;
  holds: StatPair;
  junk: StatPair;
  excused: Excused;
}

/**
 * The four percentages the page leads with, each as flagged and after the
 * calls. An excused missed point leaves the count of points (it was not a
 * point, or not where the reference says); an excused early ending leaves
 * the count of pressed points; an excused junk card leaves the count of
 * cards. What remains is measured against what remains.
 */
export function adjustedStats(
  rows: RowLike[],
  summary: { cards: number },
  callOf: (r: RowLike) => string | null | undefined,
): Stats {
  const ex = excusedCounts(rows, callOf);
  const pts = rows.filter((r) => r.kind === "point");
  const missed = pts.filter((r) => r.verdict === "missed").length;
  const problems = pts.filter((r) => (r.verdict ?? "ok") !== "ok").length;
  const pressed = pts.filter((r) => r.tap != null);
  const short = pressed.filter((r) => r.holds_press === false).length;
  const junk = rows.filter((r) => JUNK.has(r.verdict ?? "")).length;
  return {
    found: {
      raw: [pts.length - missed, pts.length],
      adjusted: [pts.length - missed, pts.length - ex.missed],
    },
    clean: {
      raw: [pts.length - problems, pts.length],
      adjusted: [pts.length - problems, pts.length - ex.problemPoints],
    },
    holds: {
      raw: [pressed.length - short, pressed.length],
      adjusted: [pressed.length - short, pressed.length - ex.short],
    },
    junk: {
      raw: [junk, summary.cards],
      adjusted: [junk - ex.junk, summary.cards - ex.junk],
    },
    excused: ex,
  };
}

export function pct(pair: [number, number]): number | null {
  return pair[1] > 0 ? Math.round((100 * pair[0]) / pair[1]) : null;
}

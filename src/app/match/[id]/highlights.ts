import {
  createBoundaryWalk,
  stepBoundaryWalk,
} from "./gameScore.ts";
import { effectivePad } from "./clipEdit.ts";
import type { Point } from "../../../lib/types.ts";

/** What clipPad() returns — the pads a clip was actually cut with. */
export type ClipPad = { pre: number; post: number };

/**
 * The automatic highlight picker: which of a match's rallies make the cut
 * for a given time budget.
 *
 * The rule, in the order it was decided (2026-08-25):
 *  - Rally LENGTH is the quality signal. In table tennis the long rallies
 *    are almost always the ones worth watching, and length is the one
 *    signal every processed match already carries (t1 - t0).
 *  - A rally the owner STARRED outranks everything: they already said it
 *    was good.
 *  - The rally that closed the LAST completed game outranks plain length
 *    too — the decision moment belongs in a highlight even when it was
 *    short.
 *  - Selection FILLS THE BUDGET rather than taking a fixed count. Measured
 *    over 101 real matches, "top 3" averages 51 seconds against a Story's
 *    20 and "top 10" averages 139 against a Reel's 60, so a count-based
 *    rule almost never produces a postable file. Greedy by rank, skipping
 *    anything that no longer fits, so a shorter rally can fill the tail.
 *  - The chosen rallies come back in MATCH ORDER, not rank order. A
 *    highlight reads as a story of the match, and the score band the
 *    renderer draws walks forward through it.
 *
 * Budgets are Instagram's ceilings: 20s Story, 60s Reel, and 120s for the
 * long cut that never goes through the Instagram handover (it exists for
 * watching, downloading and every other destination).
 *
 * This rule exists TWICE: here and in ios/.../Core/Highlights.swift, which
 * previews the same picks on the phone without a round trip. The parity
 * fixture (ios/Tests/fixtures/highlights-parity.json) holds this file's
 * own output over a real match, so the port is compared against the
 * original rather than against a second reading of this comment. Change
 * one, regenerate the fixture, and the other's test says what drifted.
 */

export const HIGHLIGHT_BUDGETS_S = {
  story: 20,
  reel: 60,
  long: 120,
} as const;

export type HighlightKind = keyof typeof HIGHLIGHT_BUDGETS_S;

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface HighlightPicks {
  /** The chosen points, in match order. */
  picks: Point[];
  /** Sum of the chosen clips' seconds (rally plus its context pads). */
  totalS: number;
}

/**
 * `ordered` must be the match's VISIBLE points in timeline order
 * (sortPoints output, deleted excluded) — the same list every score walk
 * consumes. Lets are folded into the walk but never picked; a let is not
 * a highlight.
 */
export function pickHighlights(
  ordered: Point[],
  pad: ClipPad,
  budgetS: number
): HighlightPicks {
  // One pass: fold the score walk (to find the rally that closed the last
  // completed game) and collect every rally eligible for picking.
  const walk = createBoundaryWalk();
  let lastGameEndId: string | null = null;
  const eligible: { p: Point; s: number; starred: boolean }[] = [];
  for (const p of ordered) {
    const winner = p.is_let ? null : p.confirmed_winner;
    const ended = stepBoundaryWalk(walk, winner ?? null, p.game_end_override ?? null);
    if (ended) lastGameEndId = p.id;
    if (!p.clip_path || p.is_let || p.t0 === null || p.t1 === null) continue;
    const eff = effectivePad(pad, p.tight_start, p.tight_end);
    const s = round2(Number(p.t1) - Number(p.t0) + eff.pre + eff.post);
    if (s <= 0) continue;
    eligible.push({ p, s, starred: !!p.starred });
  }

  const ranked = [...eligible].sort((a, b) => {
    const ta = a.starred || a.p.id === lastGameEndId ? 0 : 1;
    const tb = b.starred || b.p.id === lastGameEndId ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (b.s !== a.s) return b.s - a.s;
    return a.p.idx - b.p.idx; // deterministic ties, and parity needs that
  });

  const chosen = new Set<string>();
  let total = 0;
  for (const e of ranked) {
    // Greedy with skip: a rally that no longer fits steps aside for a
    // shorter one further down the ranking. The small float slack keeps a
    // rally whose rounded length lands exactly on the budget.
    if (total + e.s <= budgetS + 1e-9) {
      chosen.add(e.p.id);
      total = round2(total + e.s);
    }
  }

  return {
    picks: ordered.filter((p) => chosen.has(p.id)),
    totalS: total,
  };
}

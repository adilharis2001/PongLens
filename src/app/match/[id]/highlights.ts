import { effectivePad } from "./clipEdit.ts";
import { effectiveEnd } from "./playhead.ts";
import type { Point } from "../../../lib/types.ts";

/** What clipPad() returns — the pads a clip was actually cut with. */
export type ClipPad = { pre: number; post: number };

/**
 * The automatic highlight picker: which of a match's rallies make the cut
 * for a given time budget.
 *
 * The rule (reordered 2026-08-25 after Adil's review):
 *  - Rally LENGTH is the quality signal. In table tennis the long rallies
 *    are almost always the ones worth watching, and length is the one
 *    signal every processed match already carries (t1 - t0).
 *  - A long rally must look GENUINE, and the worker holds two receipts.
 *    The rally reconstruction's HIT COUNT (suggestion.n_hits): two bat
 *    contacts or fewer is a serve error or an ace, never a highlight —
 *    the Prabhas match put two one-hit "13-second rallies" in a reel
 *    this way. And the placement bounce detections (v3 candidates):
 *    a long span with almost none is dead time in a rally's clothes.
 *    Either signal missing reads as genuine — failing open, like every
 *    gate in this product.
 *  - RANK length is capped at what the hit count can vouch for, about
 *    two seconds of credible play per contact. A real eight-shot rally
 *    inside a bloated 25-second span ranks as sixteen seconds, so spans
 *    inflated by failed serve detection and walking-around stop beating
 *    honest rallies. The BUDGET still pays the true clip length — the
 *    footage really is that long.
 *  - Up to TWO starred rallies (the longest of them) keep a nod ahead of
 *    plain length. Stars used to outrank everything, but people star
 *    rallies to work on them or export them, and four stars plus filler
 *    is not a highlight reel.
 *  - Selection FILLS THE BUDGET rather than taking a fixed count. Measured
 *    over 101 real matches, "top 3" averages 51 seconds against a Story's
 *    20 and "top 10" averages 139 against a Reel's 60, so a count-based
 *    rule almost never produces a postable file. Greedy by rank, skipping
 *    anything that no longer fits, so a shorter rally can fill the tail.
 *  - The chosen rallies come back in MATCH ORDER, not rank order. A
 *    highlight reads as a story of the match, and the score band the
 *    renderer draws walks forward through it.
 *
 * Budgets: 20s Story and 60s Reel are Instagram's ceilings; 150s for the
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
  long: 150,
} as const;

export type HighlightKind = keyof typeof HIGHLIGHT_BUDGETS_S;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Ball-contact detections recorded for this rally, when the worker has
 * them (placement v3 candidates). null = no signal — and no signal must
 * read as genuine, never as suspect. */
function contactCount(p: Point): number | null {
  const pl = p.placement as { v?: number; candidates?: unknown[] } | null;
  if (!pl || pl.v !== 3 || !Array.isArray(pl.candidates)) return null;
  return pl.candidates.length;
}

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
  budgetS: number,
  /** app_config.tap_end_playback: clip lengths end at the winner tap
   *  plus half a second (playhead.effectiveEnd), so the budget buys real
   *  play instead of ball retrieval — and more rallies fit. Every caller
   *  of this picker must pass the same value the players use, or the
   *  preview, the tape and the render disagree about the same match. */
  tapEnd = false
): HighlightPicks {
  const eligible: {
    p: Point;
    s: number;
    rankS: number;
    starred: boolean;
    genuine: boolean;
  }[] = [];
  for (const p of ordered) {
    if (!p.clip_path || p.is_let || p.t0 === null || p.t1 === null) continue;
    const eff = effectivePad(pad, p.tight_start, p.tight_end);
    const rallyLen = Number(p.t1) - Number(p.t0);
    let s = round2(rallyLen + eff.pre + eff.post);
    // The tap trims the clip (never extends it): its cost against the
    // budget and its watchable length are the trimmed one. Legacy points
    // without cut offsets keep the pad formula.
    if (tapEnd && p.cut_t0 !== null && p.cut_t0 !== undefined) {
      const end = effectiveEnd(p, pad, true);
      if (end !== null) s = round2(Math.min(s, end - Number(p.cut_t0)));
    }
    if (s <= 0) continue;
    // Roughly one recorded contact per six seconds is a LOW bar for a
    // real rally — the point is catching the thirty-second "rally" with
    // two contacts, not grading normal ones.
    const contacts = contactCount(p);
    const nHits = p.suggestion?.n_hits ?? null;
    const genuine =
      (contacts === null ||
        contacts >= Math.max(2, Math.floor(rallyLen / 6))) &&
      (nHits === null || nHits >= 3);
    // The span only ranks as high as the hits can vouch for.
    const rankS = nHits !== null ? Math.min(s, round2(2 * nHits)) : s;
    eligible.push({ p, s, rankS, starred: !!p.starred, genuine });
  }

  // Up to two starred rallies — the longest genuine ones — keep a nod
  // ahead of plain length.
  const boosted = new Set(
    eligible
      .filter((e) => e.starred && e.genuine)
      .sort((a, b) => b.rankS - a.rankS || a.p.idx - b.p.idx)
      .slice(0, 2)
      .map((e) => e.p.id)
  );

  const tier = (e: (typeof eligible)[number]) =>
    !e.genuine ? 2 : boosted.has(e.p.id) ? 0 : 1;
  const ranked = [...eligible].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (b.rankS !== a.rankS) return b.rankS - a.rankS;
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

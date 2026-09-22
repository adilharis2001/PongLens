import {
  createBoundaryWalk,
  resolvedGameWinner,
  stepBoundaryWalk,
} from "../../match/[id]/gameScore.ts";
import {
  effectiveEnd,
  type ClipPad,
  type EndOptions,
} from "../../match/[id]/playhead.ts";
import type { Point } from "@/lib/types";

/**
 * The part of a render manifest that is the same whichever set of rallies
 * is asked for: each included rally's cut-video window and the match score
 * ENTERING it. /api/reel builds one match's scopes from it, and the starred
 * selection (2026-09-22) builds each of its matches from it, so a rally
 * shared from the shelf carries exactly the score it would carry shared
 * from its match. Relative `.ts` imports so node's test runner can load it.
 */

export interface ManifestPoint {
  point_id: string;
  clip_path: string;
  /** cut-timeline bounds (seconds); null when cut_t0/t0/t1 are unknown */
  seg_start: number | null;
  seg_end: number | null;
  score_you: number;
  score_them: number;
  games_you: number;
  games_them: number;
  /** completed games entering this rally: [[you, them], ...] */
  games_detail: [number, number][];
}

/** A precomputed cut-clock window (the automatic highlights' own bounds). */
export interface FixedBounds {
  cut_start_s: number;
  cut_end_s: number;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Deterministic stringify (sorted keys) so a jsonb round-trip through
 * Postgres — which re-orders object keys — still compares equal. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Running score walk capturing the state ENTERING each rally; lets and
 * unconfirmed points contribute nothing. Game boundaries come from
 * gameScore.ts stepBoundaryWalk — the SAME walk computeMatchScore and
 * serving.ts use (11-with-2-clear plus the owner's game_end_override
 * end/continue pins), so the reel scorebug always splits games exactly
 * where the match page does.
 *
 * `ordered` is EVERY visible point of the match in timeline order
 * (sortPoints); `included` picks which of them land in the manifest. The
 * walk runs over all of them either way, so the running score entering an
 * included rally is identical whatever else is included.
 */
export function walkManifestPoints(
  ordered: Point[],
  included: (p: Point) => boolean,
  pad: ClipPad,
  ends: EndOptions,
  fixedBounds?: Map<string, FixedBounds>,
): { points: ManifestPoint[]; hasScore: boolean } {
  const walk = createBoundaryWalk();
  let gamesYou = 0;
  let gamesThem = 0;
  let hasScore = false;
  const gamesDetail: [number, number][] = [];
  const points: ManifestPoint[] = [];
  for (const p of ordered) {
    const clipPath = p.clip_path;
    if (clipPath && included(p)) {
      // Cut-timeline segment covering the same content as the preview
      // clip: cut_t0 is the padded clip start, so the span is the rally
      // length plus both context pads. Split-boundary edges use the tight
      // pad (effectivePad) so the reel segment matches the reclipped
      // preview clip instead of running into the sibling's rally — BOTH
      // edges: split-born points now get a cut_t0 anchored on
      // t0 - TIGHT_PAD (split_point RPC / migration 023), so a full pre
      // here would overshoot the child's clip span by pre - 0.3.
      // The end goes through playhead.effectiveEnd — paddedEnd exactly,
      // unless a trim shortens it: the owner's winner tap (tap + 0.5s;
      // 138) or, on an unscored point, the observed rally end plus its
      // buffer (143). Clamped, never extended. The device renderer mirrors
      // this same pair of lines in SharePointSheet.swift — keep them
      // rule-identical.
      let segStart: number | null = null;
      let segEnd: number | null = null;
      const fixed = fixedBounds?.get(p.id);
      if (fixed) {
        segStart = round2(fixed.cut_start_s);
        segEnd = round2(fixed.cut_end_s);
      } else if (p.cut_t0 !== null && p.t0 !== null && p.t1 !== null) {
        segStart = round2(Math.max(0, Number(p.cut_t0)));
        const end = effectiveEnd(p, pad, ends);
        segEnd = end === null ? null : round2(end);
      }
      points.push({
        point_id: p.id,
        clip_path: clipPath,
        seg_start: segStart,
        seg_end: segEnd,
        score_you: walk.you,
        score_them: walk.them,
        games_you: gamesYou,
        games_them: gamesThem,
        games_detail: gamesDetail.map((g) => [g[0], g[1]]),
      });
    }
    // Fold EVERY visible point: skipped/unscored contribute no score
    // (winner null) but their positional game_end_override still counts —
    // matching computeMatchScore/serving exactly.
    const winner = p.is_let ? null : p.confirmed_winner;
    if (winner) hasScore = true;
    const ended = stepBoundaryWalk(walk, winner, p.game_end_override ?? null);
    if (ended) {
      // resolvedGameWinner, not "whoever is ahead": a game closed by an
      // owner pin on points that were never scored out belongs to neither
      // side — unless the owner named its winner (game_winner_override,
      // 099) — and the reel scorebug must read the same as the match page.
      const gameWinner = resolvedGameWinner({
        ...ended,
        winnerOverride: p.game_winner_override ?? null,
      });
      if (gameWinner === "user") gamesYou += 1;
      else if (gameWinner === "opponent") gamesThem += 1;
      gamesDetail.push([ended.you, ended.them]);
    }
  }
  return { points, hasScore };
}

/** Seconds of footage a manifest renders, from its cut windows. */
export function manifestSeconds(points: ManifestPoint[]): number {
  return points.reduce(
    (total, p) =>
      total +
      (p.seg_start !== null && p.seg_end !== null
        ? p.seg_end - p.seg_start
        : 0),
    0,
  );
}

/**
 * Title-card names: owner first (their tagged side), like the share sheet's
 * default title. The owner's name falls back to their account first name
 * (Google auth) before the generic "Player" — the app never needs to ask
 * the owner for their own name.
 */
export function storyNames(
  match: {
    player_near_name: string | null;
    player_far_name: string | null;
    opponent_name: string | null;
    user_side: string | null;
  },
  userMetadata: Record<string, unknown> | undefined,
): { you: string; them: string } {
  const accountFullName = (
    (userMetadata?.full_name as string | undefined) ??
    (userMetadata?.name as string | undefined) ??
    ""
  ).trim();
  const accountName = accountFullName.split(/\s+/)[0] || "";
  const near = (match.player_near_name ?? "").trim();
  const far = (match.player_far_name ?? "").trim();
  const opp = (match.opponent_name ?? "").trim();
  const userIsFar = match.user_side === "far";
  return {
    you: (userIsFar ? far : near) || accountName || "Player",
    them: (userIsFar ? near : far) || opp || "Opponent",
  };
}

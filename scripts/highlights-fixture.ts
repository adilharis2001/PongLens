/**
 * Regenerates the highlight-picker parity fixture.
 *
 *   node --experimental-strip-types scripts/highlights-fixture.ts
 *
 * The fixture (ios/Tests/fixtures/highlights-parity.json) carries two
 * real matches' points and THIS script's picks over them — the web
 * picker's own output, so the Swift port in Core/Highlights.swift is
 * compared against the original rather than against a second reading of
 * the spec (the serve-parity.json pattern).
 *
 *  - `points` / `expected`: the legacy block (Jason), no winner taps —
 *    it pins the pad-length rule and proves the tap flag is a no-op on
 *    a match without taps (both flag states must produce these picks).
 *  - `tapped`: Julian 08-23, 76 winner taps — `expected` pins the picks
 *    with tap-trimmed lengths (app_config.tap_end_playback on, the
 *    shipping config) and `expected_off` the same match with the flag
 *    off.
 *
 * Change the rule in highlights.ts, run this, and commit the fixture
 * with it; ios/Tests/run.sh then says whether the Swift side kept up.
 * The `points` blocks are database dumps and are left untouched here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  pickHighlights,
  HIGHLIGHT_BUDGETS_S,
  type HighlightKind,
} from "../src/app/match/[id]/highlights.ts";
import { clipPad } from "../src/app/match/[id]/clipEdit.ts";
import { sortPoints } from "../src/app/match/[id]/gameScore.ts";
import type { Point } from "../src/lib/types.ts";
import type { EndOptions } from "../src/app/match/[id]/playhead.ts";

const path = new URL("../ios/Tests/fixtures/highlights-parity.json", import.meta.url);
const fx = JSON.parse(readFileSync(path, "utf8"));

function mapRows(rows: Record<string, unknown>[]): Point[] {
  return sortPoints(
    rows.map((r) => ({
      id: r.id,
      idx: r.idx,
      t0: r.t0,
      t1: r.t1,
      is_let: r.is_let,
      starred: r.starred,
      tight_start: r.tight_start,
      tight_end: r.tight_end,
      confirmed_winner: r.confirmed_winner,
      game_end_override: r.game_end_override,
      clip_path: r.has_clip ? "c" : null,
      cut_t0: r.cut_t0 ?? null,
      scored_at_cut_s: r.scored_at_cut_s ?? null,
      edited: false,
      suggestion:
        r.n_hits == null ? null : { winner: "user", how: "", n_hits: r.n_hits },
      placement:
        r.contacts == null
          ? null
          : {
              v: 3,
              status: "ready",
              candidates: Array.from({ length: r.contacts as number }, (_, i) => ({
                t: i,
              })),
              hypotheses: { near: {}, far: {} },
            },
    })) as unknown as Point[]
  );
}

function expectations(
  points: Point[],
  pad: { pre: number; post: number },
  ends: EndOptions,
  label: string
) {
  const out: Record<string, { ids: unknown[]; totalS: number }> = {};
  for (const kind of Object.keys(HIGHLIGHT_BUDGETS_S) as HighlightKind[]) {
    const { picks, totalS } = pickHighlights(
      points,
      pad,
      HIGHLIGHT_BUDGETS_S[kind],
      ends
    );
    out[kind] = { ids: picks.map((p) => p.id), totalS };
    console.log(
      `${label} ${kind}: ${picks.length} rallies, ${totalS}s of ${HIGHLIGHT_BUDGETS_S[kind]}`
    );
  }
  return out;
}

const pad = clipPad(fx.strictness, fx.clip_pads);
fx.pad = pad;
fx.expected = expectations(mapRows(fx.points), pad, { tapEnd: true }, "legacy");

if (fx.tapped) {
  const tpad = clipPad(null, fx.tapped.clip_pads);
  fx.tapped.pad = tpad;
  const pts = mapRows(fx.tapped.points);
  fx.tapped.expected = expectations(pts, tpad, { tapEnd: true }, "tapped(on)");
  fx.tapped.expected_off = expectations(pts, tpad, { tapEnd: false }, "tapped(off)");
}

writeFileSync(path, JSON.stringify(fx, null, 1) + "\n");
console.log("fixture rewritten");

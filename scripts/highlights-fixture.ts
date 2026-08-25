/**
 * Regenerates the highlight-picker parity fixture.
 *
 *   node --experimental-strip-types scripts/highlights-fixture.ts
 *
 * The fixture (ios/Tests/fixtures/highlights-parity.json) carries a real
 * match's points and, under `expected`, THIS script's picks at each
 * budget — the web picker's own output, so the Swift port in
 * Core/Highlights.swift is compared against the original rather than
 * against a second reading of the spec (the serve-parity.json pattern).
 *
 * Change the rule in highlights.ts, run this, and commit the fixture with
 * it; ios/Tests/run.sh then says whether the Swift side kept up. The
 * `points` block is a database dump and is left untouched here.
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

const path = new URL("../ios/Tests/fixtures/highlights-parity.json", import.meta.url);
const fx = JSON.parse(readFileSync(path, "utf8"));

const pad = clipPad(fx.strictness, fx.clip_pads);
const points = sortPoints(
  fx.points.map((r: Record<string, unknown>) => ({
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

fx.pad = pad;
fx.expected = {};
for (const kind of Object.keys(HIGHLIGHT_BUDGETS_S) as HighlightKind[]) {
  const { picks, totalS } = pickHighlights(points, pad, HIGHLIGHT_BUDGETS_S[kind]);
  fx.expected[kind] = { ids: picks.map((p) => p.id), totalS };
  console.log(
    `${kind}: ${picks.length} rallies, ${totalS}s of ${HIGHLIGHT_BUDGETS_S[kind]}`
  );
}
writeFileSync(path, JSON.stringify(fx, null, 1) + "\n");
console.log("fixture rewritten");

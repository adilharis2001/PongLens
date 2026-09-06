// The product's own boundary rule, over the corpus. Imports scoreGaps
// rather than restating stepBoundaryWalk: a second copy of the game
// boundary read 25 short games where the shipped one reads 12.
import { readFileSync } from "node:fs";
import { scoreMatch } from "/Users/adil/Desktop/Projects/PongLens/src/lib/research/scoreGaps.ts";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const byMatch = new Map();
for (const r of rows) {
  if (r.deleted) continue;                      // the match page hides these
  if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []);
  byMatch.get(r.match_id).push({
    id: r.id, idx: r.idx,
    t0: r.t0 === null ? null : Number(r.t0),
    t1: r.t1 === null ? null : Number(r.t1),
    is_let: !!r.is_let,
    confirmed_winner: r.confirmed_winner,
    game_end_override: r.game_end_override ?? null,
    game_winner_override: r.game_winner_override ?? null,
  });
}
const out = {};
for (const [mid, pts] of byMatch) {
  const s = scoreMatch(pts);
  out[mid] = {
    scored: s.scored, visible: s.visible, suspect: s.suspect,
    overrun: s.overrun, missing: s.missing,
    games: s.games.map((g) => ({
      game: g.game, you: g.you, them: g.them, legal: g.legal, final: g.final,
      suspect: g.suspect, overrun: g.overrun, scored: g.scored,
      unscored: g.unscored, t0: Math.round(g.t0 * 100) / 100,
      t1: Math.round(g.t1 * 100) / 100,
      gaps: g.gaps.map((x) => ({ t: Math.round(x.t*100)/100, s: Math.round(x.seconds*100)/100 })),
    })),
  };
  console.log(`${mid.slice(0,8)}  scored ${String(s.scored).padStart(3)}  games ${s.games.length}  suspect ${s.suspect}  overrun ${s.overrun}  missing ${s.missing}   ` +
    s.games.map(g=>`${g.you}-${g.them}${g.suspect?"!":""}${g.overrun?"?":""}${g.final?"F":""}`).join(" "));
}
console.log(JSON.stringify(out), "\n---JSON-ABOVE---");

// Who served each point, from the product's own ITTF rotation.
// computeServing is imported rather than restated: it handles game
// boundaries, deuce, lets and server_override re-anchoring, and a second
// implementation would get one of those wrong.
import { readFileSync, writeFileSync } from "node:fs";
import { computeServing } from "/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/serving.ts";

const { points, matches } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = {};
for (const [mid, m] of Object.entries(matches)) {
  const visible = points
    .filter((p) => p.match_id === mid && !p.deleted)
    .sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0) || a.idx - b.idx)
    .map((p) => ({
      id: p.id, idx: p.idx, t0: p.t0, t1: p.t1,
      is_let: !!p.is_let,
      confirmed_winner: p.confirmed_winner,
      game_end_override: p.game_end_override ?? null,
      game_winner_override: p.game_winner_override ?? null,
      server_override: p.server_override ?? null,
    }));
  const serving = computeServing(visible, m.first_server ?? null);
  // The rotation answers in the uploader's frame; the table is in the
  // camera's. matches.user_side is the only thing that joins them.
  const userIsNear = m.user_side === "near";
  let named = 0;
  for (const p of visible) {
    const info = serving.get(p.id);
    const s = info?.server ?? null;
    const side = s === null ? null
      : (s === "user") === userIsNear ? "near" : "far";
    out[p.id] = { match_id: mid, idx: p.idx, side, source: info?.source ?? null,
                  is_let: p.is_let, scored: p.confirmed_winner != null };
    if (side) named += 1;
  }
  console.log(`${mid.slice(0,8)} ${String(m.opponent).slice(0,12).padEnd(12)} ` +
    `user_side=${m.user_side} first=${m.first_server}  ` +
    `${named}/${visible.length} points have a server from the rotation`);
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log("wrote", process.argv[3]);

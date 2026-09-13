// Runs the PRODUCT's own rotation, never a second reading of the rule.
import { readFileSync, writeFileSync } from "node:fs";
import { computeServing } from "/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/serving.ts";
import { computeMatchScore } from "/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/gameScore.ts";
import { physicalSideForGame } from "/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/sides.ts";

const pts = JSON.parse(readFileSync("points.json", "utf8"));
const m = JSON.parse(readFileSync("match.json", "utf8"));
const visible = pts.filter((p: { deleted: boolean }) => !p.deleted);

const serving = computeServing(visible, m.first_server ?? null);
const score = computeMatchScore(visible);

const out: Record<string, unknown>[] = [];
let g = 0;
for (const p of visible) {
  const info = serving.get(p.id);
  out.push({
    id: p.id, idx: p.idx, t0: p.t0,
    server: info?.server ?? null,
    source: info?.source ?? null,
    gameIndex: g,
    sideThisGame: m.user_side ? physicalSideForGame(m.user_side, g) : null,
  });
  if (score.boundaryAfter.has(p.id)) g += 1;
}
writeFileSync("rotation.json", JSON.stringify(out, null, 1));
console.log(`${out.length} visible points, ${g + 1} games, confirmed ${score.confirmedCount}`);
const bySrc: Record<string, number> = {};
for (const r of out) bySrc[String(r.source)] = (bySrc[String(r.source)] ?? 0) + 1;
console.log("server source:", bySrc);

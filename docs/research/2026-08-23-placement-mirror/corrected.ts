import { readFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
import { collectServePlacementObservations }
  from "file:///Users/adil/Desktop/Projects/PongLens/src/lib/placement/placementAggregate.ts";
const W = 1.525;
const match = JSON.parse(readFileSync(process.env.MATCH_JSON!, "utf8"));
const db = JSON.parse(readFileSync(process.env.POINTS_JSON!, "utf8"));
const raw = new Map<number, any>(match.points.map((p: any) => [p.idx, p]));
const points: any[] = db.map((r: any) => ({ ...r,
  confirmed_winner: r.winner, confirmed_how: r.how,
  suggestion: r.winner ? { winner: r.winner, how: r.how } : null,
  placement: raw.get(r.idx)?.placement ?? null }));
const visible = points.filter((p) => !p.deleted);
const score = computeMatchScore(visible as any);
const gi = new Map<string, number>(); let g = 0;
for (const p of visible) { gi.set(p.id, g); if (score.boundaryAfter.has(p.id)) g += 1; }
const userSide = process.env.USER_SIDE as "near" | "far";
const serving: any = computeServing(visible as any, "user");
const obs = collectServePlacementObservations({
  points: visible as any, userSide, gameIndexByPoint: gi, serving });

const third = (u: number) => u < W/3 ? 0 : u < 2*W/3 ? 1 : 2;
const tally = (rows: any[], flip: boolean) => {
  const c = [0,0,0];
  for (const o of rows) c[third(flip ? W - o.u : o.u)] += 1;
  return c;
};
const theirs = obs.filter((o) => o.filter === "theirServes");
const mine   = obs.filter((o) => o.filter === "myServes");
const fmt = (c: number[]) => `left(BH) ${c[0]}  middle ${c[1]}  right(FH) ${c[2]}`;
console.log(`=== ${process.env.LABEL} — their serves to you (n=${theirs.length})`);
console.log(`  as shipped : ${fmt(tally(theirs, false))}`);
console.log(`  un-mirrored: ${fmt(tally(theirs, true))}`);
console.log(`=== ${process.env.LABEL} — your serves to them (n=${mine.length})`);
console.log(`  as shipped : ${fmt(tally(mine, false))}`);
console.log(`  un-mirrored: ${fmt(tally(mine, true))}`);

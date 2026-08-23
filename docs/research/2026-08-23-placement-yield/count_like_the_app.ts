import { readFileSync, writeFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
import { collectTrustedPlacementObservations, trustedPlacementPointCount } from "file:///Users/adil/Desktop/Projects/PongLens/src/lib/placement/placementAggregate.ts";
// mappedPointCount() verbatim; its module is .tsx and strip-types is .ts only
const unflagged = (ps: any[]) => ps.some((p) => p.placement_flagged)
  ? ps.filter((p) => !p.placement_flagged) : ps;
const mappedPointCount = (ps: any, us: any, gi: any, sv: any) =>
  trustedPlacementPointCount(collectTrustedPlacementObservations(
    { points: unflagged(ps), userSide: us, gameIndexByPoint: gi, serving: sv }));

const DIR = process.env.DATA_DIR!;
const match = JSON.parse(readFileSync(process.env.MATCH_JSON ?? `${DIR}/chris.json`, "utf8"));
const db = JSON.parse(readFileSync(`${DIR}/chris_points.json`, "utf8"));
const plByIdx = new Map<number, any>(
  match.points.map((p: any) => [p.idx, p.placement]),
);
const points: any[] = db.map((r: any) => ({
  ...r,
  confirmed_winner: r.winner, confirmed_how: r.how,
  suggestion: r.winner ? { winner: r.winner, how: r.how } : null,
  placement: plByIdx.get(r.idx) ?? null,
}));
const visible = points.filter((p) => !p.deleted);

const score = computeMatchScore(visible as any);
const gameIndexByPoint = new Map<string, number>();
let g = 0;
for (const p of visible) {
  gameIndexByPoint.set(p.id, g);
  if (score.boundaryAfter.has(p.id)) g += 1;
}
const serving = computeServing(visible as any, "user");
const plotted = mappedPointCount(
  visible as any, "near", gameIndexByPoint, serving as any,
);
const obs = collectTrustedPlacementObservations({
  points: unflagged(visible), userSide: "near",
  gameIndexByPoint, serving: serving as any });
if (process.env.DUMP) {
  const idxById = new Map(points.map((p: any) => [p.id, p.idx]));
  writeFileSync(process.env.DUMP, JSON.stringify(
    obs.map((o: any) => ({ idx: idxById.get(o.pointId), seq: o.shotSeq,
      filter: o.filter, zone: o.zone, u: o.u, v: o.v, conf: o.confidence }))));
}
console.log(JSON.stringify({
  label: process.env.LABEL ?? "baseline",
  live: visible.length,
  points_plotted: plotted,
  landings_plotted: obs.length,
}));

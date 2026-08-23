import { readFileSync, writeFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
import {
  collectServePlacementObservations,
  collectTrustedPlacementObservations,
} from "file:///Users/adil/Desktop/Projects/PongLens/src/lib/placement/placementAggregate.ts";

const match = JSON.parse(readFileSync(process.env.MATCH_JSON!, "utf8"));
const db = JSON.parse(readFileSync(process.env.POINTS_JSON!, "utf8"));
const raw = new Map<number, any>(match.points.map((p: any) => [p.idx, p]));
const points: any[] = db.map((r: any) => ({
  ...r, confirmed_winner: r.winner, confirmed_how: r.how,
  suggestion: r.winner ? { winner: r.winner, how: r.how } : null,
  placement: raw.get(r.idx)?.placement ?? null,
}));
const visible = points.filter((p) => !p.deleted);
const score = computeMatchScore(visible as any);
const gameIndexByPoint = new Map<string, number>();
let g = 0;
for (const p of visible) {
  gameIndexByPoint.set(p.id, g);
  if (score.boundaryAfter.has(p.id)) g += 1;
}
const userSide = "near" as const;
const serving: any = computeServing(visible as any, "user");
const input = { points: visible as any, userSide, gameIndexByPoint, serving };
const serves = collectServePlacementObservations(input);
const oldPoints = new Set(
  collectTrustedPlacementObservations(input).map((o) => o.pointId),
);
const byId = new Map(points.map((p: any) => [p.id, p]));

const rows = serves.map((o) => {
  const p = byId.get(o.pointId)!;
  const src = raw.get(p.idx)!;
  const pl = p.placement;
  const serverSide = serving.get(p.id)?.server === "user"
    ? (gameIndexByPoint.get(p.id)! % 2 === 0 ? "near" : "far")
    : (gameIndexByPoint.get(p.id)! % 2 === 0 ? "far" : "near");
  const h = pl.hypotheses[serverSide];
  const serve = h.shots.find((s: any) => s.phase === "serve");
  const cand = (id: string | null) =>
    id === null ? null : pl.candidates.find((c: any) => c.id === id) ?? null;
  const landing = cand(serve.landing.event_id);
  const first = cand(serve.serve_first_bounce?.event_id ?? null);
  return {
    idx: p.idx, pointId: p.id, clip: src.clip, clip_t0: src.clip_t0,
    filter: o.filter, serverSide, isNew: !oldPoints.has(p.id),
    landing: landing && { t: landing.t, x: landing.x, y: landing.y, u: landing.u, v: landing.v },
    first: first && { t: first.t, x: first.x, y: first.y, u: first.u, v: first.v },
  };
});
writeFileSync(process.env.OUT!, JSON.stringify({
  fps: match.source.fps, width: match.source.width, height: match.source.height,
  corners: match.calibration.table_corners_px, rows,
}, null, 1));
console.log(JSON.stringify({
  serves: rows.length, brandNew: rows.filter((r) => r.isNew).length,
  withPixels: rows.filter((r) => r.landing?.x != null).length,
}));

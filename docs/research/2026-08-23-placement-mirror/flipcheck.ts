import { readFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
import { collectServePlacementObservations }
  from "file:///Users/adil/Desktop/Projects/PongLens/src/lib/placement/placementAggregate.ts";

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
const gi = new Map<string, number>(); let g = 0;
for (const p of visible) { gi.set(p.id, g); if (score.boundaryAfter.has(p.id)) g += 1; }
const userSide = process.env.USER_SIDE as "near" | "far";
const serving: any = computeServing(visible as any, "user");
const obs = collectServePlacementObservations({
  points: visible as any, userSide, gameIndexByPoint: gi, serving,
});

// The table's centre line in PIXELS: midpoint of the near pair to midpoint
// of the far pair. Which side of it a landing falls on is a fact about the
// picture, independent of every convention in the code.
const C = match.calibration.table_corners_px;
const mid = (a: number[], b: number[]) => [(a[0]+b[0])/2, (a[1]+b[1])/2];
const nearMid = mid(C.A_near_1, C.B_near_2);
const farMid  = mid(C.C_far_2,  C.D_far_1);
const sideOfCentreLine = (x: number, y: number) => {
  const dx = farMid[0]-nearMid[0], dy = farMid[1]-nearMid[1];
  return Math.sign(dx*(y-nearMid[1]) - dy*(x-nearMid[0]));
};
// Sign convention: check it against corner A, which IS the image-left one.
const signOfImageLeft = sideOfCentreLine(C.A_near_1[0], C.A_near_1[1]);

const byId = new Map(points.map((p: any) => [p.id, p]));
let agree = 0, disagree = 0;
const rows: any[] = [];
for (const o of obs) {
  const p = byId.get(o.pointId)!;
  const pl = p.placement;
  const gameIndex = gi.get(p.id)!;
  const ups = gameIndex % 2 === 0 ? userSide : (userSide === "near" ? "far" : "near");
  const server = serving.get(p.id)?.server;
  const serverSide = server === "user" ? ups : (ups === "near" ? "far" : "near");
  const h = pl.hypotheses[serverSide];
  const serve = h.shots.find((s: any) => s.phase === "serve");
  const cand = pl.candidates.find((c: any) => c.id === serve.landing.event_id);
  if (!cand || cand.x == null) continue;

  const imageLeft = sideOfCentreLine(cand.x, cand.y) === signOfImageLeft;
  const drawnLeft = o.u < 1.525 / 2;
  // What the picture says the USER's left is, given where they stand.
  //   near player faces AWAY from the camera -> their left is image-left
  //   far  player faces the camera           -> their left is image-right
  const usersLeftIsImageLeft = ups === "near";
  const trulyUsersLeft = imageLeft === usersLeftIsImageLeft;
  if (trulyUsersLeft === drawnLeft) agree++; else disagree++;
  rows.push({ idx: p.idx, game: gameIndex + 1, ups, filter: o.filter,
              imageLeft, trulyUsersLeft, drawnLeft });
}
console.log(JSON.stringify({
  match: process.env.LABEL, userSide, landings: rows.length,
  drawn_on_the_correct_side: agree, drawn_mirrored: disagree,
}, null, 1));
const byGame: Record<string, {ok:number,flip:number}> = {};
for (const r of rows) {
  const k = `game ${r.game} (${r.ups})`;
  byGame[k] ??= {ok:0,flip:0};
  if (r.trulyUsersLeft === r.drawnLeft) byGame[k].ok++; else byGame[k].flip++;
}
console.log(JSON.stringify(byGame, null, 1));

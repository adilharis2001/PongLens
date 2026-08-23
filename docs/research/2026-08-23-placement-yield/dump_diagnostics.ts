import { readFileSync, writeFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
import { collectTrustedPlacementObservations }
  from "file:///Users/adil/Desktop/Projects/PongLens/src/lib/placement/placementAggregate.ts";
const DIR = process.env.DATA_DIR!;
const match = JSON.parse(readFileSync(`${DIR}/chris.json`, "utf8"));
const db = JSON.parse(readFileSync(`${DIR}/chris_points.json`, "utf8"));
const plByIdx = new Map<number, any>(
  match.points.map((p: any) => [p.idx, p.placement]));
const points: any[] = db.map((r: any) => ({
  ...r, confirmed_winner: r.winner, confirmed_how: r.how,
  suggestion: r.winner ? { winner: r.winner, how: r.how } : null,
  placement: plByIdx.get(r.idx) ?? null }));
const visible = points.filter((p) => !p.deleted);
const score = computeMatchScore(visible as any);
const gameIndexByPoint = new Map<string, number>();
let g = 0;
for (const p of visible) {
  gameIndexByPoint.set(p.id, g);
  if (score.boundaryAfter.has(p.id)) g += 1;
}
const serving = computeServing(visible as any, "user") as any;
const other = (s: string) => (s === "near" ? "far" : "near");
const run = (file: string) => {
  const mm = JSON.parse(readFileSync(file, "utf8"));
  const by = new Map<number, any>(mm.points.map((p: any) => [p.idx, p.placement]));
  const pts = points.map((p) => ({ ...p, placement: by.get(p.idx) ?? null }));
  const obs = collectTrustedPlacementObservations({
    points: pts.filter((p: any) => !p.deleted) as any, userSide: "near",
    gameIndexByPoint, serving });
  const idxById = new Map(pts.map((p: any) => [p.id, p.idx]));
  const set = new Set(obs.map((o: any) => idxById.get(o.pointId)));
  return { set, obs, byIdx: by };
};
const A = run(`${DIR}/variant_A_baseline.json`);
const F = run(`${DIR}/variant_F_evidence_only.json`);
const out = visible.map((p: any) => {
  const gi = gameIndexByPoint.get(p.id) ?? 0;
  const userPhys = gi % 2 === 0 ? "near" : "far";
  const srv = serving.get(p.id)?.server ?? null;
  const serverSide = srv === null ? null
    : srv === "user" ? userPhys : other(userPhys);
  const pl = p.placement;
  const h = pl && serverSide ? pl.hypotheses[serverSide] : null;
  return {
    idx: p.idx, t0: p.t0, t1: p.t1, is_let: p.is_let,
    winner: p.winner, how: p.how, game: gi, userSide: userPhys,
    server: srv, serverSide,
    status: pl?.status ?? null,
    conf: h?.confidence ?? null, score: h?.score ?? null,
    reasons: h?.reasons ?? [], hard: h?.hard_reasons ?? [],
    shots: (h?.shots ?? []).map((s: any) => ({
      seq: s.seq, phase: s.phase, hitter: s.hitter_side,
      conf: s.confidence,
      landing: s.landing ? { u: s.landing.u ?? null, v: s.landing.v ?? null,
        x: s.landing.x ?? null, y: s.landing.y ?? null,
        conf: s.landing.confidence ?? null } : null,
      sfb: s.serve_first_bounce ? { u: s.serve_first_bounce.u ?? null,
        v: s.serve_first_bounce.v ?? null } : null })),
    cands: (pl?.candidates ?? []).map((c: any) => ({
      t: c.t, x: c.x, y: c.y, u: c.u, v: c.v,
      vc: c.visual_confidence, band: c.projection_safety_band })),
    plottedNow: A.set.has(p.idx), plottedF: F.set.has(p.idx),
  };
});
writeFileSync(`${DIR}/diag.json`, JSON.stringify({
  match: "ec6490f4-b835-4d82-882a-8fb2f1abc2e5",
  calibration: match.calibration, games: g + 1,
  counts: { live: visible.length, now: A.set.size, F: F.set.size,
            landingsNow: A.obs.length, landingsF: F.obs.length },
  points: out }));
console.log(JSON.stringify({ points: out.length, now: A.set.size, F: F.set.size }));

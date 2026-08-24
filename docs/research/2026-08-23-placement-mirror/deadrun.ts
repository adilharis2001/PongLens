import { readFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
const NET = 2.74 / 2;

/**
 * A dead run: the ball bouncing itself out on one half with nobody hitting
 * it. Three or more bounces, each within MAX_GAP of the last, no racket
 * contact in between, and going nowhere sideways.
 */
function deadRuns(cands: any[], maxGap: number, minLen: number, maxLateral: number) {
  const evs = [...cands].sort((a, b) => a.t - b.t);
  const runs: any[][] = [];
  let cur: any[] = [];
  for (const c of evs) {
    if (c.kind === "contact") { if (cur.length >= minLen) runs.push(cur); cur = []; continue; }
    if (c.kind !== "bounce" || c.u == null || c.v == null) continue;
    const half = c.v < NET ? "near" : "far";
    const last = cur[cur.length - 1];
    if (last && c.t - last.t <= maxGap && (last.v < NET ? "near" : "far") === half) {
      cur.push(c);
    } else {
      if (cur.length >= minLen) runs.push(cur);
      cur = [c];
    }
  }
  if (cur.length >= minLen) runs.push(cur);
  return runs.filter((r) => {
    const us = r.map((c) => c.u);
    return Math.max(...us) - Math.min(...us) <= maxLateral;
  });
}

for (const [label, file, userSide, first] of [
  ["Chris", "chris", "near", "user"],
  ["Julian", "julian", "far", "opponent"],
] as const) {
  const m = JSON.parse(readFileSync(`${process.env.SC}/${file}.json`, "utf8"));
  const db = JSON.parse(readFileSync(`${process.env.SC}/${file}_points.json`, "utf8"));
  const raw = new Map<number, any>(m.points.map((p: any) => [p.idx, p]));
  const points: any[] = db.map((r: any) => ({ ...r, confirmed_winner: r.winner,
    suggestion: r.winner ? { winner: r.winner, how: r.how } : null,
    placement: raw.get(r.idx)?.placement ?? null }));
  const visible = points.filter((p) => !p.deleted);
  const score = computeMatchScore(visible as any);
  const gi = new Map<string, number>(); let g = 0;
  for (const p of visible) { gi.set(p.id, g); if (score.boundaryAfter.has(p.id)) g += 1; }

  let withRun = 0, correct = 0, wrong = 0, noRun = 0;
  let workerCorrect = 0, workerCompared = 0;
  let nearNet = 0;
  for (const p of visible) {
    const src = raw.get(p.idx);
    const pl = src?.placement;
    if (!pl || pl.v !== 3 || !p.confirmed_winner) continue;
    const gameIndex = gi.get(p.id) ?? 0;
    const userPhysical = gameIndex % 2 === 0 ? userSide
      : userSide === "near" ? "far" : "near";
    // The worker's own call, for comparison on the same points.
    const sg = raw.get(p.idx)?.suggestion;
    if (sg?.winner) { workerCompared++; if (sg.winner === p.confirmed_winner) workerCorrect++; }

    const runs = deadRuns(pl.candidates ?? [], 0.45, 3, 0.35);
    if (runs.length === 0) { noRun++; continue; }
    const last = runs[runs.length - 1];
    const half = last[0].v < NET ? "near" : "far";
    // Whoever's side the ball dies on, loses.
    const loser = half === userPhysical ? "user" : "opponent";
    const predicted = loser === "user" ? "opponent" : "user";
    withRun++;
    if (predicted === p.confirmed_winner) correct++; else wrong++;
    if (Math.abs(last[0].v - NET) < 0.4) nearNet++;
  }
  const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(0)}%` : "n/a";
  console.log(`${label}:`);
  console.log(`  points with a dead run: ${withRun}   without: ${noRun}`);
  console.log(`  "the side it dies on loses" is right on ${correct} of ${withRun}`
    + `  (${pct(correct, withRun)})`);
  console.log(`  of those runs, ${nearNet} start within 40 cm of the net`);
  console.log(`  the worker, on every scored point: ${workerCorrect} of ${workerCompared}`
    + `  (${pct(workerCorrect, workerCompared)})`);
}

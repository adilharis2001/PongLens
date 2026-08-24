import { readFileSync } from "node:fs";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
const NET = 2.74 / 2;
function deadRuns(cands: any[], maxGap: number, minLen: number, maxLat: number) {
  const evs = [...cands].sort((a, b) => a.t - b.t);
  const runs: any[][] = []; let cur: any[] = [];
  for (const c of evs) {
    if (c.kind === "contact") { if (cur.length >= minLen) runs.push(cur); cur = []; continue; }
    if (c.kind !== "bounce" || c.u == null || c.v == null) continue;
    const half = c.v < NET ? "near" : "far";
    const last = cur[cur.length - 1];
    if (last && c.t - last.t <= maxGap && (last.v < NET ? "near" : "far") === half) cur.push(c);
    else { if (cur.length >= minLen) runs.push(cur); cur = [c]; }
  }
  if (cur.length >= minLen) runs.push(cur);
  return runs.filter((r) => {
    const us = r.map((c) => c.u); return Math.max(...us) - Math.min(...us) <= maxLat;
  });
}
const data = (["chris", "julian"] as const).map((file) => {
  const m = JSON.parse(readFileSync(`${process.env.SC}/${file}.json`, "utf8"));
  const db = JSON.parse(readFileSync(`${process.env.SC}/${file}_points.json`, "utf8"));
  const raw = new Map<number, any>(m.points.map((p: any) => [p.idx, p]));
  const pts: any[] = db.map((r: any) => ({ ...r, confirmed_winner: r.winner }));
  const visible = pts.filter((p) => !p.deleted);
  const score = computeMatchScore(visible as any);
  const gi = new Map<string, number>(); let g = 0;
  for (const p of visible) { gi.set(p.id, g); if (score.boundaryAfter.has(p.id)) g += 1; }
  return { file, raw, visible, gi,
    userSide: file === "chris" ? "near" : "far" };
});
console.log("minLen  gap   lateral |  fires  correct  precision | worker right on those");
for (const minLen of [2, 3, 4]) {
  for (const gap of [0.35, 0.45, 0.6]) {
    let fires = 0, correct = 0, workerRight = 0;
    for (const d of data) {
      for (const p of d.visible) {
        const src = d.raw.get(p.idx); const pl = src?.placement;
        if (!pl || pl.v !== 3 || !p.confirmed_winner) continue;
        const gameIndex = d.gi.get(p.id) ?? 0;
        const up = gameIndex % 2 === 0 ? d.userSide
          : d.userSide === "near" ? "far" : "near";
        const runs = deadRuns(pl.candidates ?? [], gap, minLen, 0.35);
        if (!runs.length) continue;
        const last = runs[runs.length - 1];
        const half = last[0].v < NET ? "near" : "far";
        const predicted = half === up ? "opponent" : "user";
        fires++;
        if (predicted === p.confirmed_winner) correct++;
        if (src?.suggestion?.winner === p.confirmed_winner) workerRight++;
      }
    }
    console.log(`  ${minLen}    ${gap.toFixed(2)}   0.35    |  ${String(fires).padStart(4)}`
      + `  ${String(correct).padStart(6)}   ${fires ? (100*correct/fires).toFixed(0)+"%" : "  -"}`
      + `      |  ${workerRight} of ${fires} (${fires ? (100*workerRight/fires).toFixed(0)+"%" : "-"})`);
  }
}

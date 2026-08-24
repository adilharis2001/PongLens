import { readFileSync } from "node:fs";
import { finalExits, prismPolygon, inPrism }
  from "file:///Users/adil/Desktop/Projects/PongLens/src/app/research/serve-accuracy/prism.ts";
const tracks = JSON.parse(readFileSync(
  "/Users/adil/Desktop/Projects/PongLens/src/app/research/serve-accuracy/tracks.json", "utf8"));
for (const [name, file] of [["Chris","chris"],["Julian","julian"]] as const) {
  const m = JSON.parse(readFileSync(`${process.env.SC}/${file}.json`, "utf8"));
  const rows = JSON.parse(readFileSync(`${process.env.SC}/${file}_points.json`, "utf8"));
  const byIdx = new Map<number, string>(rows.map((r: any) => [r.idx, r.id]));
  const poly = prismPolygon(m.calibration.table_corners_px);
  if (!poly) { console.log(name, "no prism"); continue; }
  const W = m.source.width, H = m.source.height;
  let withExit = 0, none = 0; const errs: number[] = [];
  let outsideFrac = 0, n = 0;
  for (const p of m.points) {
    const t = tracks[byIdx.get(p.idx) ?? ""];
    if (!t || p.clip_t0 == null || p.t1 == null) continue;
    n += 1;
    const out = t.filter((r: number[]) => !inPrism(poly, r[1]*W, r[2]*H)).length;
    outsideFrac += out / Math.max(1, t.length);
    const ex = finalExits(t, poly, W, H);
    if (ex.length === 0) { none += 1; continue; }
    withExit += 1;
    // The point's real end, in clip seconds.
    errs.push(ex[ex.length - 1] - (p.t1 - p.clip_t0));
  }
  errs.sort((a, b) => a - b);
  const q = (f: number) => errs[Math.floor(f * (errs.length - 1))];
  console.log(`${name}: ${n} points`);
  console.log(`  an exit was found in ${withExit}, none in ${none}`);
  console.log(`  ball outside the prism ${(100*outsideFrac/n).toFixed(0)}% of tracked frames`);
  if (errs.length) console.log(
    `  last exit vs the point's end: median ${q(.5).toFixed(2)}s  `
    + `p10 ${q(.1).toFixed(2)}  p90 ${q(.9).toFixed(2)}  `
    + `within 1s: ${(100*errs.filter(e=>Math.abs(e)<=1).length/errs.length).toFixed(0)}%`);
}

import { readFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
const W = 1.525, L = 2.74, NET = L / 2;
const other = (s: string) => (s === "near" ? "far" : "near");
const half = (v: number) => (v < NET ? "near" : "far");

const match = JSON.parse(readFileSync(process.env.MATCH_JSON!, "utf8"));
const db = JSON.parse(readFileSync(process.env.POINTS_JSON!, "utf8"));
const plByIdx = new Map<number, any>(match.points.map((p: any) => [p.idx, p.placement]));
const points: any[] = db.map((r: any) => ({
  ...r, confirmed_winner: r.winner, confirmed_how: r.how,
  suggestion: r.winner ? { winner: r.winner, how: r.how } : null,
  placement: plByIdx.get(r.idx) ?? null,
}));
const visible = points.filter((p) => !p.deleted);
const score = computeMatchScore(visible as any);
const gi = new Map<string, number>(); let g = 0;
for (const p of visible) { gi.set(p.id, g); if (score.boundaryAfter.has(p.id)) g += 1; }
const userSide = process.env.USER_SIDE ?? "near";
const serving: any = computeServing(visible as any, "user");

type Rule = (a: {
  bounceOrd: number; firstOrd: number | null; gap: number | null;
  contactsBetween: number;
}) => boolean;
const RULES: Record<string, Rule> = {
  "A from-start<=1": (a) => a.bounceOrd <= 1,
  "B consecutive-after-fb": (a) => a.gap === null ? a.bounceOrd <= 1 : a.gap === 1,
  "C from-start<=2": (a) => a.bounceOrd <= 2,
  "D consecutive, no gate": (a) => a.gap === 1,
  "E consec + no contact between": (a) =>
    a.gap === null ? a.bounceOrd <= 1 : a.gap === 1 && a.contactsBetween === 0,
  "F none (rules 1-4,6 only)": () => true,
};

const results: Record<string, number> = {};
for (const [name, rule] of Object.entries(RULES)) {
  let ok = 0;
  for (const p of visible) {
    const pl = p.placement;
    if (!pl || pl.v !== 3) continue;
    const gameIndex = gi.get(p.id) ?? 0;
    const ups = gameIndex % 2 === 0 ? userSide : other(userSide);
    const server = serving.get(p.id)?.server ?? null;
    if (server === null) continue;
    const serverSide = server === "user" ? ups : other(ups);
    const h = pl.hypotheses[serverSide];
    const serve = (h?.shots ?? []).find((s: any) => s.phase === "serve");
    if (!serve) continue;
    const landing = serve.landing;
    if (!landing || typeof landing.u !== "number" || typeof landing.v !== "number") continue;
    if (!(landing.u >= 0 && landing.u <= W && landing.v >= 0 && landing.v <= L)) continue;
    if (half(landing.v) !== other(serverSide)) continue;
    const fb = serve.serve_first_bounce;
    if (fb && typeof fb.v === "number" && half(fb.v) !== serverSide) continue;

    const bounces = pl.candidates.filter((c: any) => c.kind === "bounce")
      .slice().sort((a: any, b: any) => a.t - b.t);
    const bounceOrd = bounces.findIndex((c: any) => c.id === landing.event_id);
    if (bounceOrd < 0) continue;
    const firstOrd = fb?.event_id
      ? bounces.findIndex((c: any) => c.id === fb.event_id) : -1;
    const gap = firstOrd >= 0 ? bounceOrd - firstOrd : null;
    const tLand = bounces[bounceOrd].t;
    const tFirst = firstOrd >= 0 ? bounces[firstOrd].t : null;
    const contactsBetween = tFirst === null ? 0 : pl.candidates.filter(
      (c: any) => c.kind === "contact" && c.t > tFirst && c.t < tLand).length;
    if (rule({ bounceOrd, firstOrd: firstOrd >= 0 ? firstOrd : null, gap, contactsBetween })) ok += 1;
  }
  results[name] = ok;
}
console.log(JSON.stringify({ live: visible.length, results }, null, 1));

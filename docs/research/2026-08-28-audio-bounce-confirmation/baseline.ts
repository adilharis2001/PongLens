/**
 * How many serves draw a dot today, asked of the shipped code.
 *
 *   node --experimental-strip-types --import ./resolver_hook.mjs \
 *        baseline.ts <corpus-dir> [placement-override-dir]
 *
 * Everything that decides anything here is imported from src/: the game
 * boundaries, the serve rotation and the six serve-placement rules. This
 * file only loads rows and counts what comes back. A private copy of the
 * rule would agree with itself about a decision the app does not make,
 * which is the failure this project has already paid for twice.
 *
 * With a second directory it re-runs the same count over replayed
 * placement JSON (`<slug>.json`, {pointId: placement}), so a change in the
 * worker is scored on the app's own ruler rather than on a proxy.
 */
import { readFileSync, existsSync } from "node:fs";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { computeServing } from "@/app/match/[id]/serving";
import {
  diagnoseServePlacement,
  type ServePlacementDiagnosis,
  type ServePlacementRejection,
} from "@/lib/placement/placementAggregate";

const REJECTIONS: (ServePlacementRejection | "drawn")[] = [
  "drawn", "no_landing", "wrong_half", "first_bounce_wrong_half",
  "off_table", "not_consecutive", "no_serve_shot", "no_server",
  "not_v3", "no_zone", "deleted",
];

export interface MatchResult {
  slug: string;
  diagnoses: ServePlacementDiagnosis[];
  scoredIds: Set<string>;
  live: number;
}

export function runMatch(dir: string, slug: string,
                         overrideDir?: string): MatchResult {
  const raw = JSON.parse(readFileSync(`${dir}/${slug}.json`, "utf8"));
  const match = raw.match;
  let points = raw.points as any[];
  if (overrideDir) {
    // Missing replay output must be an error, never a silent fall-back to
    // the database. Falling back would make an arm identical to its own
    // baseline and print "nothing moved", which is also what a real null
    // result looks like.
    const path = `${overrideDir}/${slug}.json`;
    if (!existsSync(path)) throw new Error(`no replayed placement at ${path}`);
    const by = JSON.parse(readFileSync(path, "utf8"));
    // Deleted points are not replayed and are not judged, so only a live
    // point missing from the arm is a real hole.
    points = points.map((p) => {
      if (p.deleted) return p;
      if (!(p.id in by)) throw new Error(`${slug}: point ${p.id} not replayed`);
      return { ...p, placement: by[p.id] };
    });
  }
  const visible = points.filter((p) => !p.deleted);
  const score = computeMatchScore(visible as any);
  const gameIndexByPoint = new Map<string, number>();
  let game = 0;
  for (const p of visible) {
    gameIndexByPoint.set(p.id, game);
    if (score.boundaryAfter.has(p.id)) game += 1;
  }
  const serving = computeServing(visible as any, match.first_server);
  const diagnoses = diagnoseServePlacement({
    points: visible as any,
    userSide: match.user_side,
    gameIndexByPoint,
    serving,
  });
  return {
    slug,
    diagnoses,
    scoredIds: new Set(visible.filter((p) => p.confirmed_winner)
                              .map((p) => p.id)),
    live: visible.length,
  };
}

export function tally(result: MatchResult, scoredOnly: boolean) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const d of result.diagnoses) {
    if (scoredOnly && !result.scoredIds.has(d.pointId)) continue;
    total += 1;
    const key = d.observation !== null ? "drawn" : d.rejection!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { total, counts, drawn: counts.get("drawn") ?? 0 };
}

function main() {
  const dir = process.argv[2];
  const overrideDir = process.argv[3];
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  const results = manifest.map((m: any) => runMatch(dir, m.slug, overrideDir));

  for (const scoredOnly of [true, false]) {
    console.log(`\n=== ${scoredOnly ? "scored points only" : "every live point"} ===`);
    const head = ["match", "pts", "drawn", "%"]
      .map((h, i) => h.padStart(i === 0 ? 9 : 6)).join(" ");
    console.log(head + REJECTIONS.slice(1).map((r) =>
      r.slice(0, 9).padStart(10)).join(""));
    const totals = new Map<string, number>();
    let allPts = 0, allDrawn = 0;
    for (const result of results) {
      const t = tally(result, scoredOnly);
      allPts += t.total; allDrawn += t.drawn;
      for (const [k, v] of t.counts) totals.set(k, (totals.get(k) ?? 0) + v);
      console.log(
        result.slug.padStart(9) + String(t.total).padStart(7)
        + String(t.drawn).padStart(7)
        + `${Math.round(t.drawn / t.total * 100)}%`.padStart(7)
        + REJECTIONS.slice(1).map((r) =>
            String(t.counts.get(r) ?? 0).padStart(10)).join(""));
    }
    console.log(
      "TOTAL".padStart(9) + String(allPts).padStart(7)
      + String(allDrawn).padStart(7)
      + `${Math.round(allDrawn / allPts * 100)}%`.padStart(7)
      + REJECTIONS.slice(1).map((r) =>
          String(totals.get(r) ?? 0).padStart(10)).join(""));
    console.log("\nshare of all points, by outcome:");
    for (const r of REJECTIONS) {
      const n = r === "drawn" ? allDrawn : (totals.get(r) ?? 0);
      if (n) console.log(`  ${r.padEnd(26)} ${String(n).padStart(4)}  `
                         + `${(n / allPts * 100).toFixed(1)}%`);
    }
  }
}

if (process.argv[1].endsWith("baseline.ts")) main();

/**
 * Two placement arms, one ruler, and every point that moved either way.
 *
 *   ./run.sh compare.ts <corpus-dir> <before-dir|-> <after-dir|-> [label]
 *
 * `-` means the placement already in the database, which is what the app
 * draws today. Anything else is a directory of replayed placements.
 *
 * Prints the count each side, the transition matrix between outcomes, and
 * — the number this exists for — the points that got WORSE, named, beside
 * the ones that improved. A coverage figure that only reports its gains is
 * how a change that trades quality for reach gets shipped.
 */
import { readFileSync } from "node:fs";
import { runMatch, tally } from "./baseline.ts";

function outcome(d: any): string {
  return d.observation !== null ? "drawn" : d.rejection;
}

const ORDER = [
  "drawn", "no_landing", "wrong_half", "first_bounce_wrong_half",
  "off_table", "not_consecutive", "no_serve_shot", "no_server", "not_v3",
  "no_zone", "deleted",
];

function main() {
  const [corpus, beforeArg, afterArg, label] = process.argv.slice(2);
  const before = beforeArg === "-" ? undefined : beforeArg;
  const after = afterArg === "-" ? undefined : afterArg;
  const manifest = JSON.parse(readFileSync(`${corpus}/manifest.json`, "utf8"));

  const moves = new Map<string, number>();
  const worse: any[] = [];
  const better: any[] = [];
  let allBefore = 0, allAfter = 0, allPts = 0;

  console.log(`\n=== ${label ?? "before vs after"} — scored points only ===`);
  console.log("    match    pts   before    after     gain     lost      net");
  for (const m of manifest) {
    let b, a;
    try {
      b = runMatch(corpus, m.slug, before);
      a = runMatch(corpus, m.slug, after);
    } catch (err) {
      console.log(`${m.slug.padStart(9)}   skipped: ${(err as Error).message}`);
      continue;
    }
    const byIdB = new Map(b.diagnoses.map((d) => [d.pointId, d]));
    const byIdA = new Map(a.diagnoses.map((d) => [d.pointId, d]));
    let gained = 0, lost = 0;
    for (const [id, db] of byIdB) {
      if (!b.scoredIds.has(id)) continue;
      const da = byIdA.get(id);
      if (!da) continue;
      const ob = outcome(db), oa = outcome(da);
      if (ob !== oa) {
        const key = `${ob} -> ${oa}`;
        moves.set(key, (moves.get(key) ?? 0) + 1);
      }
      if (ob !== "drawn" && oa === "drawn") { gained += 1; better.push({ m: m.slug, id, from: ob }); }
      if (ob === "drawn" && oa !== "drawn") { lost += 1; worse.push({ m: m.slug, id, to: oa }); }
    }
    const tb = tally(b, true), ta = tally(a, true);
    allBefore += tb.drawn; allAfter += ta.drawn; allPts += tb.total;
    console.log(
      m.slug.padStart(9) + String(tb.total).padStart(7)
      + `${tb.drawn} (${Math.round(tb.drawn / tb.total * 100)}%)`.padStart(9)
      + `${ta.drawn} (${Math.round(ta.drawn / ta.total * 100)}%)`.padStart(9)
      + String(gained).padStart(9) + String(lost).padStart(9)
      + `${ta.drawn - tb.drawn >= 0 ? "+" : ""}${ta.drawn - tb.drawn}`.padStart(9));
  }
  console.log(
    "TOTAL".padStart(9) + String(allPts).padStart(7)
    + `${allBefore} (${Math.round(allBefore / allPts * 100)}%)`.padStart(9)
    + `${allAfter} (${Math.round(allAfter / allPts * 100)}%)`.padStart(9)
    + String(better.length).padStart(9) + String(worse.length).padStart(9)
    + `${allAfter - allBefore >= 0 ? "+" : ""}${allAfter - allBefore}`.padStart(9));

  console.log("\nevery outcome that changed:");
  const keys = [...moves.keys()].sort((x, y) => (moves.get(y)! - moves.get(x)!));
  if (!keys.length) console.log("  (nothing moved)");
  for (const k of keys) console.log(`  ${k.padEnd(48)} ${moves.get(k)}`);

  console.log(`\nserves that started drawing (${better.length}), by what refused them before:`);
  const fromCounts = new Map<string, number>();
  for (const x of better) fromCounts.set(x.from, (fromCounts.get(x.from) ?? 0) + 1);
  for (const r of ORDER) if (fromCounts.get(r)) console.log(`  ${r.padEnd(26)} ${fromCounts.get(r)}`);

  console.log(`\nserves that STOPPED drawing (${worse.length}), by what refuses them now:`);
  const toCounts = new Map<string, number>();
  for (const x of worse) toCounts.set(x.to, (toCounts.get(x.to) ?? 0) + 1);
  if (!worse.length) console.log("  (none)");
  for (const r of ORDER) if (toCounts.get(r)) console.log(`  ${r.padEnd(26)} ${toCounts.get(r)}`);
  for (const x of worse) console.log(`    ${x.m} ${x.id} -> ${x.to}`);
}

main();

/** {slug: {pointId: outcome}} for one arm, so Python can join on it.
 *
 *   ./run.sh dump_outcomes.ts <corpus-dir> <arm-dir|-> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runMatch } from "./baseline.ts";

/** Which physical end the server was on — the hypothesis the rule read. */
function serverSide(match: any, gameIndex: number, server: string | null) {
  if (server === null || match.user_side === null) return null;
  const userPhysical = gameIndex % 2 === 0
    ? match.user_side
    : match.user_side === "near" ? "far" : "near";
  const other = (s: string) => (s === "near" ? "far" : "near");
  return server === "user" ? userPhysical : other(userPhysical);
}

const [corpus, armArg, out] = process.argv.slice(2);
const arm = armArg === "-" ? undefined : armArg;
const manifest = JSON.parse(readFileSync(`${corpus}/manifest.json`, "utf8"));
const all: Record<string, Record<string, any>> = {};
for (const m of manifest) {
  let r;
  try { r = runMatch(corpus, m.slug, arm); } catch { continue; }
  all[m.slug] = {};
  const row = JSON.parse(readFileSync(`${corpus}/${m.slug}.json`, "utf8"));
  for (const d of r.diagnoses) {
    if (!r.scoredIds.has(d.pointId)) continue;
    all[m.slug][d.pointId] = {
      outcome: d.observation !== null ? "drawn" : d.rejection!,
      serverSide: serverSide(row.match, d.gameIndex, d.server),
    };
  }
}
writeFileSync(out, JSON.stringify(all));
console.log(Object.entries(all).map(([k, v]) =>
  `${k} ${Object.keys(v).length}`).join("  "));

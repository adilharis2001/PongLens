/**
 * Per-point truth from the app's own code: game index, who served (ITTF
 * rotation as the scorekeeper runs it), user's physical side that game,
 * and the serve-placement diagnosis. Emits JSON for the Python analysis.
 *
 *   node --experimental-strip-types --import ./register_hook.mjs emit_serving.ts <corpus-dir> <out-dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { computeServing } from "@/app/match/[id]/serving";
import { diagnoseServePlacement } from "@/lib/placement/placementAggregate";

const dir = process.argv[2];
const out = process.argv[3];
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
for (const m of manifest) {
  const raw = JSON.parse(readFileSync(`${dir}/${m.slug}.json`, "utf8"));
  const match = raw.match;
  const visible = (raw.points as any[]).filter((p) => !p.deleted);
  const score = computeMatchScore(visible as any);
  const gameIndexByPoint = new Map<string, number>();
  let game = 0;
  for (const p of visible) {
    gameIndexByPoint.set(p.id, game);
    if (score.boundaryAfter.has(p.id)) game += 1;
  }
  const serving = computeServing(visible as any, match.first_server);
  const diagnoses = match.user_side
    ? diagnoseServePlacement({ points: visible as any, userSide: match.user_side, gameIndexByPoint, serving })
    : [];
  const byId = new Map(diagnoses.map((d) => [d.pointId, d]));
  const rows = visible.map((p) => {
    const gi = gameIndexByPoint.get(p.id) ?? 0;
    const userPhys = match.user_side ? (gi % 2 === 0 ? match.user_side : (match.user_side === "near" ? "far" : "near")) : null;
    const s = serving.get(p.id);
    const d = byId.get(p.id);
    return {
      pointId: p.id, idx: p.idx, gameIndex: gi,
      server: s?.server ?? null,
      userPhysicalSide: userPhys,
      serverSide: s?.server && userPhys ? (s.server === "user" ? userPhys : (userPhys === "near" ? "far" : "near")) : null,
      winner: p.confirmed_winner ?? null,
      isLet: !!p.is_let,
      rejection: d?.rejection ?? null,
      observation: d?.observation ? { u: d.observation.u, v: d.observation.v, zone: d.observation.zone, filter: d.observation.filter } : null,
      finalLanding: d?.finalLanding ?? null,
    };
  });
  writeFileSync(`${out}/${m.slug}.serving.json`, JSON.stringify({ games: game + 1, rows }));
  const drawn = rows.filter((r) => r.observation).length;
  const scored = rows.filter((r) => r.winner).length;
  console.log(`${m.slug.padEnd(22)} games=${game + 1} scored=${scored} servesDrawn=${drawn}`);
}

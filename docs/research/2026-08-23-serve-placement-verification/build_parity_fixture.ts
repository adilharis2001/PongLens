import { readFileSync, writeFileSync } from "node:fs";
import { computeServing } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/serving.ts";
import { computeMatchScore } from "file:///Users/adil/Desktop/Projects/PongLens/src/app/match/%5Bid%5D/gameScore.ts";
import { collectServePlacementObservations }
  from "file:///Users/adil/Desktop/Projects/PongLens/src/lib/placement/placementAggregate.ts";

const MATCH_ID = "ec6490f4-0000-4000-8000-000000000000";
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
const gameIndexByPoint = new Map<string, number>();
let g = 0;
for (const p of visible) {
  gameIndexByPoint.set(p.id, g);
  if (score.boundaryAfter.has(p.id)) g += 1;
}
const userSide = "near" as const;
const serving: any = computeServing(visible as any, "user");
const expected = collectServePlacementObservations({
  points: visible as any, userSide, gameIndexByPoint, serving,
});

/** Only what the rule reads, so the fixture is small enough to check in. */
const trimEvent = (e: any) =>
  e == null ? null
    : { event_id: e.event_id ?? null, u: e.u ?? null, v: e.v ?? null,
        confidence: e.confidence ?? 0 };
const trimHypothesis = (h: any) => ({
  status: h.status,
  confidence: h.confidence,
  server_side: h.server_side,
  hard_reasons: h.hard_reasons ?? [],
  reasons: [],
  shots: (h.shots ?? [])
    .filter((s: any) => s.phase === "serve")
    .map((s: any) => ({
      seq: s.seq, phase: s.phase, hitter_side: s.hitter_side,
      contact: null, terminal: null, confidence: s.confidence,
      serve_first_bounce: trimEvent(s.serve_first_bounce),
      landing: trimEvent(s.landing),
    })),
});
const trimPlacement = (pl: any) =>
  pl == null || pl.v !== 3 ? null : {
    v: 3, status: pl.status,
    candidates: (pl.candidates ?? []).map((c: any) => ({
      id: c.id, kind: c.kind, t: c.t,
    })),
    hypotheses: {
      near: trimHypothesis(pl.hypotheses.near),
      far: trimHypothesis(pl.hypotheses.far),
    },
  };

const fixture = {
  note: "Generated from match ec6490f4 (Chris, PingPod, 22 Aug). "
    + "Point ids are the real ones; everything not read by the serve rule "
    + "is stripped. `expected` is the WEB collector's own output.",
  userSide,
  points: visible.map((p: any) => ({
    id: p.id,
    match_id: MATCH_ID,
    idx: p.idx,
    is_let: Boolean(p.is_let),
    starred: false,
    deleted: false,
    edited: false,
    tight_start: false,
    tight_end: false,
    game_index: gameIndexByPoint.get(p.id) ?? 0,
    server: serving.get(p.id)?.server ?? null,
    placement: trimPlacement(p.placement),
  })),
  expected: expected.map((o) => ({
    point_id: o.pointId, shot_seq: o.shotSeq, filter: o.filter,
    u: o.u, v: o.v,
  })),
};
writeFileSync(process.env.OUT!, JSON.stringify(fixture, null, 1));
console.log(JSON.stringify({
  points: fixture.points.length, expected: fixture.expected.length,
}));

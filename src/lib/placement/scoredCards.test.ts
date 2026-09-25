import assert from "node:assert/strict";
import test from "node:test";
import type { PlacementCandidateV3, PlacementV3, Point } from "../types.ts";
import {
  computeScoredCards,
  cutToSource,
  lastCleanBounce,
  pointEndSource,
  scoredCardsGate,
} from "./scoredCards.ts";

/**
 * A point served from the near end by the user (near, game 0): first
 * bounce on the near half, landing on the far half, both consecutive in
 * the candidate list so the app's own six serve rules accept it. Extra
 * bounces and contacts come after, on the source clock.
 */
function placement(opts: {
  first?: { u: number; v: number; t: number };
  landing?: { u: number; v: number; t: number };
  extra?: { u: number | null; v: number | null; t: number; kind?: "bounce" | "contact" }[];
}): PlacementV3 {
  const first = opts.first ?? { u: 0.7, v: 0.6, t: 100.0 };
  const landing = opts.landing ?? { u: 0.7, v: 2.2, t: 100.4 };
  const candidates: PlacementCandidateV3[] = [
    { id: "c1", kind: "bounce", kinds: ["table_bounce"], ...first, visual_confidence: 0.9, audio_confidence: 0 },
    { id: "c2", kind: "bounce", kinds: ["table_bounce"], ...landing, visual_confidence: 0.9, audio_confidence: 0 },
    ...(opts.extra ?? []).map((e, i) => ({
      id: `x${i}`,
      kind: e.kind ?? "bounce",
      kinds: [e.kind === "contact" ? "paddle_contact" : "table_bounce"],
      t: e.t,
      u: e.u,
      v: e.v,
      visual_confidence: 0.8,
      audio_confidence: 0,
    })),
  ];
  const serve = {
    id: "shot-1",
    seq: 1,
    phase: "serve" as const,
    hitter_side: "near" as const,
    contact_t: null,
    contact: null,
    serve_first_bounce: { event_id: "c1", ...first, confidence: 0.9 },
    landing: { event_id: "c2", ...landing, confidence: 0.9 },
    terminal: null,
    confidence: 0.9,
  };
  const hypothesis = (side: "near" | "far", shots: (typeof serve)[]) => ({
    serverSide: side,
    server_side: side,
    status: shots.length ? ("ready" as const) : ("unavailable" as const),
    confidence: shots.length ? 0.9 : 0.1,
    score: shots.length ? 5 : -5,
    reasons: [],
    hard_reasons: [],
    shots,
    used_event_ids: [],
  });
  return {
    v: 3,
    status: "ready",
    candidates,
    hypotheses: { near: hypothesis("near", [serve]), far: hypothesis("far", []) },
  };
}

function point(opts: {
  id: string;
  winner: "user" | "opponent" | null;
  placement?: PlacementV3 | null;
  rallyEndCut?: number | null;
  tapCut?: number | null;
  let?: boolean;
  t0?: number;
  t1?: number;
}): Point {
  return {
    id: opts.id,
    deleted: false,
    is_let: opts.let ?? false,
    confirmed_winner: opts.winner,
    placement: opts.placement ?? null,
    t0: opts.t0 ?? 100,
    t1: opts.t1 ?? 105,
    cut_t0: 50,
    rally_end_cut_s: opts.rallyEndCut ?? null,
    scored_at_cut_s: opts.tapCut ?? null,
    tight_start: false,
    tight_end: false,
  } as unknown as Point;
}

const prePad = () => 1;

function run(points: Point[]) {
  return computeScoredCards({
    points,
    userSide: "near",
    gameIndexByPoint: new Map(points.map((p) => [p.id, 0])),
    serving: new Map(points.map((p) => [p.id, { server: "user" as const }])),
    prePad,
  });
}

test("the gate opens at three scored points in four and ignores lets", () => {
  const scored = (n: number, of: number) =>
    scoredCardsGate([
      ...Array.from({ length: n }, (_, i) => point({ id: `s${i}`, winner: "user" })),
      ...Array.from({ length: of - n }, (_, i) => point({ id: `u${i}`, winner: null })),
      point({ id: "let", winner: null, let: true }),
    ]);
  assert.equal(scored(3, 4).open, true);
  assert.equal(scored(2, 4).open, false);
  assert.equal(scored(3, 4).eligible, 4);
  // The same integer arithmetic as highlight_generation_eligibility.
  assert.equal(scored(2, 3).open, false);
  assert.equal(scored(3, 3).required, 3);
  assert.equal(scored(41, 98).required, 74);
  assert.equal(scored(74, 98).open, true);
  assert.equal(scored(73, 98).open, false);
});

test("a game filter narrows the cards but never the gate", () => {
  const points = [
    point({ id: "a", winner: "user", placement: placement({}), rallyEndCut: 53.5 }),
    point({ id: "b", winner: "opponent", placement: placement({}), rallyEndCut: 55.5 }),
    point({ id: "c", winner: "user", placement: placement({}), rallyEndCut: 58 }),
    point({ id: "d", winner: "user", placement: placement({}), rallyEndCut: 58 }),
  ];
  const gameIndexByPoint = new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]);
  const serving = new Map(points.map((p) => [p.id, { server: "user" as const }]));
  const game1 = computeScoredCards({ points, userSide: "near", gameIndexByPoint, serving, prePad, gameFilter: 1 })!;
  assert.equal(game1.gate.scored, 4);
  assert.equal(game1.pointLength.considered, 2);
  assert.equal(game1.pointLength.covered, 2);
});

test("cut clock to source clock uses the padded clip start", () => {
  const p = point({ id: "a", winner: "user" });
  // source = t0 - pre - cut_t0 + cut_s = 100 - 1 - 50 + 60
  assert.equal(cutToSource(p, 1, 60), 109);
  assert.equal(cutToSource({ ...p, cut_t0: null } as Point, 1, 60), null);
});

test("a point ends at the earlier of the rally end and the score tap", () => {
  assert.equal(pointEndSource(point({ id: "a", winner: "user", rallyEndCut: 55, tapCut: 53 }), 1), 102);
  assert.equal(pointEndSource(point({ id: "b", winner: "user", rallyEndCut: 52, tapCut: 53 }), 1), 101);
  assert.equal(pointEndSource(point({ id: "c", winner: "user", tapCut: 53 }), 1), 102);
  assert.equal(pointEndSource(point({ id: "d", winner: "user" }), 1), null);
});

test("point length runs from the serve's first bounce to the point's end", () => {
  // first bounce at 100.0; rally end cut 53.5 -> source 102.5 -> 2.5 s
  const points = [
    point({ id: "a", winner: "user", placement: placement({}), rallyEndCut: 53.5 }),
    point({ id: "b", winner: "opponent", placement: placement({}), rallyEndCut: 55.5 }), // 4.5 s
    point({ id: "c", winner: "user", placement: placement({}), rallyEndCut: 58 }), // 7 s
  ];
  const result = run(points)!;
  assert.equal(result.pointLength.covered, 3);
  assert.deepEqual(result.pointLength.mine.map((b) => [b.won, b.lost]), [[1, 0], [0, 1], [1, 0]]);
  assert.deepEqual(result.pointLength.theirs.map((b) => [b.won, b.lost]), [[0, 0], [0, 0], [0, 0]]);
});

test("serve speed splits one player's serves into thirds by speed between the two bounces", () => {
  // Same distance (1.6 m), times 0.8 / 0.6 / 0.5 / 0.4 / 0.3 / 0.25 s
  const dts = [0.8, 0.6, 0.5, 0.4, 0.3, 0.25];
  const points = dts.map((dt, i) =>
    point({
      id: `s${i}`,
      winner: i >= 4 ? "user" : "opponent",
      placement: placement({ landing: { u: 0.7, v: 2.2, t: 100 + dt } }),
      rallyEndCut: 55,
    }),
  );
  const { mine, theirs } = run(points)!.serveSpeed;
  assert.equal(theirs.length, 0);
  assert.deepEqual(mine.map((b) => b.label), ["Slow", "Medium", "Fast"]);
  assert.deepEqual(mine.map((b) => b.won + b.lost), [2, 2, 2]);
  assert.deepEqual(mine[2], { ...mine[2], won: 2, lost: 0 });
  assert.equal(mine[0].fromKmh, null);
  assert.equal(mine[2].toKmh, null);
});

test("the last clean bounce ignores contacts, the net band and dead play", () => {
  const pl = placement({
    extra: [
      { u: 0.6, v: 0.5, t: 101.0 },                 // real landing on the near half
      { u: 0.6, v: 1.30, t: 101.3 },                // net band
      { u: 0.5, v: 2.6, t: 101.6 },                 // racket contact read as a bounce
      { u: 0.5, v: 2.6, t: 101.62, kind: "contact" },
      { u: 0.9, v: 2.4, t: 104.0 },                 // ball rolling about long after
    ],
  });
  const last = lastCleanBounce(pl, 105);
  assert.equal(last?.t, 101.0);
  // With the end anchor before 101.0 only the serve bounces remain.
  assert.equal(lastCleanBounce(pl, 100.5)?.t, 100.4);
});

test("endings show only when the last bounce agrees with the score on 70% of points", () => {
  // User (near) lost every point; the last bounce is on the near half on
  // eight points and on the far half on two -> 80%, shown.
  const agreeing = (i: number) =>
    point({
      id: `a${i}`,
      winner: "opponent",
      placement: placement({ extra: [{ u: 0.4, v: 0.3, t: 101.0 }] }),
      rallyEndCut: 52.5,
    });
  const disagreeing = (i: number) =>
    point({
      id: `d${i}`,
      winner: "opponent",
      placement: placement({ extra: [{ u: 0.4, v: 2.5, t: 101.0 }] }),
      rallyEndCut: 52.5,
    });
  const shown = run([
    ...Array.from({ length: 8 }, (_, i) => agreeing(i)),
    ...Array.from({ length: 2 }, (_, i) => disagreeing(i)),
  ])!.endings;
  assert.equal(shown.considered, 10);
  assert.equal(shown.agreed, 8);
  assert.equal(shown.shown, true);
  assert.equal(shown.lost, 8);
  assert.equal(shown.won, 0);
  assert.equal(shown.lostCounts.deep_left.total, 8);

  const hidden = run([
    ...Array.from({ length: 5 }, (_, i) => agreeing(i)),
    ...Array.from({ length: 5 }, (_, i) => disagreeing(i)),
  ])!.endings;
  assert.equal(hidden.shown, false);
});

test("nothing is computed below the scored gate or without a side", () => {
  const points = [
    point({ id: "a", winner: "user", placement: placement({}) }),
    point({ id: "b", winner: null }),
  ];
  assert.equal(run(points), null);
  assert.equal(
    computeScoredCards({
      points: [point({ id: "a", winner: "user" })],
      userSide: null,
      gameIndexByPoint: new Map(),
      serving: new Map(),
      prePad,
    }),
    null,
  );
});

/*
 * Hand cuts (matches.cut_source = 'manual'): the owner's marks are the
 * point. The End Point tap (t1) is the end, the start mark (t0) is the start
 * wherever the ball gave no serve time, and point length needs no side.
 * The same cases run in ios/Tests/ScoredCardsTests.swift.
 */
function runHandCut(points: Point[], userSide: "near" | "far" | null, placementTrusted = true) {
  return computeScoredCards({
    points,
    userSide,
    gameIndexByPoint: new Map(points.map((p) => [p.id, 0])),
    serving: new Map(points.map((p) => [p.id, { server: "user" as const }])),
    prePad,
    placementTrusted,
    handCut: true,
  });
}

const bands = (tallies: { won: number; lost: number }[]) =>
  tallies.map((b) => [b.won, b.lost]);

test("a hand cut times each point from its marks, with no side and no ball", () => {
  const points = [
    point({ id: "a", winner: "user", t0: 100, t1: 102 }), // 2 s
    point({ id: "b", winner: "opponent", t0: 200, t1: 204.5 }), // 4.5 s
    point({ id: "c", winner: "user", t0: 300, t1: 307 }), // 7 s
  ];
  const result = runHandCut(points, null, false)!;
  assert.notEqual(result, null);
  assert.equal(result.pointLength.covered, 3);
  assert.equal(result.pointLength.considered, 3);
  assert.deepEqual(bands(result.pointLength.mine), [[1, 0], [0, 1], [1, 0]]);
  // Nothing that needs the ball or the side.
  assert.deepEqual(result.serveSpeed, { mine: [], theirs: [] });
  assert.equal(result.endings.considered, 0);
  // The same points as an automatic cut, with no rally end or tap, have no length.
  assert.equal(run(points)!.pointLength.covered, 0);
});

test("a hand cut ends at the End Point tap, not at a later score tap", () => {
  // Score tap cut 60 -> source 109 would make it 9 s; the mark says 2 s.
  const points = [0, 1, 2].map((i) =>
    point({ id: `t${i}`, winner: "user", t0: 100, t1: 102, tapCut: 60 }),
  );
  assert.deepEqual(bands(runHandCut(points, "near")!.pointLength.mine), [[3, 0], [0, 0], [0, 0]]);
});

test("a hand cut uses the ball's serve time where it has one", () => {
  // A late Begin tap: the serve's first bounce (100.0) is before the mark
  // (101.5). From the bounce it is 3.5 s; from the mark it would be 2 s.
  const points = [0, 1, 2].map((i) =>
    point({ id: `s${i}`, winner: "user", placement: placement({}), t0: 101.5, t1: 103.5 }),
  );
  assert.deepEqual(bands(runHandCut(points, "near")!.pointLength.mine), [[0, 0], [3, 0], [0, 0]]);
  // Before the analysis is trusted, the mark is the start.
  assert.deepEqual(bands(runHandCut(points, "near", false)!.pointLength.mine), [[3, 0], [0, 0], [0, 0]]);
  // Without a side there is no serve to read, so the mark again.
  assert.deepEqual(bands(runHandCut(points, null)!.pointLength.mine), [[3, 0], [0, 0], [0, 0]]);
});

test("a hand cut with no trusted serve starts at the mark, not the first bounce", () => {
  // First bounce on the receiver's half: the serve rules refuse it. An
  // automatic cut would fall back to the first table bounce (100.0, 3.5 s);
  // the hand cut's own mark says 2 s.
  const refused = placement({
    first: { u: 0.7, v: 2.0, t: 100.0 },
    landing: { u: 0.7, v: 0.6, t: 100.4 },
  });
  const points = [0, 1, 2].map((i) =>
    point({ id: `r${i}`, winner: "user", placement: refused, t0: 101.5, t1: 103.5 }),
  );
  assert.deepEqual(bands(runHandCut(points, "near")!.pointLength.mine), [[3, 0], [0, 0], [0, 0]]);
});

test("a hand cut still waits for the scored gate", () => {
  const points = [
    point({ id: "a", winner: "user", t0: 100, t1: 102 }),
    point({ id: "b", winner: null, t0: 200, t1: 202 }),
  ];
  assert.equal(runHandCut(points, null), null);
});

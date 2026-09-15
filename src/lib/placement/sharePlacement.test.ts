import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  PlacementCandidateV3,
  PlacementHypothesisV3,
  PlacementShotV3,
  PlacementV3,
  Point,
} from "../types.ts";
import type { ServeInfo } from "../../app/match/[id]/serving.ts";
import {
  collectServePlacementObservations,
  collectTrustedPlacementObservations,
} from "./placementAggregate.ts";
import { computeScoredCards, lastCleanBounce } from "./scoredCards.ts";
import { slimPlacementForShare } from "./sharePlacement.ts";

/**
 * The public page's slim placement must produce exactly what the full
 * record produces. Two sources of truth:
 *
 *  - the iOS parity fixture, the web collector's own output over a real
 *    98-point match, for the serve maps;
 *  - a synthetic set of points carrying every field a real record does
 *    (pixels, confidences, kinds, net and off-table bounces, contacts,
 *    rally shots, terminals, reasons) for the video cards, whose timing
 *    the fixture does not hold.
 *
 * If a card starts reading a field the slim record drops, one of these
 * fails; that is the point of them.
 */

/* ------------------------------------------------------ real match maps */

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../ios/Tests/fixtures/serve-parity.json", import.meta.url),
    "utf8",
  ),
) as {
  userSide: "near" | "far";
  points: (Point & { game_index: number; server: "user" | "opponent" | null })[];
};

const fixtureIndex = new Map(fixture.points.map((p) => [p.id, p.game_index]));
const fixtureServing = new Map<string, ServeInfo>(
  fixture.points.map((p) => [
    p.id,
    { server: p.server, source: "rotation", isLet: false },
  ]),
);

for (const servesOnly of [true, false]) {
  test(`slim placement draws the same maps as the real record (servesOnly=${servesOnly})`, () => {
    const full: Point[] = fixture.points;
    const slim = full.map((p) => ({
      ...p,
      placement: slimPlacementForShare(p.placement, servesOnly),
    }));
    const collect = servesOnly
      ? collectServePlacementObservations
      : collectTrustedPlacementObservations;
    const args = {
      userSide: fixture.userSide,
      gameIndexByPoint: fixtureIndex,
      serving: fixtureServing,
    };
    const a = collect({ points: full, ...args });
    const b = collect({ points: slim, ...args });
    assert.ok(a.length >= (servesOnly ? 30 : 5), `fixture should draw maps, got ${a.length}`);
    assert.deepEqual(b, a);
  });
}

/* ------------------------------------------------- full synthetic record */

const PRE_PAD = 1;

/**
 * Twelve points, the uploader at the near end serving on even points,
 * the opponent on odd. Each carries a serve with both bounces, a short
 * rally, a last bounce on the loser's half, and the noise a real record
 * has: a net-band bounce, an off-table bounce, a bounce after the point
 * ended, out/impact/net candidates, and a contact right beside a bounce.
 */
function fullPoint(i: number): Point {
  const t0 = 100 + i * 10;
  const cutT0 = 50 + i * 10;
  const userServes = i % 2 === 0;
  const userWon = i % 3 !== 0;
  const serverSide = userServes ? "near" : "far";
  const loserSide = userWon ? "far" : "near";
  const dt = 0.25 + 0.05 * i;
  const ev = (id: string, u: number, v: number, t: number, extra: object = {}) => ({
    event_id: id,
    t,
    u,
    v,
    x: 300 + u * 100,
    y: 700 - v * 150,
    inferred: false,
    confidence: 0.85,
    ...extra,
  });
  const first = userServes ? [0.7, 0.6] : [0.8, 2.1];
  const landing = userServes ? [0.5 + 0.02 * i, 2.0 + 0.03 * i] : [0.6 + 0.02 * i, 0.5 + 0.03 * i];
  const last = loserSide === "far" ? [0.9, 2.4] : [0.4, 0.4];
  const candidates: PlacementCandidateV3[] = [
    { id: "c1", kind: "bounce", kinds: ["table_bounce", "audio"], t: t0 + 0.2, u: first[0], v: first[1], x: 310, y: 640, side: serverSide, visual_confidence: 0.9, audio_confidence: 0.4 },
    { id: "c2", kind: "bounce", kinds: ["table_bounce"], t: t0 + 0.2 + dt, u: landing[0], v: landing[1], x: 320, y: 420, visual_confidence: 0.9, audio_confidence: 0 },
    { id: "k1", kind: "contact", kinds: ["paddle_contact"], t: t0 + 0.9, u: null, v: null, x: 500, y: 300, visual_confidence: 0.7, audio_confidence: 0.9 },
    { id: "c3", kind: "bounce", kinds: ["table_bounce"], t: t0 + 1.2, u: 0.8, v: 2.3, x: 330, y: 400, visual_confidence: 0.8, audio_confidence: 0 },
    { id: "c4", kind: "bounce", kinds: ["table_bounce"], t: t0 + 2.0, u: 0.6, v: 0.5, x: 300, y: 650, visual_confidence: 0.8, audio_confidence: 0 },
    { id: "n1", kind: "bounce", kinds: ["table_bounce"], t: t0 + 2.5, u: 0.7, v: 1.37, x: 310, y: 520, visual_confidence: 0.6, audio_confidence: 0 },
    { id: "o1", kind: "bounce", kinds: ["table_bounce"], t: t0 + 2.7, u: -0.2, v: 0.4, x: 100, y: 660, visual_confidence: 0.5, audio_confidence: 0 },
    { id: "c5", kind: "bounce", kinds: ["table_bounce"], t: t0 + 3.0, u: last[0], v: last[1], x: 340, y: 380, visual_confidence: 0.9, audio_confidence: 0.2 },
    { id: "k2", kind: "contact", kinds: ["paddle_contact"], t: t0 + 3.25, u: null, v: null, x: 520, y: 310, visual_confidence: 0.4, audio_confidence: 0.6 },
    { id: "x1", kind: "out", kinds: ["out"], t: t0 + 3.4, u: null, v: null, x: 40, y: 40, visual_confidence: 0.5, audio_confidence: 0 },
    { id: "m1", kind: "impact", kinds: ["impact"], t: t0 + 3.5, u: 0.5, v: 0.5, x: 300, y: 650, visual_confidence: 0.5, audio_confidence: 0.5 },
    { id: "e1", kind: "net", kinds: ["net"], t: t0 + 3.6, u: 0.7, v: 1.37, visual_confidence: 0.5, audio_confidence: 0 },
    { id: "c6", kind: "bounce", kinds: ["table_bounce"], t: t0 + 7.0, u: 0.5, v: 0.5, x: 300, y: 650, visual_confidence: 0.9, audio_confidence: 0 },
  ];
  const shots: PlacementShotV3[] = [
    {
      id: "s1", seq: 1, phase: "serve", hitter_side: serverSide, contact_t: t0 + 0.05,
      contact: ev("k0", 0.5, serverSide === "near" ? -0.3 : 3.0, t0 + 0.05),
      serve_first_bounce: ev("c1", first[0], first[1], t0 + 0.2),
      landing: ev("c2", landing[0], landing[1], t0 + 0.2 + dt),
      terminal: null,
      confidence: 0.9,
    },
    {
      id: "s2", seq: 2, phase: "rally", hitter_side: serverSide === "near" ? "far" : "near", contact_t: t0 + 0.9,
      contact: ev("k1", 0.6, 3.1, t0 + 0.9), serve_first_bounce: null,
      landing: ev("c3", 0.8, 2.3, t0 + 1.2), terminal: null, confidence: 0.8,
    },
    {
      id: "s3", seq: 3, phase: "final", hitter_side: serverSide, contact_t: t0 + 1.7,
      contact: ev("k3", 0.7, -0.2, t0 + 1.7), serve_first_bounce: null,
      landing: ev("c5", last[0], last[1], t0 + 3.0),
      terminal: { ...ev("x1", 0.1, 3.2, t0 + 3.4), kind: "out", direction: { du: 0.1, dv: 0.9 } },
      confidence: 0.75,
    },
  ];
  const hypothesis = (side: "near" | "far", own: boolean): PlacementHypothesisV3 => ({
    serverSide: side,
    server_side: side,
    status: own ? "ready" : "unavailable",
    confidence: own ? 0.9 : 0.2,
    score: own ? 6.5 : -3,
    reasons: own ? ["serve_first_bounce_on_server_half", "rally_parity_ok"] : ["no_serve"],
    hard_reasons: own ? [] : ["serve_first_bounce_on_receiver_half"],
    shots: own ? shots : [],
    used_event_ids: own ? ["c1", "c2", "c3", "c5"] : [],
  });
  const placement: PlacementV3 = {
    v: 3,
    status: "ready",
    candidates,
    hypotheses: {
      near: hypothesis("near", serverSide === "near"),
      far: hypothesis("far", serverSide === "far"),
    },
  };
  return {
    id: `p${i}`,
    idx: i,
    deleted: false,
    is_let: false,
    confirmed_winner: userWon ? "user" : "opponent",
    placement,
    t0,
    t1: t0 + 6,
    cut_t0: cutT0,
    // Cut clock: source = t0 - PRE_PAD - cut_t0 + cut_s, so the point
    // ends at t0 + 3.3 on the source clock, after the last real bounce.
    rally_end_cut_s: cutT0 + PRE_PAD + 3.3,
    scored_at_cut_s: null,
    tight_start: false,
    tight_end: false,
  } as unknown as Point;
}

const synthetic: Point[] = Array.from({ length: 12 }, (_, i) => fullPoint(i));

function cardInputs(points: Point[]) {
  return {
    points,
    userSide: "near" as const,
    gameIndexByPoint: new Map(points.map((p) => [p.id, 0])),
    serving: new Map<string, ServeInfo>(
      points.map((p, i) => [
        p.id,
        { server: i % 2 === 0 ? "user" : "opponent", source: "rotation", isLet: false },
      ]),
    ),
    prePad: () => PRE_PAD,
    placementTrusted: true,
    gameFilter: null,
  };
}

test("the synthetic record is rich enough to fill every video card", () => {
  const result = computeScoredCards(cardInputs(synthetic));
  assert.ok(result);
  assert.equal(result.pointLength.covered, 12);
  assert.equal(result.serveSpeed.mine.length, 3);
  assert.equal(result.serveSpeed.theirs.length, 3);
  assert.ok(result.endings.shown, "endings card should show");
  assert.equal(result.endings.agreed, 12);
});

test("slim placement computes the same video cards as the full record", () => {
  const slim = synthetic.map((p) => ({
    ...p,
    placement: slimPlacementForShare(p.placement, true),
  }));
  assert.deepEqual(
    computeScoredCards(cardInputs(slim)),
    computeScoredCards(cardInputs(synthetic)),
  );
  for (const [i, p] of synthetic.entries()) {
    const end = (p.t0 as number) + 3.3;
    assert.deepEqual(
      lastCleanBounce(slim[i].placement as PlacementV3, end)?.id,
      lastCleanBounce(p.placement as PlacementV3, end)?.id,
    );
  }
});

for (const servesOnly of [true, false]) {
  test(`slim placement draws the same maps as the synthetic record (servesOnly=${servesOnly})`, () => {
    const slim = synthetic.map((p) => ({
      ...p,
      placement: slimPlacementForShare(p.placement, servesOnly),
    }));
    const collect = servesOnly
      ? collectServePlacementObservations
      : collectTrustedPlacementObservations;
    const { userSide, gameIndexByPoint, serving } = cardInputs(synthetic);
    const a = collect({ points: synthetic, userSide, gameIndexByPoint, serving });
    const b = collect({ points: slim, userSide, gameIndexByPoint, serving });
    assert.ok(a.length >= 12, `synthetic should draw maps, got ${a.length}`);
    assert.deepEqual(b, a);
  });
}

test("slim placement drops the pixels and the noise, and keeps the table", () => {
  const full = synthetic[0].placement as PlacementV3;
  const slim = slimPlacementForShare(full, true) as PlacementV3;
  assert.equal(slim.v, 3);
  for (const c of slim.candidates) {
    assert.ok(!("x" in c) && !("y" in c) && !("side" in c), "no pixels, no side");
    assert.ok(c.kind === "bounce" || c.kind === "contact");
  }
  assert.equal(slim.candidates.length, full.candidates.length - 3);
  assert.equal(slim.hypotheses.near.shots.length, 1, "serves only keeps the serve");
  assert.equal(slim.hypotheses.near.reasons.length, 0);
  assert.equal(slim.hypotheses.near.used_event_ids.length, 0);
  const serve = slim.hypotheses.near.shots[0];
  assert.equal(serve.contact, null);
  assert.equal(serve.terminal, null);
  assert.ok(!("x" in (serve.landing ?? {})));
  const bytes = (v: unknown) => JSON.stringify(v).length;
  assert.ok(bytes(slim) < bytes(full) * 0.6, `slim ${bytes(slim)} vs full ${bytes(full)}`);
  assert.equal(
    (slimPlacementForShare(full, false) as PlacementV3).hypotheses.near.shots.length,
    3,
    "every landing when rallies are shown",
  );
  assert.equal(slimPlacementForShare(null, true), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlacementHypothesisV3,
  PlacementV3,
} from "../types.ts";
import {
  buildPlacementRenderModel,
  selectPlacementHypothesis,
} from "./placementModel.ts";
import * as placementModel from "./placementModel.ts";


function landing(eventId: string, t: number, u: number, v: number) {
  return { event_id: eventId, t, u, v, confidence: 0.85 };
}

function hypothesis(
  serverSide: "near" | "far",
  confidence: number,
  shots: PlacementHypothesisV3["shots"],
  status: PlacementHypothesisV3["status"] = "ready",
): PlacementHypothesisV3 {
  return {
    serverSide,
    server_side: serverSide,
    status,
    confidence,
    score: 5,
    reasons: [],
    hard_reasons: [],
    shots,
    used_event_ids: [],
  };
}

const NEAR = hypothesis("near", 0.81, []);
const FAR = hypothesis("far", 0.88, []);
const PLACEMENT: PlacementV3 = {
  v: 3,
  status: "ready",
  candidates: [],
  hypotheses: { near: NEAR, far: FAR },
};

test("confirmed server selects the matching physical hypothesis", () => {
  assert.equal(selectPlacementHypothesis(PLACEMENT, "far")?.serverSide, "far");
});

test("unknown server does not guess when confidence margin is small", () => {
  const close: PlacementV3 = {
    ...PLACEMENT,
    hypotheses: {
      near: hypothesis("near", 0.78, []),
      far: hypothesis("far", 0.82, []),
    },
  };
  assert.equal(selectPlacementHypothesis(close, null), null);
});

test("non-serve first shot never receives a server origin", () => {
  const nonServe = hypothesis("near", 0.9, [
    {
      id: "shot-1",
      seq: 1,
      contact_t: null,
      phase: "rally",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: null,
      landing: landing("e1", 1, 0.6, 2.1),
      terminal: null,
      confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(nonServe, { through: null });
  assert.equal(model.segments[0].from, null);
});

test("a cutoff hides only later shots, so nothing is ever faint context", () => {
  const threeShots = hypothesis("near", 0.9, [
    {
      id: "shot-1",
      seq: 1,
      contact_t: null,
      phase: "serve",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: landing("s1", 0.8, 0.4, 0.5),
      landing: landing("s2", 1, 0.5, 2.2),
      terminal: null,
      confidence: 0.9,
    },
    {
      id: "shot-2",
      seq: 2,
      contact_t: null,
      phase: "rally",
      hitter_side: "far",
      contact: null,
      serve_first_bounce: null,
      landing: landing("r1", 1.4, 0.8, 0.6),
      terminal: null,
      confidence: 0.8,
    },
    {
      id: "shot-3",
      seq: 3,
      contact_t: null,
      phase: "rally",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: null,
      landing: landing("r2", 1.8, 1.1, 2.4),
      terminal: null,
      confidence: 0.8,
    },
  ]);
  // fromContext exists for a filter that could hide a shot in the MIDDLE
  // of a rally. A cumulative cutoff cannot: everything it removes comes
  // after everything it keeps, so each visible segment still follows a
  // visible one. The field stays — exclusive selection would need it
  // again — but under this filter it is always false.
  const all = buildPlacementRenderModel(threeShots, { through: null });
  assert.ok(all.segments.every((segment) => segment.fromContext === false));

  // Cutting the rally short keeps the earlier shots intact and connected.
  const firstTwo = buildPlacementRenderModel(threeShots, { through: 2 });
  assert.equal(firstTwo.segments.length, 2);
  assert.equal(firstTwo.shownCount, 2);
  assert.equal(firstTwo.totalCount, 3);
  assert.ok(firstTwo.segments.every((segment) => segment.fromContext === false));
  // Shot 2 starts where shot 1 CARRIED to — the far baseline — not where
  // it bounced. Nobody returns the ball from the bounce.
  assert.equal(firstTwo.segments[1].from?.v, 2.74);
});

test("the cutoff walks the rally forward and clamps at both ends", () => {
  const threeShots = hypothesis("near", 0.9, [
    {
      id: "shot-1", seq: 1, contact_t: null, phase: "serve",
      hitter_side: "near", contact: null,
      serve_first_bounce: landing("s1", 0.8, 0.4, 0.5),
      landing: landing("s2", 1, 0.5, 2.2), terminal: null, confidence: 0.9,
    },
    {
      id: "shot-2", seq: 2, contact_t: null, phase: "rally",
      hitter_side: "far", contact: null, serve_first_bounce: null,
      landing: landing("r1", 1.4, 0.8, 0.6), terminal: null, confidence: 0.8,
    },
    {
      id: "shot-3", seq: 3, contact_t: null, phase: "rally",
      hitter_side: "near", contact: null, serve_first_bounce: null,
      landing: landing("r2", 1.8, 1.1, 2.4), terminal: null, confidence: 0.8,
    },
  ]);

  // 1 is the serve on its own — the first step of the strip.
  assert.equal(buildPlacementRenderModel(threeShots, { through: 1 }).segments.length, 1);
  // null and a cutoff at the full length are the same picture, so "All"
  // and the last chip can never disagree about what they show.
  assert.deepEqual(
    buildPlacementRenderModel(threeShots, { through: 3 }).segments.length,
    buildPlacementRenderModel(threeShots, { through: null }).segments.length,
  );
  // The strip is built from totalCount, but a stale cutoff from a longer
  // rally must not throw or over-count.
  const past = buildPlacementRenderModel(threeShots, { through: 99 });
  assert.equal(past.shownCount, 3);
  assert.equal(past.totalCount, 3);
  // Zero and negatives draw nothing rather than wrapping around.
  assert.equal(buildPlacementRenderModel(threeShots, { through: 0 }).segments.length, 0);
  assert.equal(buildPlacementRenderModel(threeShots, { through: -2 }).shownCount, 0);
});



test("terminal out belongs to its hitter and starts where the ball carried", () => {
  const out = hypothesis("near", 0.9, [
    {
      id: "shot-1",
      seq: 1,
      contact_t: null,
      phase: "serve",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: landing("s1", 0.8, 0.4, 0.5),
      landing: landing("s2", 1, 0.5, 2.2),
      terminal: null,
      confidence: 0.9,
    },
    {
      id: "shot-2",
      seq: 2,
      contact_t: 1.2,
      phase: "rally",
      hitter_side: "far",
      contact: { event_id: "c1", t: 1.2, confidence: 0.8 },
      serve_first_bounce: null,
      landing: null,
      terminal: {
        event_id: null,
        t: 1.5,
        kind: "out",
        inferred: true,
        confidence: 0.68,
      },
      confidence: 0.68,
    },
  ]);
  const model = buildPlacementRenderModel(out, { through: null });
  const last = model.segments.at(-1);
  assert.equal(last?.terminal?.kind, "out");
  assert.equal(last?.hitterSide, "far");
  // Starts where the serve carried to, not where it bounced.
  assert.equal(last?.from?.v, 2.74);
  assert.equal(last?.to, null);
});

test("a bounce carries on to the receiver's baseline, and the serve back to the server's", () => {
  // Two measured bounces on one heading: first bounce on the server's own
  // half, then the landing. Everything else is that line extended.
  const rally = hypothesis("near", 0.9, [
    {
      id: "shot-1", seq: 1, contact_t: null, phase: "serve",
      hitter_side: "near", contact: null,
      serve_first_bounce: landing("s1", 0.8, 1.13, 0.86),
      landing: landing("s2", 1, 1.13, 1.91), terminal: null, confidence: 0.9,
    },
    {
      id: "shot-2", seq: 2, contact_t: null, phase: "rally",
      hitter_side: "far", contact: null, serve_first_bounce: null,
      landing: landing("r1", 1.4, 0.84, 1.18), terminal: null, confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(rally, { through: null });

  // The serve is struck from the server's baseline, on the line its two
  // bounces define — u stays 1.13 because this serve travelled straight.
  // The old code put every serve at the centre of the baseline (0.7625),
  // which on this serve is 37cm out.
  assert.equal(model.segments[0].from?.v, 0);
  assert.ok(Math.abs((model.segments[0].from?.u ?? 0) - 1.13) < 0.001);

  // It lands at 1.91 and carries on to the far baseline for the receiver.
  assert.deepEqual(model.segments[0].to, { u: 1.13, v: 1.91 });
  assert.equal(model.segments[0].carryTo?.v, 2.74);

  // The return therefore starts at the far baseline, not at 1.91.
  assert.equal(model.segments[1].from?.v, 2.74);
  // And carries back out to the near baseline, wide of where it bounced.
  assert.equal(model.segments[1].carryTo?.v, 0);
  assert.ok((model.segments[1].carryTo?.u ?? 1) < 0.84);
});

test("an extrapolation that lands off the table is refused, not clamped", () => {
  // Taken from a real point: two bounces only 0.42m apart in v, running
  // 1.1m back to the baseline. It passes the ratio guard at 2.6x and still
  // puts the serve's origin at u = 1.87 on a table 1.525 wide — a place
  // nobody could have struck the ball from. The map would clamp it to its
  // own margin and draw a confident line to a lie.
  const shallow = hypothesis("far", 0.71, [
    {
      id: "f1", seq: 1, contact_t: null, phase: "serve",
      hitter_side: "far", contact: null,
      serve_first_bounce: landing("b1", 0.9, 1.1, 1.645),
      landing: landing("b2", 0.9, 0.806, 1.227),
      terminal: null, confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(shallow, { through: null });
  // Falls back to the centre of the server's baseline rather than the
  // impossible point.
  assert.equal(model.segments[0].from?.v, 2.74);
  assert.ok(Math.abs((model.segments[0].from?.u ?? 0) - 1.525 / 2) < 0.001);
  // The measured first bounce is still exposed, so the serve has at least
  // one honest point on it.
  assert.deepEqual(model.segments[0].serveFirstBounce, { u: 1.1, v: 1.645 });
  // The carry off the other end was equally impossible, so it is dropped.
  assert.equal(model.segments[0].carryTo, null);
});

test("a bounce with no derivable heading falls back to joining bounces", () => {
  // 14% of real shots have no landing, so the chain breaks often. When it
  // does, the map must still draw something rather than losing the rally.
  const gap = hypothesis("near", 0.9, [
    {
      id: "shot-1", seq: 1, contact_t: null, phase: "serve",
      hitter_side: "near", contact: null, serve_first_bounce: null,
      landing: landing("s2", 1, 0.5, 2.2), terminal: null, confidence: 0.9,
    },
    {
      id: "shot-2", seq: 2, contact_t: null, phase: "rally",
      hitter_side: "far", contact: null, serve_first_bounce: null,
      landing: null, terminal: null, confidence: 0.5,
    },
    {
      id: "shot-3", seq: 3, contact_t: null, phase: "rally",
      hitter_side: "near", contact: null, serve_first_bounce: null,
      landing: landing("r2", 1.8, 1.1, 2.4), terminal: null, confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(gap, { through: null });
  // Serve with no first bounce still gets the centre-baseline origin.
  assert.equal(model.segments[0].from?.v, 0);
  // The shot after the gap joins back to the last KNOWN bounce rather than
  // vanishing — the pre-carry behaviour, kept as the fallback.
  const afterGap = model.segments.at(-1);
  assert.deepEqual(afterGap?.from, { u: 0.5, v: 2.2 });
});

test("the caption counts shots shown against shots played", () => {
  const shots = hypothesis("near", 0.9, [
    {
      id: "shot-1",
      seq: 1,
      contact_t: null,
      phase: "serve",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: landing("s1", 0.8, 0.4, 0.5),
      landing: landing("s2", 1, 0.5, 2.2),
      terminal: null,
      confidence: 0.9,
    },
    {
      id: "shot-2",
      seq: 2,
      contact_t: null,
      phase: "rally",
      hitter_side: "far",
      contact: null,
      serve_first_bounce: null,
      landing: landing("r1", 1.4, 0.8, 0.6),
      terminal: null,
      confidence: 0.8,
    },
    {
      id: "shot-3",
      seq: 3,
      contact_t: null,
      phase: "rally",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: null,
      landing: landing("r2", 1.8, 1.1, 2.4),
      terminal: null,
      confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(shots, { through: 1 });
    assert.equal(model.shownCount, 1);
  assert.ok(model.totalCount >= model.shownCount);
});

test("hard-invalid confirmed hypothesis explains review but renders no path", () => {
  const hardInvalid = {
    ...hypothesis("near", 0.88, [
      {
        id: "shot-1",
        seq: 1,
        contact_t: null,
        phase: "serve" as const,
        hitter_side: "near" as const,
        contact: null,
        serve_first_bounce: landing("s1", 0.8, 0.4, 2.2),
        landing: landing("s2", 1, 0.5, 0.6),
        terminal: null,
        confidence: 0.2,
      },
    ], "review"),
    hard_reasons: ["serve_second_bounce_on_server_half"],
    reasons: ["serve_second_bounce_on_server_half"],
  };
  const model = buildPlacementRenderModel(hardInvalid, { through: null });
  assert.equal(model.status, "review");
  assert.equal(model.segments.length, 0);
});

test("unknown server never auto-selects a hard-invalid hypothesis", () => {
  const hard = {
    ...hypothesis("near", 0.95, [], "review"),
    hard_reasons: ["landing_on_hitter_half"],
    reasons: ["landing_on_hitter_half"],
  };
  const safe = hypothesis("far", 0.7, [], "review");
  const placement: PlacementV3 = {
    ...PLACEMENT,
    status: "review",
    hypotheses: { near: hard, far: safe },
  };
  assert.equal(selectPlacementHypothesis(placement, null)?.serverSide, "far");
});

test("placement uncertainty notices stay concise and match suppression", () => {
  const exported = Reflect.get(placementModel, "placementNotice");
  assert.equal(typeof exported, "function");
  const placementNotice = exported as (
    value: PlacementHypothesisV3,
  ) => { mode: "hidden" | "review"; message: string } | null;

  assert.equal(placementNotice(hypothesis("near", 0.9, [])), null);
  assert.deepEqual(
    placementNotice(hypothesis("near", 0.6, [], "review")),
    {
      mode: "review",
      message:
        "This placement map may be less accurate because the ball path was difficult to track.",
    },
  );
  assert.deepEqual(
    placementNotice(hypothesis("near", 0.2, [], "unavailable")),
    {
      mode: "hidden",
      message:
        "A placement map couldn’t be generated for this point because the ball path was difficult to track.",
    },
  );
  assert.deepEqual(
    placementNotice({
      ...hypothesis("near", 0.8, [], "review"),
      hard_reasons: ["serve_second_bounce_on_server_half"],
    }),
    {
      mode: "hidden",
      message:
        "A placement map couldn’t be generated for this point because the ball path was difficult to track.",
    },
  );
});

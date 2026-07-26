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


function landing(eventId: string, t: number, u: number, v: number) {
  return { event_id: eventId, t, u, v };
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
      phase: "rally",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: null,
      landing: landing("e1", 1, 0.6, 2.1),
      terminal: null,
      confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(nonServe, {
    serve: true,
    rally: true,
    final: true,
  });
  assert.equal(model.segments[0].from, null);
});

test("filtered prior shot is retained as faint context", () => {
  const threeShots = hypothesis("near", 0.9, [
    {
      id: "shot-1",
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
      phase: "rally",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: null,
      landing: landing("r2", 1.8, 1.1, 2.4),
      terminal: null,
      confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(threeShots, {
    serve: false,
    rally: false,
    final: true,
  });
  assert.equal(model.segments.at(-1)?.fromContext, true);
});

test("terminal out belongs to its hitter and starts at the prior landing", () => {
  const out = hypothesis("near", 0.9, [
    {
      id: "shot-1",
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
      phase: "rally",
      hitter_side: "far",
      contact: { event_id: "c1", t: 1.2 },
      serve_first_bounce: null,
      landing: null,
      terminal: {
        event_id: null,
        t: 1.5,
        kind: "out",
        inferred: true,
      },
      confidence: 0.68,
    },
  ]);
  const model = buildPlacementRenderModel(out, {
    serve: true,
    rally: true,
    final: true,
  });
  const last = model.segments.at(-1);
  assert.equal(last?.terminal?.kind, "out");
  assert.equal(last?.hitterSide, "far");
  assert.deepEqual(last?.from, { u: 0.5, v: 2.2 });
  assert.equal(last?.to, null);
});

test("hidden counts expose filtered rally context", () => {
  const shots = hypothesis("near", 0.9, [
    {
      id: "shot-1",
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
      phase: "rally",
      hitter_side: "near",
      contact: null,
      serve_first_bounce: null,
      landing: landing("r2", 1.8, 1.1, 2.4),
      terminal: null,
      confidence: 0.8,
    },
  ]);
  const model = buildPlacementRenderModel(shots, {
    serve: true,
    rally: false,
    final: true,
  });
  assert.equal(model.hiddenCounts.rally, 1);
});

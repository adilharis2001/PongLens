import assert from "node:assert/strict";
import test from "node:test";
import type {
  PlacementEventV3,
  PlacementHypothesisV3,
  PlacementShotV3,
  PlacementV3,
  Point,
} from "../types.ts";
import {
  classifyPlacementZone,
  collectTrustedPlacementObservations,
  normalizePlacementCoordinates,
  placementZoneCounts,
  trustedPlacementPointCount,
} from "./placementAggregate.ts";

type Side = "near" | "far";
type Server = "user" | "opponent";

function event(
  u: number,
  v: number,
  confidence = 0.9,
): PlacementEventV3 {
  return {
    event_id: `event-${u}-${v}-${confidence}`,
    u,
    v,
    confidence,
  };
}

function shot({
  seq,
  phase,
  hitter,
  landing,
  firstBounce = null,
  confidence = 0.9,
}: {
  seq: number;
  phase: PlacementShotV3["phase"];
  hitter: Side;
  landing: PlacementEventV3 | null;
  firstBounce?: PlacementEventV3 | null;
  confidence?: number;
}): PlacementShotV3 {
  return {
    id: `shot-${seq}`,
    seq,
    phase,
    hitter_side: hitter,
    contact_t: null,
    contact: null,
    serve_first_bounce: firstBounce,
    landing,
    terminal: null,
    confidence,
  };
}

function hypothesis({
  serverSide,
  shots,
  status = "ready",
  confidence = 0.9,
  hardReasons = [],
}: {
  serverSide: Side;
  shots: PlacementShotV3[];
  status?: PlacementHypothesisV3["status"];
  confidence?: number;
  hardReasons?: string[];
}): PlacementHypothesisV3 {
  return {
    serverSide,
    server_side: serverSide,
    status,
    confidence,
    score: confidence,
    reasons: [],
    hard_reasons: hardReasons,
    shots,
    used_event_ids: [],
  };
}

function placement(
  selected: PlacementHypothesisV3,
): PlacementV3 {
  const unavailable = (serverSide: Side): PlacementHypothesisV3 =>
    hypothesis({
      serverSide,
      status: "unavailable",
      confidence: 0,
      hardReasons: ["fixture_unavailable"],
      shots: [],
    });
  return {
    v: 3,
    status: selected.status,
    candidates: [],
    hypotheses: {
      near:
        selected.server_side === "near"
          ? selected
          : unavailable("near"),
      far:
        selected.server_side === "far"
          ? selected
          : unavailable("far"),
    },
  };
}

function point(
  id: string,
  selected: PlacementHypothesisV3,
  deleted = false,
): Point {
  return {
    id,
    placement: placement(selected),
    deleted,
  } as Point;
}

function collect({
  points,
  userSide = "near",
  games = {},
  servers = {},
}: {
  points: Point[];
  userSide?: Side | null;
  games?: Record<string, number>;
  servers?: Record<string, Server | null>;
}) {
  return collectTrustedPlacementObservations({
    points,
    userSide,
    gameIndexByPoint: new Map(Object.entries(games)),
    serving: new Map(
      Object.entries(servers).map(([id, server]) => [
        id,
        { server },
      ]),
    ),
  });
}

test("normalization puts each player's own end at the bottom", () => {
  // A smoke test, and worth knowing what it is NOT. Written the other way
  // round it passed for months while every map in the app was mirrored,
  // because asserting the numbers the function returns cannot catch the
  // function returning the wrong ones. tableOrientation.test.ts is the test
  // that governs left and right; it works them out from real bounces that
  // carry both a pixel and a table coordinate.
  const near = normalizePlacementCoordinates(0.1, 2.6, "near");
  assert.ok(Math.abs(near.u - 0.1) < 1e-9);
  assert.ok(Math.abs(near.v - 2.6) < 1e-9);

  const far = normalizePlacementCoordinates(0.1, 2.6, "far");
  assert.ok(Math.abs(far.u - 1.425) < 1e-9);
  assert.ok(Math.abs(far.v - 0.14) < 1e-9);
});

test("zones use user-relative lateral thirds and receiver-relative depth", () => {
  assert.equal(
    classifyPlacementZone(0.1, 2.6, "myServes"),
    "deep_left",
  );
  assert.equal(
    classifyPlacementZone(1.42, 0.1, "theirServes"),
    "deep_right",
  );
  assert.equal(
    classifyPlacementZone(0.76, 1.52, "myRally"),
    "short_middle",
  );
  assert.equal(
    classifyPlacementZone(0.76, 1.22, "theirRally"),
    "short_middle",
  );
});

test("collector separates second-bounce serves and rally shots after an end change", () => {
  const gameOne = point(
    "game-one",
    hypothesis({
      serverSide: "near",
      shots: [
        shot({
          seq: 1,
          phase: "serve",
          hitter: "near",
          firstBounce: event(1.1, 0.3),
          landing: event(0.5, 2.5),
        }),
        shot({
          seq: 2,
          phase: "rally",
          hitter: "far",
          landing: event(1.0, 0.5),
        }),
      ],
    }),
  );
  const gameTwo = point(
    "game-two",
    hypothesis({
      serverSide: "near",
      shots: [
        shot({
          seq: 1,
          phase: "serve",
          hitter: "near",
          firstBounce: event(0.8, 0.4),
          landing: event(0.2, 2.3),
        }),
        shot({
          seq: 2,
          phase: "rally",
          hitter: "far",
          landing: event(0.4, 0.4),
        }),
      ],
    }),
  );

  const observations = collect({
    points: [gameOne, gameTwo],
    userSide: "near",
    games: { "game-one": 0, "game-two": 1 },
    servers: {
      "game-one": "user",
      "game-two": "opponent",
    },
  });

  assert.deepEqual(
    observations.map((observation) => observation.filter),
    ["myServes", "theirRally", "theirServes", "myRally"],
  );
  assert.equal(observations.some((item) => item.v === 0.3), false);
  assert.equal(
    observations.some((item) => Math.abs(item.v - 2.34) < 1e-9),
    true,
  );
  assert.equal(trustedPlacementPointCount(observations), 2);
});

test("collector accepts the 70 percent boundary and rejects every stale identity", () => {
  const readyShot = (id: string, options: {
    hypothesisConfidence?: number;
    shotConfidence?: number;
    landingConfidence?: number;
    status?: PlacementHypothesisV3["status"];
    hardReasons?: string[];
    hitter?: Side;
    deleted?: boolean;
  }) =>
    point(
      id,
      hypothesis({
        serverSide: "near",
        confidence: options.hypothesisConfidence ?? 0.9,
        status: options.status ?? "ready",
        hardReasons: options.hardReasons ?? [],
        shots: [
          shot({
            seq: 1,
            phase: "serve",
            hitter: options.hitter ?? "near",
            confidence: options.shotConfidence ?? 0.9,
            landing: event(
              0.4,
              2.4,
              options.landingConfidence ?? 0.9,
            ),
          }),
        ],
      }),
      options.deleted ?? false,
    );

  const points = [
    readyShot("threshold", {
      hypothesisConfidence: 0.7,
      shotConfidence: 0.7,
      landingConfidence: 0.7,
    }),
    readyShot("low-hypothesis", { hypothesisConfidence: 0.69 }),
    readyShot("low-shot", { shotConfidence: 0.69 }),
    readyShot("low-landing", { landingConfidence: 0.69 }),
    readyShot("review", { status: "review" }),
    readyShot("hard", { hardReasons: ["contradiction"] }),
    readyShot("wrong-owner", { hitter: "far" }),
    readyShot("deleted", { deleted: true }),
    point(
      "off-table",
      hypothesis({
        serverSide: "near",
        shots: [
          shot({
            seq: 1,
            phase: "serve",
            hitter: "near",
            landing: event(-0.01, 2.4),
          }),
        ],
      }),
    ),
  ];
  const servers = Object.fromEntries(
    points.map((candidate) => [candidate.id, "user" as const]),
  );

  const observations = collect({ points, servers });

  assert.deepEqual(
    observations.map((observation) => observation.pointId),
    ["threshold"],
  );
  assert.equal(collect({ points, servers, userSide: null }).length, 0);
});

test("zone counts include every empty cell and only the selected filter", () => {
  const observations = [
    {
      pointId: "one",
      shotSeq: 1,
      filter: "myServes" as const,
      zone: "deep_left" as const,
      u: 0.1,
      v: 2.6,
      confidence: 0.9,
    },
    {
      pointId: "two",
      shotSeq: 1,
      filter: "myServes" as const,
      zone: "deep_left" as const,
      u: 0.2,
      v: 2.5,
      confidence: 0.8,
    },
    {
      pointId: "three",
      shotSeq: 1,
      filter: "myServes" as const,
      zone: "medium_middle" as const,
      u: 0.76,
      v: 2.0,
      confidence: 0.7,
    },
    {
      pointId: "other-filter",
      shotSeq: 1,
      filter: "theirServes" as const,
      zone: "short_right" as const,
      u: 1.4,
      v: 1.3,
      confidence: 0.9,
    },
  ];

  assert.deepEqual(
    placementZoneCounts(observations, "myServes"),
    {
      short_left: 0,
      short_middle: 0,
      short_right: 0,
      medium_left: 0,
      medium_middle: 1,
      medium_right: 0,
      deep_left: 2,
      deep_middle: 0,
      deep_right: 0,
    },
  );
});

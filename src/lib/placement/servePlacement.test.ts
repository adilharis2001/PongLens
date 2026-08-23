import assert from "node:assert/strict";
import test from "node:test";
import type {
  PlacementCandidateV3,
  PlacementEventV3,
  PlacementHypothesisV3,
  PlacementShotV3,
  PlacementV3,
  Point,
} from "../types.ts";
import {
  collectServePlacementObservations,
  trustedPlacementPointCount,
} from "./placementAggregate.ts";

type Side = "near" | "far";
type Server = "user" | "opponent";

/**
 * A point whose bounces are declared in time order, so a fixture reads
 * the way the rule does: "the ball touched here, then here".
 *
 * Every bounce becomes a candidate AND is addressable by name, because
 * the whole of condition 5 is about which bounce a landing is.
 */
class Bounces {
  readonly candidates: PlacementCandidateV3[] = [];
  private t = 10;

  /** A bounce on the table. Returns the event a shot would point at. */
  add(name: string, u: number | null, v: number | null): PlacementEventV3 {
    this.t += 0.4;
    this.candidates.push({
      id: name,
      kind: "bounce",
      kinds: ["table_bounce"],
      t: this.t,
      u,
      v,
      x: null,
      y: null,
      visual_confidence: 0.9,
      audio_confidence: 0,
    });
    return {
      event_id: name,
      u: u ?? undefined,
      v: v ?? undefined,
      confidence: 0.9,
    };
  }

  /** A racket contact, which the serve rule deliberately ignores. */
  contact(name: string, side: Side) {
    this.t += 0.1;
    this.candidates.push({
      id: name,
      kind: "contact",
      kinds: ["paddle_contact"],
      t: this.t,
      u: null,
      v: null,
      x: null,
      y: null,
      side,
      visual_confidence: 0.9,
      audio_confidence: 0,
    });
  }
}

function shot({
  seq = 1,
  phase = "serve",
  hitter,
  landing,
  firstBounce = null,
  confidence = 0.9,
}: {
  seq?: number;
  phase?: PlacementShotV3["phase"];
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

/** Every rally veto the reconstruction can raise, all at once. */
const ELEVEN_RALLY_REASONS = [
  "serve_incomplete",
  "terminal_observation_missing",
  "contact_inferred_from_audio",
  "contact_too_close_after_landing",
  "landing_missing_before_contact",
  "contact_missing_before_landing",
  "terminal_inferred_from_suggestion",
  "later_evidence_after_terminal",
  "non_alternating_contacts",
  "unexpected_hitter",
  "landing_on_hitter_half",
];

function point({
  id = "point-1",
  serverSide,
  shots,
  candidates,
  status = "review",
  confidence = 0.2,
  hardReasons = [],
  deleted = false,
}: {
  id?: string;
  serverSide: Side;
  shots: PlacementShotV3[];
  candidates: PlacementCandidateV3[];
  status?: PlacementHypothesisV3["status"];
  confidence?: number;
  hardReasons?: string[];
  deleted?: boolean;
}): Point {
  const build = (
    side: Side,
    own: boolean,
  ): PlacementHypothesisV3 => ({
    serverSide: side,
    server_side: side,
    status: own ? status : "unavailable",
    confidence: own ? confidence : 0,
    score: 0,
    reasons: [],
    hard_reasons: own ? hardReasons : ["fixture_unavailable"],
    shots: own ? shots : [],
    used_event_ids: [],
  });
  const placement: PlacementV3 = {
    v: 3,
    status,
    candidates,
    hypotheses: {
      near: build("near", serverSide === "near"),
      far: build("far", serverSide === "far"),
    },
  };
  return { id, placement, deleted } as Point;
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
  return collectServePlacementObservations({
    points,
    userSide,
    gameIndexByPoint: new Map(Object.entries(games)),
    serving: new Map(
      Object.entries(servers).map(([id, server]) => [id, { server }]),
    ),
  });
}

/**
 * The textbook serve this file varies one thing at a time from.
 *
 * The user is at the near end and serves. The ball bounces on their own
 * half (v = 0.4, near) and then on the receiver's (v = 2.3, far). Nothing
 * else has touched the table.
 */
function textbookServe(overrides: {
  firstBounceV?: number | null;
  landingU?: number;
  landingV?: number;
  extraBouncesBefore?: number;
  bounceBetween?: boolean;
  landingDetected?: boolean;
  status?: PlacementHypothesisV3["status"];
  confidence?: number;
  hardReasons?: string[];
  serverSide?: Side;
} = {}) {
  const {
    firstBounceV = 0.4,
    landingU = 0.6,
    landingV = 2.3,
    extraBouncesBefore = 0,
    bounceBetween = false,
    landingDetected = true,
    serverSide = "near",
  } = overrides;

  const bounces = new Bounces();
  for (let i = 0; i < extraBouncesBefore; i += 1) {
    bounces.add(`before-${i}`, 0.7, 0.3);
  }
  const first =
    firstBounceV === null ? null : bounces.add("first", 0.9, firstBounceV);
  if (bounceBetween) bounces.add("between", 1.1, 1.0);
  const landing = landingDetected
    ? bounces.add("landing", landingU, landingV)
    : { event_id: null, u: landingU, v: landingV, confidence: 0.9 };

  return point({
    serverSide,
    candidates: bounces.candidates,
    status: overrides.status,
    confidence: overrides.confidence,
    hardReasons: overrides.hardReasons,
    shots: [shot({ hitter: serverSide, firstBounce: first, landing })],
  });
}

const SERVING = { "point-1": "user" as Server };

test("the textbook serve is drawn", () => {
  const observations = collect({
    points: [textbookServe()],
    servers: SERVING,
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].filter, "myServes");
  // The user is near, so normalization mirrors u and leaves v alone.
  assert.ok(Math.abs(observations[0].u - (1.525 - 0.6)) < 1e-9);
  assert.ok(Math.abs(observations[0].v - 2.3) < 1e-9);
});

test("1: a point with no server in the rotation is not drawn", () => {
  assert.equal(
    collect({ points: [textbookServe()], servers: { "point-1": null } })
      .length,
    0,
  );
  // Nor when the point is missing from the map entirely.
  assert.equal(collect({ points: [textbookServe()] }).length, 0);
});

test("2: a serve with no measured landing is not drawn", () => {
  const bounces = new Bounces();
  const first = bounces.add("first", 0.9, 0.4);
  const noCoordinates = bounces.add("landing", null, null);
  const observations = collect({
    points: [
      point({
        serverSide: "near",
        candidates: bounces.candidates,
        shots: [
          shot({ hitter: "near", firstBounce: first, landing: noCoordinates }),
        ],
      }),
    ],
    servers: SERVING,
  });
  assert.equal(observations.length, 0);

  // And a serve shot with no landing at all.
  const bare = new Bounces();
  const only = bare.add("first", 0.9, 0.4);
  assert.equal(
    collect({
      points: [
        point({
          serverSide: "near",
          candidates: bare.candidates,
          shots: [shot({ hitter: "near", firstBounce: only, landing: null })],
        }),
      ],
      servers: SERVING,
    }).length,
    0,
  );
});

test("3: a serve landing on the SERVER's own half is not drawn", () => {
  // The single geometric fact a serve cannot break. If this is drawn, the
  // map is showing the ball on the wrong side of the net.
  assert.equal(
    collect({
      points: [textbookServe({ landingV: 1.2 })],
      servers: SERVING,
    }).length,
    0,
  );
});

test("4: a landing that projects off the table is not drawn", () => {
  for (const [u, v] of [[-0.05, 2.3], [1.6, 2.3], [0.6, 2.9], [0.6, -0.1]]) {
    assert.equal(
      collect({
        points: [textbookServe({ landingU: u, landingV: v })],
        servers: SERVING,
      }).length,
      0,
      `expected (${u}, ${v}) to be refused`,
    );
  }
});

test("5: a bounce between the serve's two touches is not a serve", () => {
  // Server's half, something else, receiver's half. A serve cannot do
  // that; a rally exchange can, which is the whole point of the rule.
  assert.equal(
    collect({
      points: [textbookServe({ bounceBetween: true })],
      servers: SERVING,
    }).length,
    0,
  );
});

test("5: bounces BEFORE the serve do not disqualify it", () => {
  // Clips open before the serve. The server bounces the ball on the table
  // a few times, and the pad on the front often carries the tail of the
  // previous rally. Counting from the start of the point instead of from
  // the serve's own bounce threw away 18 textbook serves on one match.
  for (const before of [1, 2, 5]) {
    const observations = collect({
      points: [textbookServe({ extraBouncesBefore: before })],
      servers: SERVING,
    });
    assert.equal(observations.length, 1, `${before} earlier bounces`);
  }
});

test("5: with no first bounce the landing must be early in the point", () => {
  // Nothing to be consecutive to, so the ordinal is the only guard left.
  assert.equal(
    collect({
      points: [textbookServe({ firstBounceV: null })],
      servers: SERVING,
    }).length,
    1,
  );
  assert.equal(
    collect({
      points: [textbookServe({ firstBounceV: null, extraBouncesBefore: 2 })],
      servers: SERVING,
    }).length,
    0,
  );
});

test("6: a first bounce on the RECEIVER's half is not a serve", () => {
  // The independent read of who served. If first_server is wrong, every
  // serve in the match flips to the wrong player at once, and a
  // systematic error reads as a finding rather than as a bug.
  assert.equal(
    collect({
      points: [textbookServe({ firstBounceV: 2.4 })],
      servers: SERVING,
    }).length,
    0,
  );
});

test("every rally veto at once still yields the serve", () => {
  // The eleven questions keep running and keep being stored. They are the
  // raw material for a point-winner detector. They no longer decide
  // whether a map is drawn.
  const observations = collect({
    points: [
      textbookServe({
        status: "unavailable",
        confidence: 0.05,
        hardReasons: ELEVEN_RALLY_REASONS,
      }),
    ],
    servers: SERVING,
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].filter, "myServes");
});

test("flipping who served first flips every serve's owner", () => {
  // The systematic failure. Nothing on screen would say the map had
  // swapped players, so this is pinned rather than trusted.
  const serve = () =>
    textbookServe({ firstBounceV: 0.4, landingV: 2.3, serverSide: "near" });

  const asUser = collect({ points: [serve()], servers: SERVING });
  assert.deepEqual(asUser.map((o) => o.filter), ["myServes"]);

  // Same footage, opposite answer: the rotation now says the opponent
  // served, so the near-end hypothesis is no longer the one consulted and
  // its geometry no longer describes a legal serve.
  const asOpponent = collect({
    points: [serve()],
    servers: { "point-1": "opponent" },
  });
  assert.deepEqual(asOpponent.map((o) => o.filter), []);

  // With the footage mirrored to match, the same serve is drawn as
  // theirs, on the user's own half.
  const theirs = collect({
    points: [
      textbookServe({ serverSide: "far", firstBounceV: 2.4, landingV: 0.4 }),
    ],
    servers: { "point-1": "opponent" },
  });
  assert.deepEqual(theirs.map((o) => o.filter), ["theirServes"]);
});

test("an untagged side draws nothing at all", () => {
  assert.equal(
    collect({ points: [textbookServe()], userSide: null, servers: SERVING })
      .length,
    0,
  );
});

test("ends change between games and the serve follows", () => {
  // Game two puts the user at the far end, so the same physical serve
  // belongs to the other player.
  const observations = collect({
    points: [textbookServe()],
    userSide: "near",
    games: { "point-1": 1 },
    servers: { "point-1": "opponent" },
  });
  assert.deepEqual(observations.map((o) => o.filter), ["theirServes"]);
});

test("a deleted point contributes nothing", () => {
  const live = textbookServe();
  const gone = { ...live, deleted: true } as Point;
  assert.equal(collect({ points: [gone], servers: SERVING }).length, 0);
  assert.equal(
    trustedPlacementPointCount(collect({ points: [live], servers: SERVING })),
    1,
  );
});

test("one serve per point, never two", () => {
  // The old collector emitted every landing in the rally. This one draws
  // the serve, so the point count and the landing count agree.
  const bounces = new Bounces();
  const first = bounces.add("first", 0.9, 0.4);
  const landing = bounces.add("landing", 0.6, 2.3);
  bounces.contact("c1", "far");
  const rally = bounces.add("rally", 0.5, 0.5);
  const observations = collect({
    points: [
      point({
        serverSide: "near",
        candidates: bounces.candidates,
        shots: [
          shot({ hitter: "near", firstBounce: first, landing }),
          shot({ seq: 2, phase: "rally", hitter: "far", landing: rally }),
        ],
      }),
    ],
    servers: SERVING,
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].shotSeq, 1);
});

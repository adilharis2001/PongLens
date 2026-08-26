import assert from "node:assert/strict";
import test from "node:test";

import type {
  Match,
  MatchStructureEvidence,
  Point,
} from "../../../lib/types.ts";
import {
  gameEndIndicatorsEligible,
  resolveDetectedGameEnds,
  resolveFirstServer,
  resolveMatchBoundaries,
  userConfirmedFirstServer,
  userFirstServerUpdate,
} from "./matchStructure.ts";

function evidenceWithFirstServer(
  side: "near" | "far"
): MatchStructureEvidence {
  return {
    version: 1,
    status: "ready",
    algorithm: "rtmpose-match-structure-v1",
    first_server: { status: "high_confidence", side },
    end_changes: [],
    coverage: {
      total: 25,
      high_confidence: 24,
      needs_review: 1,
      unavailable: 0,
    },
  };
}

function evidenceWithChange(
  after: string,
  before: string,
  confirmed: string
): MatchStructureEvidence {
  return {
    ...evidenceWithFirstServer("near"),
    end_changes: [
      {
        after_point_id: after,
        before_point_id: before,
        confirmed_at_point_id: confirmed,
        after_idx: Number(after.slice(1)),
        before_idx: Number(before.slice(1)),
        confirmed_at_idx: Number(confirmed.slice(1)),
        old_state: "direct",
        new_state: "swapped",
        confirmations: 2,
        kind: "end_change",
      },
    ],
  };
}

function point(id: string, winner: "user" | "opponent"): Point {
  return {
    id,
    idx: Number(id.slice(1)),
    confirmed_winner: winner,
    is_let: false,
    deleted: false,
    game_end_override: null,
  } as Point;
}

function pointsWithScoreBoundaryAt(boundaryId: string): Point[] {
  const boundary = Number(boundaryId.slice(1));
  const points: Point[] = [];
  // Hand-derived game: alternate until the opponent reaches boundary - 11,
  // then give the user the remaining points. That makes p18 exactly 11-7
  // and p20 exactly 11-9 without an earlier legal game score.
  const opponentPoints = boundary - 11;
  const firstGameWinners: ("user" | "opponent")[] = [];
  for (let i = 0; i < opponentPoints; i += 1) {
    firstGameWinners.push("user", "opponent");
  }
  while (firstGameWinners.length < boundary) firstGameWinners.push("user");
  for (let i = 1; i <= 25; i += 1) {
    const winner = i <= boundary
      ? firstGameWinners[i - 1]
      : i % 2 === 0
        ? "opponent"
        : "user";
    points.push(point(`p${i}`, winner));
  }
  return points;
}

test("user first server outranks opposite detection", () => {
  const result = resolveFirstServer(
    {
      first_server: "opponent",
      first_server_source: "user",
      user_side: "near",
      match_structure: evidenceWithFirstServer("near"),
    } as Pick<
      Match,
      "first_server" | "first_server_source" | "user_side" | "match_structure"
    >,
    true
  );
  assert.deepEqual(result, { server: "opponent", source: "user" });
});

test("high-confidence near maps through a far user side", () => {
  const result = resolveFirstServer(
    {
      first_server: null,
      first_server_source: null,
      user_side: "far",
      match_structure: evidenceWithFirstServer("near"),
    } as Pick<
      Match,
      "first_server" | "first_server_source" | "user_side" | "match_structure"
    >,
    true
  );
  assert.deepEqual(result, { server: "opponent", source: "detected" });
});

test("manual scoring ignores a detector-authored first server", () => {
  assert.equal(
    userConfirmedFirstServer({
      first_server: "user",
      first_server_source: "detected",
    }),
    null
  );
  assert.equal(
    userConfirmedFirstServer({
      first_server: "opponent",
      first_server_source: "user",
    }),
    "opponent"
  );
});

test("manual first-server answers become user authoritative", () => {
  assert.deepEqual(userFirstServerUpdate("opponent"), {
    first_server: "opponent",
    first_server_source: "user",
  });
});

test("detected exact boundary suppresses an earlier score boundary", () => {
  const result = resolveMatchBoundaries(
    pointsWithScoreBoundaryAt("p18"),
    evidenceWithChange("p20", "p21", "p22"),
    true
  );
  assert.equal(result.effectiveOverrides.get("p18"), "continue");
  assert.equal(result.effectiveOverrides.get("p20"), "end");
  assert.equal(result.provenance.get("p20"), "detected");
});

test("score boundary inside a bracket resolves without moving", () => {
  const result = resolveMatchBoundaries(
    pointsWithScoreBoundaryAt("p20"),
    evidenceWithChange("p19", "p21", "p22"),
    true
  );
  assert.equal(result.effectiveOverrides.size, 0);
  assert.equal(result.provenance.get("p20"), "score-confirmed");
});

test("explicit user end wins over detected boundary", () => {
  const points = pointsWithScoreBoundaryAt("p18");
  points.find((candidate) => candidate.id === "p19")!.game_end_override = "end";
  const result = resolveMatchBoundaries(
    points,
    evidenceWithChange("p20", "p21", "p22"),
    true
  );
  assert.equal(result.effectiveOverrides.get("p19"), undefined);
  assert.equal(result.boundaryAfter.has("p19"), true);
});

test("low coverage withholds boundary application", () => {
  const evidence = evidenceWithChange("p20", "p21", "p22");
  evidence.coverage = {
    total: 25,
    high_confidence: 10,
    needs_review: 10,
    unavailable: 5,
  };
  const result = resolveMatchBoundaries(
    pointsWithScoreBoundaryAt("p18"),
    evidence,
    true
  );
  assert.equal(result.effectiveOverrides.size, 0);
  assert.equal(result.unresolved.length, 1);
});

// ---------------------------------------------------------------------------
// v2: side-change-v2 game-end indicators (migration 140)
// ---------------------------------------------------------------------------

function v2Evidence(
  changes: Partial<
    NonNullable<MatchStructureEvidence["side_changes"]>[number]
  >[]
): MatchStructureEvidence {
  return {
    version: 2,
    status: "ready",
    algorithm: "side-change-v2",
    side_changes: changes.map((change, i) => ({
      kind: "side_change" as const,
      after_idx: i,
      before_idx: i + 1,
      confidence: 1,
      confirmed: true,
      ...change,
    })),
  };
}

function timedPoint(id: string, t0: number, t1: number): Point {
  return {
    id,
    idx: Number(id.slice(1)),
    t0,
    t1,
    confirmed_winner: null,
    is_let: false,
    deleted: false,
    game_end_override: null,
  } as Point;
}

const FOUR_POINTS = [
  timedPoint("p1", 0, 5),
  timedPoint("p2", 10, 15),
  timedPoint("p3", 40, 45),
  timedPoint("p4", 50, 55),
];

test("eligibility: flag, competitive type, and unscored all required", () => {
  const unscored = FOUR_POINTS;
  assert.equal(gameEndIndicatorsEligible("match", unscored, true), true);
  assert.equal(gameEndIndicatorsEligible("league", unscored, true), true);
  assert.equal(gameEndIndicatorsEligible("tournament", unscored, true), true);
  // Flag off: nothing, ever.
  assert.equal(gameEndIndicatorsEligible("match", unscored, false), false);
  // Missing or non-competitive type fails safe.
  assert.equal(gameEndIndicatorsEligible(null, unscored, true), false);
  assert.equal(gameEndIndicatorsEligible("practice", unscored, true), false);
  assert.equal(gameEndIndicatorsEligible("drills", unscored, true), false);
});

test("eligibility: one scored point or one pin turns it all off", () => {
  const scored = [
    ...FOUR_POINTS.slice(0, 3),
    { ...FOUR_POINTS[3], confirmed_winner: "user" as const },
  ];
  assert.equal(gameEndIndicatorsEligible("match", scored, true), false);
  const pinned = [
    ...FOUR_POINTS.slice(0, 3),
    { ...FOUR_POINTS[3], game_end_override: "end" as const },
  ];
  assert.equal(gameEndIndicatorsEligible("match", pinned, true), false);
});

test("v2 resolver places a confirmed change after its point", () => {
  const evidence = v2Evidence([
    { after_point_id: "p2", before_point_id: "p3", gap_t0: 15, gap_t1: 40 },
  ]);
  const map = resolveDetectedGameEnds(FOUR_POINTS, evidence);
  assert.equal(map.size, 1);
  assert.equal(map.has("p2"), true);
});

test("v2 resolver ignores unconfirmed changes and non-v2 evidence", () => {
  const unconfirmed = v2Evidence([
    {
      after_point_id: "p2",
      before_point_id: "p3",
      confirmed: false,
    },
  ]);
  assert.equal(resolveDetectedGameEnds(FOUR_POINTS, unconfirmed).size, 0);
  const v1 = evidenceWithChange("p2", "p3", "p3");
  assert.equal(resolveDetectedGameEnds(FOUR_POINTS, v1).size, 0);
  assert.equal(resolveDetectedGameEnds(FOUR_POINTS, null).size, 0);
});

test("v2 resolver falls back to time when the point was deleted", () => {
  // The worker referenced a junk card the owner has since removed: the
  // indicator lands after the last visible point before the gap.
  const evidence = v2Evidence([
    {
      after_point_id: "deleted-junk",
      before_point_id: "p3",
      gap_t0: 15.2,
      gap_t1: 40,
    },
  ]);
  const map = resolveDetectedGameEnds(FOUR_POINTS, evidence);
  assert.equal(map.size, 1);
  assert.equal(map.has("p2"), true);
});

test("v2 resolver drops a change after the final visible point", () => {
  const evidence = v2Evidence([
    { after_point_id: "p4", before_point_id: "gone", gap_t0: 55 },
  ]);
  assert.equal(resolveDetectedGameEnds(FOUR_POINTS, evidence).size, 0);
});

test("v2 resolver keeps the higher-confidence change per point", () => {
  const evidence = v2Evidence([
    {
      after_point_id: "p2",
      before_point_id: "p3",
      confidence: 0.6,
    },
    {
      after_point_id: "p2",
      before_point_id: "p3",
      confidence: 0.9,
    },
  ]);
  const map = resolveDetectedGameEnds(FOUR_POINTS, evidence);
  assert.equal(map.get("p2")?.confidence, 0.9);
});

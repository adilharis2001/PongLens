import assert from "node:assert/strict";
import test from "node:test";

import type {
  Match,
  MatchStructureEvidence,
  Point,
} from "../../../lib/types.ts";
import {
  detectedBoundaryUndoOverride,
  keepScoreServeSetup,
  pointStructurePresentation,
  resolveFirstServer,
  resolveMatchBoundaries,
  shouldApplyPolledFirstServer,
} from "./matchStructure.ts";
import { structureEventPayload } from "../../../lib/structureTelemetry.ts";
import { computeMatchScore } from "./gameScore.ts";

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

test("undoing a moved detected boundary restores the prior partition", () => {
  const points = pointsWithScoreBoundaryAt("p18");
  const evidence = evidenceWithChange("p20", "p21", "p22");
  const detected = resolveMatchBoundaries(points, evidence, true);
  const undo = detectedBoundaryUndoOverride(
    points,
    "p20",
    detected.effectiveOverrides
  );

  assert.deepEqual(undo, { pointId: "p18", value: "end" });
  points.find((candidate) => candidate.id === undo!.pointId)!
    .game_end_override = undo!.value;

  const restored = resolveMatchBoundaries(points, evidence, true);
  const score = computeMatchScore(points, restored.effectiveOverrides);
  assert.equal(score.boundaryAfter.has("p18"), true);
  assert.equal(score.boundaryAfter.has("p20"), false);
  assert.equal(score.open, false);
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

test("deciding-game side swap uses earlier detected boundary corrections", () => {
  const winners: ("user" | "opponent")[] = [];
  for (let i = 0; i < 4; i += 1) winners.push("user", "opponent");
  while (winners.length < 15) winners.push("user"); // raw game 1: 11-4
  winners.push("opponent", "opponent"); // observed game 1: 11-6 at p17
  for (let i = 0; i < 11; i += 1) winners.push("opponent"); // game 2
  for (let i = 0; i < 7; i += 1) winners.push("opponent"); // deciding game
  const points = winners.map((winner, index) => point(`p${index + 1}`, winner));
  const evidence = evidenceWithChange("p17", "p18", "p19");
  evidence.end_changes!.push({
    ...evidence.end_changes![0],
    after_point_id: "p33",
    before_point_id: "p34",
    confirmed_at_point_id: "p35",
    after_idx: 33,
    before_idx: 34,
    confirmed_at_idx: 35,
  });
  evidence.coverage = {
    total: points.length,
    high_confidence: points.length,
    needs_review: 0,
    unavailable: 0,
  };

  const result = resolveMatchBoundaries(points, evidence, true);
  assert.equal(result.effectiveOverrides.get("p17"), "end");
  assert.equal(result.effectiveOverrides.get("p33"), undefined);
  assert.equal(
    result.unresolved.some((change) => change.after_point_id === "p33"),
    true
  );
});

test("ready detected server bypasses the serve setup sheet", () => {
  assert.equal(
    keepScoreServeSetup({
      firstServer: { server: "user", source: "detected" },
      evidenceStatus: "ready",
      enabled: true,
    }),
    "skip"
  );
});

test("pending evidence starts scoring without a blocking sheet", () => {
  assert.equal(
    keepScoreServeSetup({
      firstServer: { server: null, source: "unknown" },
      evidenceStatus: "pending",
      enabled: true,
    }),
    "detecting"
  );
});

test("a pending poll cannot replace a local user correction", () => {
  assert.equal(shouldApplyPolledFirstServer("user"), false);
  assert.equal(shouldApplyPolledFirstServer("detected"), true);
  assert.equal(shouldApplyPolledFirstServer(null), true);
});

test("withheld evidence asks at the first pause", () => {
  assert.equal(
    keepScoreServeSetup({
      firstServer: { server: null, source: "unknown" },
      evidenceStatus: "withheld",
      enabled: true,
    }),
    "ask-at-pause"
  );
});

test("structure telemetry excludes match and player identifiers", () => {
  assert.deepEqual(
    structureEventPayload("boundary_applied", {
      confidence: "high",
      arrival: "before_entry",
      matchId: "must-not-leak",
      pointId: "must-not-leak",
      playerName: "must-not-leak",
    }),
    {
      event: "boundary_applied",
      confidence: "high",
      arrival: "before_entry",
    }
  );
});

test("point structure labels detection without confidence jargon", () => {
  assert.deepEqual(
    pointStructurePresentation({
      server: "user",
      serverSource: "detected",
      endsHere: true,
      boundarySource: "detected",
      userLabel: "Adil",
      opponentLabel: "Vaibhav",
    }),
    {
      serverLabel: "Adil served",
      serverDetail: "Detected",
      gameLabel: "Game ended after this point",
      gameDetail: "Detected from player positions",
    }
  );
});

test("user corrections are labeled as corrected", () => {
  const result = pointStructurePresentation({
    server: "opponent",
    serverSource: "user",
    endsHere: false,
    boundarySource: "user",
    userLabel: "Adil",
    opponentLabel: "Vaibhav",
  });
  assert.equal(result.serverDetail, "Corrected by you");
  assert.equal(result.gameDetail, "Corrected by you");
});

test("resolved structure produces the same two games for every consumer", () => {
  const winners: ("user" | "opponent" | null)[] = [];
  const appendEarlyEleven = (opponentPoints: number) => {
    for (let i = 0; i < opponentPoints; i += 1) {
      winners.push("user", "opponent");
    }
    while (
      winners.filter((winner) => winner === "user").length %
        11 !==
      0
    ) {
      winners.push("user");
    }
  };
  appendEarlyEleven(4); // p15: provisional 11-4
  winners.push("opponent", "opponent"); // p17: observed 11-6
  const gameTwoStart = winners.length;
  for (let i = 0; i < 7; i += 1) winners.push("user", "opponent");
  while (
    winners.slice(gameTwoStart).filter((winner) => winner === "user")
      .length < 11
  ) {
    winners.push("user");
  }
  winners.push("opponent", "opponent"); // p37: observed 11-9
  winners.push(null); // p38 supplies the exact after/before bracket

  const points = winners.map((winner, index) => ({
    ...point(`p${index + 1}`, winner ?? "user"),
    confirmed_winner: winner,
  }));
  const evidence = evidenceWithChange("p17", "p18", "p19");
  evidence.end_changes!.push({
    ...evidence.end_changes![0],
    after_point_id: "p37",
    before_point_id: "p38",
    confirmed_at_point_id: null,
    after_idx: 37,
    before_idx: 38,
    confirmed_at_idx: 38,
  });
  evidence.coverage = {
    total: 38,
    high_confidence: 38,
    needs_review: 0,
    unavailable: 0,
  };

  const resolved = resolveMatchBoundaries(points, evidence, true);
  const score = computeMatchScore(points, resolved.effectiveOverrides);
  assert.deepEqual(
    score.games.map((game) => [game.you, game.them]),
    [
      [11, 6],
      [11, 9],
    ]
  );
  assert.deepEqual([...score.boundaryAfter.keys()], ["p17", "p37"]);
});

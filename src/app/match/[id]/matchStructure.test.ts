import assert from "node:assert/strict";
import test from "node:test";

import type {
  Match,
  MatchStructureEvidence,
  Point,
} from "../../../lib/types.ts";
import {
  keepScoreServeSetup,
  resolveFirstServer,
  resolveMatchBoundaries,
} from "./matchStructure.ts";
import { structureEventPayload } from "../../../lib/structureTelemetry.ts";

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

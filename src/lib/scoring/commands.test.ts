import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalScoreCommandRpcs,
  isCanonicalPointOutcome,
  parseCanonicalCommandResult,
} from "./commands.ts";

const point = {
  pointId: "30000000-0000-0000-0000-000000000001",
  revision: 7,
  timelineOrdinal: 0,
  displayNumber: 1,
  gameNumber: 1,
  scoreUserBefore: 0,
  scoreOpponentBefore: 0,
  scoreUserAfter: 1,
  scoreOpponentAfter: 0,
  confirmedWinner: "user",
  skipKind: null,
  resolvedServer: "user",
  serverSource: "rotation",
  serveNumberInBlock: 1,
  endsGame: false,
  gameBoundarySource: null,
  resolvedGameWinner: null,
  allVisiblePointsAnsweredThroughHere: true,
};

const snapshot = {
  matchId: "10000000-0000-0000-0000-000000000001",
  revision: 7,
  status: "current",
  match: {
    gamesUser: 0,
    gamesOpponent: 0,
    currentGameNumber: 1,
    currentScoreUser: 1,
    currentScoreOpponent: 0,
    completedGames: [],
    visiblePointCount: 1,
    answeredPointCount: 1,
    skippedPointCount: 0,
    allVisiblePointsAnswered: true,
    firstServer: "user",
    firstServerSource: "user",
    ordering: "source_time",
  },
  points: [point],
};

test("parses one successful canonical command response", () => {
  const parsed = parseCanonicalCommandResult({
    ok: true,
    requestId: "40000000-0000-0000-0000-000000000001",
    revision: 7,
    snapshot,
    payload: { pointId: point.pointId },
  });

  assert.equal(parsed?.ok, true);
  if (parsed?.ok) {
    assert.equal(parsed.revision, 7);
    assert.equal(parsed.snapshot.points[0].resolvedServer, "user");
  }
});

test("parses a score conflict with the current snapshot", () => {
  assert.deepEqual(
    parseCanonicalCommandResult({
      ok: false,
      code: "score_conflict",
      revision: 7,
      snapshot,
    }),
    {
      ok: false,
      code: "score_conflict",
      revision: 7,
      snapshot,
    }
  );
});

test("parses narrow terminal errors without inventing a snapshot", () => {
  for (const code of ["not_enabled", "not_owner", "not_found", "invalid_input"]) {
    assert.deepEqual(parseCanonicalCommandResult({ ok: false, code }), {
      ok: false,
      code,
    });
  }
});

test("rejects a mixed-revision or structurally incomplete response", () => {
  assert.equal(
    parseCanonicalCommandResult({
      ok: true,
      requestId: "40000000-0000-0000-0000-000000000001",
      revision: 8,
      snapshot,
      payload: null,
    }),
    null
  );
  assert.equal(
    parseCanonicalCommandResult({
      ok: false,
      code: "score_conflict",
      revision: 7,
      snapshot: { ...snapshot, points: [{ ...point, displayNumber: "one" }] },
    }),
    null
  );
});

test("exports the exact v2 RPC vocabulary used by command clients", () => {
  assert.deepEqual(canonicalScoreCommandRpcs, {
    pointOutcome: "set_point_outcome_v2",
    firstServer: "set_first_server_v2",
    serverOverride: "set_server_override_v2",
    gameBoundary: "set_game_boundary_v2",
  });
  for (const value of [
    "user",
    "opponent",
    "let",
    "misrecorded",
    "other",
    "clear",
  ]) {
    assert.equal(isCanonicalPointOutcome(value), true);
  }
  assert.equal(isCanonicalPointOutcome("skip"), false);
  assert.equal(isCanonicalPointOutcome(null), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalProjection } from "./canonical.ts";
import {
  CanonicalMatchCommandClient,
  CanonicalScoreCommandClient,
  compareCanonicalProjection,
} from "./client.ts";

const point = {
  pointId: "point-1",
  timelineOrdinal: 0,
  displayNumber: 1,
  gameNumber: 1,
  scoreUserBefore: 0,
  scoreOpponentBefore: 0,
  scoreUserAfter: 1,
  scoreOpponentAfter: 0,
  confirmedWinner: "user" as const,
  skipKind: null,
  resolvedServer: "user" as const,
  serverSource: "rotation" as const,
  serveNumberInBlock: 1 as const,
  endsGame: false,
  gameBoundarySource: null,
  resolvedGameWinner: null,
  allVisiblePointsAnsweredThroughHere: true,
};

const match = {
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
  firstServer: "user" as const,
  firstServerSource: "user" as const,
  ordering: "source_time" as const,
};

function success(requestId: string) {
  return {
    ok: true,
    requestId,
    revision: 8,
    snapshot: {
      matchId: "match-1",
      revision: 8,
      status: "current" as const,
      match,
      points: [{ ...point, revision: 8 }],
    },
    payload: {},
  };
}

test("a transport retry reuses one caller-generated request UUID", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let attempt = 0;
  const client = new CanonicalScoreCommandClient({
    enabled: true,
    requestId: () => "request-stable",
    rpc: async (_name, args) => {
      calls.push(args);
      attempt += 1;
      return attempt === 1
        ? { data: null, error: { message: "connection reset" } }
        : { data: success(String(args.p_request_id)), error: null };
    },
  });

  const result = await client.execute({
    rpc: "set_point_outcome_v2",
    args: { p_match_id: "match-1", p_expected_revision: 7 },
    legacy: async () => "legacy",
  });

  assert.equal(result.kind, "canonical");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].p_request_id, "request-stable");
  assert.equal(calls[1].p_request_id, "request-stable");
});

test("not_enabled is the only command rejection that uses the legacy write", async () => {
  let legacyWrites = 0;
  const client = new CanonicalScoreCommandClient({
    enabled: true,
    requestId: () => "request-1",
    rpc: async () => ({
      data: { ok: false, code: "not_enabled" },
      error: null,
    }),
  });
  const result = await client.execute({
    rpc: "set_point_outcome_v2",
    args: {},
    legacy: async () => {
      legacyWrites += 1;
      return "saved";
    },
  });
  assert.deepEqual(result, { kind: "legacy", value: "saved" });
  assert.equal(legacyWrites, 1);
});

for (const code of ["not_owner", "not_found", "invalid_input"] as const) {
  test(`${code} is rejected without a legacy write`, async () => {
    let legacyWrites = 0;
    const client = new CanonicalScoreCommandClient({
      enabled: true,
      requestId: () => "request-1",
      rpc: async () => ({ data: { ok: false, code }, error: null }),
    });
    const result = await client.execute({
      rpc: "set_point_outcome_v2",
      args: {},
      legacy: async () => {
        legacyWrites += 1;
        return true;
      },
    });
    assert.deepEqual(result, { kind: "rejected", code });
    assert.equal(legacyWrites, 0);
  });
}

test("a conflict is reconciled and never falls through to a second write", async () => {
  let legacyWrites = 0;
  let reconciledRevision: number | null = null;
  const client = new CanonicalScoreCommandClient({
    enabled: true,
    requestId: () => "request-1",
    rpc: async () => ({
      data: {
        ok: false,
        code: "score_conflict",
        revision: 8,
        snapshot: success("unused").snapshot,
      },
      error: null,
    }),
  });
  const result = await client.execute({
    rpc: "set_point_outcome_v2",
    args: {},
    legacy: async () => {
      legacyWrites += 1;
      return true;
    },
    onConflict: (snapshot) => {
      reconciledRevision = snapshot.revision;
    },
  });
  assert.equal(result.kind, "conflict");
  assert.equal(reconciledRevision, 8);
  assert.equal(legacyWrites, 0);
});

test("successful parity comparison reports only aggregate mismatch counts", async () => {
  const diagnostics: unknown[] = [];
  const legacy: CanonicalProjection = {
    match: { ...match, currentScoreUser: 0, answeredPointCount: 0 },
    points: [{ ...point, scoreUserAfter: 0, confirmedWinner: null }],
  };
  const client = new CanonicalScoreCommandClient({
    enabled: true,
    requestId: () => "request-1",
    rpc: async (_name, args) => ({
      data: success(String(args.p_request_id)),
      error: null,
    }),
    onParity: (diagnostic) => diagnostics.push(diagnostic),
  });
  const result = await client.execute({
    rpc: "set_point_outcome_v2",
    args: {},
    legacy: async () => true,
    legacyProjection: () => legacy,
  });
  assert.equal(result.kind, "canonical");
  assert.deepEqual(diagnostics, [
    {
      matchId: "match-1",
      revision: 8,
      matches: false,
      mismatchedMatchFields: 2,
      mismatchedPoints: 1,
      canonicalPointCount: 1,
      legacyPointCount: 1,
    },
  ]);
  assert.equal("points" in (diagnostics[0] as object), false);
});

test("projection comparison ignores transport-only point revisions", () => {
  assert.deepEqual(
    compareCanonicalProjection(success("request-1").snapshot, {
      match,
      points: [point],
    }),
    {
      matchId: "match-1",
      revision: 8,
      matches: true,
      mismatchedMatchFields: 0,
      mismatchedPoints: 0,
      canonicalPointCount: 1,
      legacyPointCount: 1,
    },
  );
});

test("projection comparison ignores PostgreSQL jsonb object key order", () => {
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, nested]) => [key, reorder(nested)]),
      );
    }
    return value;
  };
  const original = success("request-1").snapshot;
  const reordered = {
    ...original,
    match: reorder(original.match),
    points: original.points.map((row) => reorder(row)),
  } as typeof original;

  assert.deepEqual(compareCanonicalProjection(reordered, { match, points: [point] }), {
    matchId: "match-1",
    revision: 8,
    matches: true,
    mismatchedMatchFields: 0,
    mismatchedPoints: 0,
    canonicalPointCount: 1,
    legacyPointCount: 1,
  });
});

test("match command serialization feeds each committed revision into the next call", async () => {
  const expected: unknown[] = [];
  const requestIds = ["request-1", "request-2"];
  const coordinator = new CanonicalMatchCommandClient({
    matchId: "match-1",
    initialRevision: 7,
    transport: new CanonicalScoreCommandClient({
      enabled: true,
      requestId: () => requestIds.shift()!,
      rpc: async (_name, args) => {
        expected.push(args.p_expected_revision);
        const revision = Number(args.p_expected_revision) + 1;
        const response = success(String(args.p_request_id));
        response.revision = revision;
        response.snapshot.revision = revision;
        response.snapshot.points[0].revision = revision;
        return { data: response, error: null };
      },
    }),
  });

  const [first, second] = await Promise.all([
    coordinator.execute({
      rpc: "set_point_outcome_v2",
      args: { p_point_id: "point-1" },
      legacy: async () => true,
    }),
    coordinator.execute({
      rpc: "set_point_outcome_v2",
      args: { p_point_id: "point-1" },
      legacy: async () => true,
    }),
  ]);

  assert.equal(first.kind, "canonical");
  assert.equal(second.kind, "canonical");
  assert.deepEqual(expected, [7, 8]);
  assert.equal(coordinator.revision, 9);
});

test("a conflict advances the coordinator before the next queued action", async () => {
  const expected: unknown[] = [];
  let call = 0;
  const coordinator = new CanonicalMatchCommandClient({
    matchId: "match-1",
    initialRevision: 2,
    transport: new CanonicalScoreCommandClient({
      enabled: true,
      requestId: () => `request-${call + 1}`,
      rpc: async (_name, args) => {
        expected.push(args.p_expected_revision);
        call += 1;
        if (call === 1) {
          const conflictSnapshot = success("unused").snapshot;
          conflictSnapshot.revision = 8;
          conflictSnapshot.points[0].revision = 8;
          return {
            data: {
              ok: false,
              code: "score_conflict",
              revision: 8,
              snapshot: conflictSnapshot,
            },
            error: null,
          };
        }
        const response = success(String(args.p_request_id));
        response.revision = 9;
        response.snapshot.revision = 9;
        response.snapshot.points[0].revision = 9;
        return { data: response, error: null };
      },
    }),
  });

  const first = coordinator.execute({
    rpc: "set_point_outcome_v2",
    args: {},
    legacy: async () => true,
  });
  const second = coordinator.execute({
    rpc: "set_point_outcome_v2",
    args: {},
    legacy: async () => true,
  });
  assert.equal((await first).kind, "conflict");
  assert.equal((await second).kind, "canonical");
  assert.deepEqual(expected, [2, 8]);
  assert.equal(coordinator.revision, 9);
});

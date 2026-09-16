import assert from "node:assert/strict";
import test from "node:test";

const snapshot = {
  matchId: "00000000-0000-0000-0000-000000000001",
  revision: 4,
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
  points: [
    {
      pointId: "00000000-0000-0000-0000-000000000011",
      revision: 4,
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
    },
  ],
};

test("the canonical reader loads one complete revision through the narrow RPC", async () => {
  const reader = await import("./reader.ts").catch(() => null);
  assert.ok(reader, "canonical reader module must exist");
  const calls: unknown[] = [];
  const result = await reader.loadCanonicalScoreSnapshot({
    matchId: snapshot.matchId,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { data: { ok: true, snapshot }, error: null };
    },
  });

  assert.deepEqual(calls, [
    ["canonical_score_snapshot_v1", { p_match_id: snapshot.matchId }],
  ]);
  assert.equal(result.kind, "canonical");
  if (result.kind === "canonical") {
    assert.equal(result.snapshot.revision, 4);
    assert.equal(result.snapshot.points[0]?.resolvedServer, "user");
  }
});

test("the canonical reader returns stable legacy reasons without exposing transport details", async () => {
  const { loadCanonicalScoreSnapshot } = await import("./reader.ts");
  for (const code of ["not_enabled", "not_found", "unavailable"] as const) {
    const result = await loadCanonicalScoreSnapshot({
      matchId: snapshot.matchId,
      rpc: async () => ({ data: { ok: false, code }, error: null }),
    });
    assert.deepEqual(result, { kind: "legacy", reason: code });
  }

  const transport = await loadCanonicalScoreSnapshot({
    matchId: snapshot.matchId,
    rpc: async () => ({ data: null, error: new Error("private detail") }),
  });
  assert.deepEqual(transport, { kind: "legacy", reason: "transport_error" });
  assert.equal(JSON.stringify(transport).includes("private detail"), false);
});

test("the canonical reader rejects mixed-revision snapshots", async () => {
  const { loadCanonicalScoreSnapshot } = await import("./reader.ts");
  const mixed = structuredClone(snapshot);
  mixed.points[0].revision = 3;
  const result = await loadCanonicalScoreSnapshot({
    matchId: snapshot.matchId,
    rpc: async () => ({ data: { ok: true, snapshot: mixed }, error: null }),
  });
  assert.deepEqual(result, { kind: "legacy", reason: "invalid_response" });
});

test("the canonical reader refuses a snapshot newer than the source rows being compared", async () => {
  const { loadCanonicalScoreSnapshot } = await import("./reader.ts");
  const result = await loadCanonicalScoreSnapshot({
    matchId: snapshot.matchId,
    expectedRevision: 3,
    rpc: async () => ({ data: { ok: true, snapshot }, error: null }),
  });
  assert.deepEqual(result, { kind: "legacy", reason: "revision_changed" });
});

test("reader shadow diagnostics contain only aggregate parity or stable fallback codes", async () => {
  const reader = await import("./reader.ts");
  assert.equal(
    typeof (reader as Record<string, unknown>).canonicalScoreReaderDiagnostic,
    "function",
    "canonicalScoreReaderDiagnostic must exist",
  );
  const legacy = {
    match: snapshot.match,
    points: snapshot.points.map(({ revision, ...point }) => {
      void revision;
      return point;
    }),
  };
  assert.deepEqual(
    reader.canonicalScoreReaderDiagnostic(
      { kind: "canonical", snapshot },
      legacy,
    ),
    {
      kind: "parity",
      revision: 4,
      matches: true,
      mismatchedMatchFields: 0,
      mismatchedPoints: 0,
      canonicalPointCount: 1,
      legacyPointCount: 1,
    },
  );
  assert.equal(
    JSON.stringify(reader.canonicalScoreReaderDiagnostic(
      { kind: "canonical", snapshot },
      legacy,
    )).includes(snapshot.matchId),
    false,
    "shadow diagnostics must not carry match identifiers",
  );
  assert.equal(
    reader.canonicalScoreReaderDiagnostic(
      { kind: "legacy", reason: "not_enabled" },
      legacy,
    ),
    null,
  );
  assert.deepEqual(
    reader.canonicalScoreReaderDiagnostic(
      { kind: "legacy", reason: "unavailable" },
      legacy,
    ),
    { kind: "fallback", reason: "unavailable" },
  );
});

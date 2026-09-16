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

test("owner and admin shadows reconstruct legacy source rows through one adapter", async () => {
  const reader = await import("./reader.ts");
  assert.equal(
    typeof (reader as Record<string, unknown>).projectLegacyScoreRows,
    "function",
    "projectLegacyScoreRows must exist",
  );
  const projection = reader.projectLegacyScoreRows({
    firstServer: "user",
    firstServerSource: "detected",
    points: [
      {
        id: "00000000-0000-0000-0000-000000000022",
        idx: 2,
        t0: 4,
        deleted: false,
        is_let: false,
        confirmed_how: null,
        confirmed_winner: "user",
        server_override: null,
        game_end_override: null,
        game_winner_override: null,
      },
      {
        id: "00000000-0000-0000-0000-000000000021",
        idx: 1,
        t0: 2,
        deleted: true,
        is_let: false,
        confirmed_how: null,
        confirmed_winner: "opponent",
        server_override: null,
        game_end_override: null,
        game_winner_override: null,
      },
    ],
  });
  assert.equal(projection.match.visiblePointCount, 1);
  assert.equal(projection.match.firstServer, null);
  assert.equal(projection.points[0]?.pointId, "00000000-0000-0000-0000-000000000022");
  assert.equal(projection.points[0]?.resolvedServer, null);
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

test("the batch reader accepts only requested unique summaries and pins returned revisions", async () => {
  const reader = await import("./reader.ts");
  assert.equal(
    typeof (reader as Record<string, unknown>).loadCanonicalScoreSummaries,
    "function",
    "batch reader must exist",
  );
  const second = {
    ...structuredClone(snapshot),
    matchId: "00000000-0000-0000-0000-000000000002",
    revision: 7,
  };
  const calls: unknown[] = [];
  const result = await reader.loadCanonicalScoreSummaries({
    matchIds: [snapshot.matchId, second.matchId],
    expectedRevisions: new Map([
      [snapshot.matchId, 4],
      [second.matchId, 7],
    ]),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return {
        data: {
          ok: true,
          summaries: [
            {
              matchId: snapshot.matchId,
              revision: snapshot.revision,
              status: snapshot.status,
              match: snapshot.match,
            },
            {
              matchId: second.matchId,
              revision: second.revision,
              status: second.status,
              match: second.match,
            },
          ],
        },
        error: null,
      };
    },
  });
  assert.deepEqual(calls, [[
    "canonical_score_summaries_v1",
    { p_match_ids: [snapshot.matchId, second.matchId] },
  ]]);
  assert.equal(result.kind, "canonical");
  if (result.kind === "canonical") assert.equal(result.summaries.length, 2);

  for (const summaries of [
    [
      {
        matchId: "00000000-0000-0000-0000-000000000099",
        revision: 4,
        status: snapshot.status,
        match: snapshot.match,
      },
    ],
    [
      {
        matchId: snapshot.matchId,
        revision: 4,
        status: snapshot.status,
        match: snapshot.match,
      },
      {
        matchId: snapshot.matchId,
        revision: 4,
        status: snapshot.status,
        match: snapshot.match,
      },
    ],
  ]) {
    const invalid = await reader.loadCanonicalScoreSummaries({
      matchIds: [snapshot.matchId],
      rpc: async () => ({ data: { ok: true, summaries }, error: null }),
    });
    assert.deepEqual(invalid, { kind: "legacy", reason: "invalid_response" });
  }

  const changed = await reader.loadCanonicalScoreSummaries({
    matchIds: [snapshot.matchId],
    expectedRevisions: new Map([[snapshot.matchId, 3]]),
    rpc: async () => ({
      data: {
        ok: true,
        summaries: [{
          matchId: snapshot.matchId,
          revision: 4,
          status: snapshot.status,
          match: snapshot.match,
        }],
      },
      error: null,
    }),
  });
  assert.deepEqual(changed, { kind: "legacy", reason: "revision_changed" });
});

test("the batch reader fails closed with stable reasons and no transport detail", async () => {
  const { loadCanonicalScoreSummaries } = await import("./reader.ts");
  for (const code of ["not_enabled", "invalid_input", "unavailable"] as const) {
    const result = await loadCanonicalScoreSummaries({
      matchIds: [snapshot.matchId],
      rpc: async () => ({ data: { ok: false, code }, error: null }),
    });
    assert.deepEqual(result, { kind: "legacy", reason: code });
  }

  const malformed = await loadCanonicalScoreSummaries({
    matchIds: [snapshot.matchId],
    rpc: async () => ({
      data: {
        ok: true,
        summaries: [{
          matchId: snapshot.matchId,
          revision: snapshot.revision,
          status: snapshot.status,
          match: { ...snapshot.match, currentGameNumber: 0 },
        }],
      },
      error: null,
    }),
  });
  assert.deepEqual(malformed, { kind: "legacy", reason: "invalid_response" });

  const transport = await loadCanonicalScoreSummaries({
    matchIds: [snapshot.matchId],
    rpc: async () => ({ data: null, error: new Error("database secret") }),
  });
  assert.deepEqual(transport, { kind: "legacy", reason: "transport_error" });
  assert.equal(JSON.stringify(transport).includes("database secret"), false);

  const tooMany = await loadCanonicalScoreSummaries({
    matchIds: Array.from({ length: 251 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    rpc: async () => {
      throw new Error("must not call RPC");
    },
  });
  assert.deepEqual(tooMany, { kind: "legacy", reason: "invalid_input" });
});

test("batch shadow diagnostics compare score chips without identifiers", async () => {
  const reader = await import("./reader.ts");
  assert.equal(
    typeof (reader as Record<string, unknown>).canonicalScoreSummariesDiagnostic,
    "function",
  );
  const summary = {
    matchId: snapshot.matchId,
    revision: snapshot.revision,
    status: snapshot.status,
    match: snapshot.match,
  };
  const diagnostic = reader.canonicalScoreSummariesDiagnostic(
    { kind: "canonical", summaries: [summary] },
    new Map([[snapshot.matchId, { you: 0, them: 1, complete: false }]]),
    2,
  );
  assert.deepEqual(diagnostic, {
    kind: "parity",
    requestedCount: 2,
    returnedCount: 1,
    missingCount: 1,
    comparedCount: 1,
    mismatchedCount: 1,
  });
  assert.equal(JSON.stringify(diagnostic).includes(snapshot.matchId), false);
  assert.equal(
    reader.canonicalScoreSummariesDiagnostic(
      { kind: "legacy", reason: "not_enabled" },
      new Map(),
      1,
    ),
    null,
  );
  assert.deepEqual(
    reader.canonicalScoreSummariesDiagnostic(
      { kind: "legacy", reason: "revision_changed" },
      new Map(),
      1,
    ),
    { kind: "fallback", reason: "revision_changed" },
  );
});

test("summary shadow evidence chunks large libraries and returns one aggregate", async () => {
  const reader = await import("./reader.ts");
  assert.equal(
    typeof (reader as Record<string, unknown>)
      .loadCanonicalScoreSummaryDiagnostic,
    "function",
  );
  const matchIds = Array.from({ length: 251 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const calls: number[] = [];
  const diagnostic = await reader.loadCanonicalScoreSummaryDiagnostic({
    matchIds,
    expectedRevisions: new Map(matchIds.map((id) => [id, 1])),
    legacyByMatch: new Map(),
    rpc: async (_name: string, args: { p_match_ids: string[] }) => {
      calls.push(args.p_match_ids.length);
      return { data: { ok: true, summaries: [] }, error: null };
    },
  });
  assert.deepEqual(calls, [250, 1]);
  assert.deepEqual(diagnostic, {
    kind: "parity",
    requestedCount: 251,
    returnedCount: 0,
    missingCount: 251,
    comparedCount: 0,
    mismatchedCount: 0,
  });
});

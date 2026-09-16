import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./audit-canonical-corpus.ts", import.meta.url);

const onePoint = {
  matchId: "00000000-0000-0000-0000-000000000001",
  legacyInput: {
    firstServer: "user",
    firstServerSource: "user",
    points: [
      {
        id: "00000000-0000-0000-0000-000000000011",
        idx: 0,
        t0: 1.25,
        deleted: false,
        isLet: false,
        confirmedHow: null,
        confirmedWinner: "user",
        serverOverride: null,
        gameEndOverride: null,
        gameWinnerOverride: null,
      },
    ],
  },
  canonicalSnapshot: {
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
  },
};

test("the corpus audit accepts a literal legacy/canonical parity row", () => {
  const directory = mkdtempSync(join(tmpdir(), "ponglens-canonical-corpus-"));
  const input = join(directory, "corpus.ndjson");
  try {
    writeFileSync(input, `${JSON.stringify(onePoint)}\n`);
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", script.pathname, input],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      totalMatches: 1,
      matchingMatches: 1,
      mismatchingMatches: 0,
      invalidRows: 0,
      mismatchedMatchFields: 0,
      mismatchedPoints: 0,
      mismatches: [],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the corpus audit fails with aggregate counts and no point identifiers", () => {
  const directory = mkdtempSync(join(tmpdir(), "ponglens-canonical-corpus-"));
  const input = join(directory, "corpus.ndjson");
  const mismatching = structuredClone(onePoint);
  mismatching.canonicalSnapshot.match.currentScoreUser = 0;
  mismatching.canonicalSnapshot.points[0].scoreUserAfter = 0;
  try {
    writeFileSync(input, `${JSON.stringify(mismatching)}\n`);
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", script.pathname, input],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report, {
      schemaVersion: 1,
      totalMatches: 1,
      matchingMatches: 0,
      mismatchingMatches: 1,
      invalidRows: 0,
      mismatchedMatchFields: 1,
      mismatchedPoints: 1,
      mismatches: [
        {
          matchId: onePoint.matchId,
          revision: 4,
          mismatchedMatchFields: 1,
          mismatchedPoints: 1,
          canonicalPointCount: 1,
          legacyPointCount: 1,
        },
      ],
    });
    assert.equal(result.stdout.includes(onePoint.legacyInput.points[0].id), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  orderCanonicalPoints,
  projectCanonicalScore,
  type CanonicalPointInput,
  type CanonicalMatchInput,
  type CanonicalProjection,
} from "./canonical.ts";
import {
  computeMatchScore,
  resolvedGameWinner,
  runningScoreByPoint,
} from "../../app/match/[id]/gameScore.ts";
import { computeServing } from "../../app/match/[id]/serving.ts";

function point(
  number: number,
  overrides: Partial<CanonicalPointInput> = {}
): CanonicalPointInput {
  return {
    id: `point-${number}`,
    idx: number,
    t0: number * 10,
    confirmedWinner: null,
    ...overrides,
  };
}

test("two-serve blocks and an automatic 11-0 game produce one canonical snapshot", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: Array.from({ length: 12 }, (_, index) =>
      point(index + 1, {
        confirmedWinner: index < 11 ? "user" : null,
      })
    ),
  });

  assert.deepEqual(
    projection.points.slice(0, 6).map((state) => state.resolvedServer),
    ["user", "user", "opponent", "opponent", "user", "user"]
  );
  assert.equal(projection.points[10].endsGame, true);
  assert.equal(projection.points[11].gameNumber, 2);
  assert.equal(projection.match.gamesUser, 1);
  assert.deepEqual(
    projection.points.slice(0, 3).map((state) => state.timelineOrdinal),
    [0, 1, 2]
  );
});

test("let repeats the same server and contributes no score", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [
      point(1, { isLet: true, confirmedHow: "let" }),
      point(2, { confirmedWinner: "user" }),
    ],
  });

  assert.deepEqual(
    projection.points.map((state) => state.resolvedServer),
    ["user", "user"]
  );
  assert.deepEqual(
    projection.points.map((state) => [
      state.scoreUserBefore,
      state.scoreOpponentBefore,
      state.scoreUserAfter,
      state.scoreOpponentAfter,
    ]),
    [
      [0, 0, 0, 0],
      [0, 0, 1, 0],
    ]
  );
  assert.equal(projection.points[0].serveNumberInBlock, 1);
  assert.equal(projection.points[1].serveNumberInBlock, 1);
});

test("unscored visible card consumes a serve position without changing score", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [point(1), point(2), point(3)],
  });

  assert.deepEqual(
    projection.points.map((state) => state.resolvedServer),
    ["user", "user", "opponent"]
  );
  assert.deepEqual(
    projection.points.map((state) => [
      state.scoreUserAfter,
      state.scoreOpponentAfter,
    ]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ]
  );
});

test("deuce alternates every point", () => {
  const points = Array.from({ length: 20 }, (_, index) =>
    point(index + 1, {
      confirmedWinner: index % 2 === 0 ? "user" : "opponent",
    })
  );
  points.push(
    point(21, { confirmedWinner: "user" }),
    point(22, { confirmedWinner: "opponent" }),
    point(23, { confirmedWinner: "user" }),
    point(24, { confirmedWinner: "opponent" })
  );

  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points,
  });

  assert.deepEqual(
    projection.points.slice(20).map((state) => state.resolvedServer),
    ["user", "opponent", "user", "opponent"]
  );
});

test("positional end on an unscored card starts the next game", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [
      point(1, { confirmedWinner: "user" }),
      point(2, { gameEndOverride: "end" }),
      point(3, { confirmedWinner: "opponent" }),
    ],
  });

  assert.equal(projection.points[1].endsGame, true);
  assert.equal(projection.points[1].gameBoundarySource, "owner_end_override");
  assert.equal(projection.points[2].gameNumber, 2);
  assert.deepEqual(
    [
      projection.points[2].scoreUserBefore,
      projection.points[2].scoreOpponentBefore,
    ],
    [0, 0]
  );
});

test("continue suppresses automatic endings until explicit end", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [
      ...Array.from({ length: 10 }, (_, index) =>
        point(index + 1, { confirmedWinner: "user" })
      ),
      point(11, {
        confirmedWinner: "user",
        gameEndOverride: "continue",
      }),
      point(12, { gameEndOverride: "end" }),
    ],
  });

  assert.equal(projection.points[10].endsGame, false);
  assert.equal(projection.points[11].endsGame, true);
  assert.equal(projection.match.completedGames[0].scoreUser, 11);
});

test("named winner resolves an incomplete manually closed game", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [
      point(1, { confirmedWinner: "user" }),
      point(2, { confirmedWinner: "user" }),
      point(3, { confirmedWinner: "user" }),
      point(4, { confirmedWinner: "opponent" }),
      point(5, {
        confirmedWinner: "opponent",
        gameEndOverride: "end",
        gameWinnerOverride: "opponent",
      }),
    ],
  });

  assert.equal(projection.points[4].resolvedGameWinner, "opponent");
  assert.equal(projection.match.gamesOpponent, 1);
  assert.equal(projection.match.gamesUser, 0);
});

test("agreeing server override preserves phase", () => {
  const baseline = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [point(1), point(2), point(3), point(4)],
  });
  const pinned = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [
      point(1),
      point(2, { serverOverride: "user" }),
      point(3),
      point(4),
    ],
  });

  assert.deepEqual(
    pinned.points.map((state) => state.resolvedServer),
    baseline.points.map((state) => state.resolvedServer)
  );
});

test("contradicting server override restarts the block and downstream parity", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: [
      point(1),
      point(2, { serverOverride: "opponent" }),
      point(3),
      point(4, {
        gameEndOverride: "end",
        gameWinnerOverride: "user",
      }),
      point(5),
    ],
  });

  assert.deepEqual(
    projection.points.map((state) => state.resolvedServer),
    ["user", "opponent", "opponent", "user", "user"]
  );
});

test("detected first server does not become owner-confirmed server", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "detected",
    points: [point(1), point(2), point(3)],
  });

  assert.deepEqual(
    projection.points.map((state) => state.resolvedServer),
    [null, null, null]
  );
  assert.equal(projection.match.firstServer, null);
  assert.equal(projection.match.firstServerSource, null);
});

test("split child sorts by source time despite high idx", () => {
  const ordered = orderCanonicalPoints([
    point(1, { id: "parent", idx: 1, t0: 10 }),
    point(2, { id: "next", idx: 2, t0: 20 }),
    point(99, { id: "child", idx: 99, t0: 15 }),
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["parent", "child", "next"]
  );
});

test("one missing t0 makes the whole legacy match fall back to idx order", () => {
  const ordered = orderCanonicalPoints([
    point(3, { id: "third-by-idx", idx: 3, t0: 5 }),
    point(1, { id: "first-by-idx", idx: 1, t0: 20 }),
    point(2, { id: "missing-time", idx: 2, t0: null }),
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["first-by-idx", "missing-time", "third-by-idx"]
  );
});

test("deleted point is absent and later display numbers are contiguous", () => {
  const projection = projectCanonicalScore({
    firstServer: null,
    firstServerSource: null,
    points: [
      point(1, { id: "kept-1" }),
      point(2, { id: "deleted", deleted: true }),
      point(3, { id: "kept-2" }),
    ],
  });

  assert.deepEqual(
    projection.points.map((state) => state.pointId),
    ["kept-1", "kept-2"]
  );
  assert.deepEqual(
    projection.points.map((state) => state.displayNumber),
    [1, 2]
  );
});

test("shared hand-checked fixtures match exactly", () => {
  const fixtureUrl = new URL(
    "./fixtures/canonical-score-cases.json",
    import.meta.url
  );
  const cases = JSON.parse(readFileSync(fixtureUrl, "utf8")) as Array<{
    name: string;
    input: CanonicalMatchInput;
    expected: CanonicalProjection;
  }>;

  for (const fixture of cases) {
    assert.deepEqual(
      projectCanonicalScore(fixture.input),
      fixture.expected,
      fixture.name
    );
  }
});

test("deterministic corpus stays in parity with the shipped web folds", () => {
  let seed = 0x51c0_1234;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  for (let caseNumber = 0; caseNumber < 250; caseNumber += 1) {
    const firstServer = random() < 0.5 ? "user" : "opponent";
    const sourceRoll = random();
    const firstServerSource: CanonicalMatchInput["firstServerSource"] =
      sourceRoll < 0.7 ? "user" : sourceRoll < 0.9 ? "detected" : null;
    const count = 5 + Math.floor(random() * 70);
    const points: CanonicalPointInput[] = [];
    for (let index = 0; index < count; index += 1) {
      const skipped = random() < 0.08;
      const winnerRoll = random();
      const gameRoll = random();
      points.push({
        id: `case-${caseNumber}-point-${index}`,
        idx: index + 1,
        t0: random() < 0.04 ? null : index * 4 + Math.floor(random() * 3),
        deleted: random() < 0.05,
        isLet: skipped,
        confirmedHow: skipped
          ? random() < 0.5
            ? "let"
            : random() < 0.5
              ? "misrecorded"
              : "other"
          : null,
        confirmedWinner: skipped
          ? null
          : winnerRoll < 0.42
            ? "user"
            : winnerRoll < 0.84
              ? "opponent"
              : null,
        serverOverride:
          random() < 0.04 ? (random() < 0.5 ? "user" : "opponent") : null,
        gameEndOverride:
          gameRoll < 0.025 ? "end" : gameRoll < 0.04 ? "continue" : null,
        gameWinnerOverride:
          gameRoll < 0.025 && random() < 0.6
            ? random() < 0.5
              ? "user"
              : "opponent"
            : null,
      });
    }

    const projection = projectCanonicalScore({
      firstServer,
      firstServerSource,
      points,
    });
    const ordered = orderCanonicalPoints(points);
    const shippedPoints = ordered.map((entry) => ({
      id: entry.id,
      is_let: entry.isLet ?? false,
      confirmed_winner: entry.confirmedWinner ?? null,
      confirmed_how: entry.confirmedHow ?? null,
      server_override: entry.serverOverride ?? null,
      game_end_override: entry.gameEndOverride ?? null,
      game_winner_override: entry.gameWinnerOverride ?? null,
    }));
    const score = computeMatchScore(
      shippedPoints as unknown as Parameters<typeof computeMatchScore>[0]
    );
    const serving = computeServing(
      shippedPoints as unknown as Parameters<typeof computeServing>[0],
      firstServerSource === "user" ? firstServer : null
    );
    const running = runningScoreByPoint(shippedPoints);

    assert.deepEqual(
      [
        projection.match.gamesUser,
        projection.match.gamesOpponent,
        projection.match.currentScoreUser,
        projection.match.currentScoreOpponent,
      ],
      [score.gamesYou, score.gamesThem, score.current.you, score.current.them],
      `match fold case ${caseNumber}`
    );
    for (const state of projection.points) {
      const shippedScore = running.get(state.pointId);
      assert.deepEqual(
        [state.scoreUserAfter, state.scoreOpponentAfter],
        [shippedScore?.you, shippedScore?.them],
        `running score case ${caseNumber} ${state.pointId}`
      );
      assert.equal(
        state.endsGame,
        score.boundaryAfter.has(state.pointId),
        `boundary case ${caseNumber} ${state.pointId}`
      );
      assert.equal(
        state.resolvedServer,
        serving.get(state.pointId)?.server ?? null,
        `server case ${caseNumber} ${state.pointId}`
      );
      const boundary = score.boundaryAfter.get(state.pointId);
      assert.equal(
        state.resolvedGameWinner,
        boundary ? resolvedGameWinner(boundary) : null,
        `game winner case ${caseNumber} ${state.pointId}`
      );
    }
  }
});

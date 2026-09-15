export type CanonicalPlayer = "user" | "opponent";
export type CanonicalFirstServerSource = "user" | "detected" | null;
export type CanonicalGameEndOverride = "end" | "continue" | null;

export interface CanonicalPointInput {
  id: string;
  idx: number;
  t0: number | null;
  deleted?: boolean;
  isLet?: boolean;
  confirmedHow?: string | null;
  confirmedWinner?: CanonicalPlayer | null;
  serverOverride?: CanonicalPlayer | null;
  gameEndOverride?: CanonicalGameEndOverride;
  gameWinnerOverride?: CanonicalPlayer | null;
}

export interface CanonicalMatchInput {
  firstServer: CanonicalPlayer | null;
  firstServerSource: CanonicalFirstServerSource;
  points: CanonicalPointInput[];
}

export interface CanonicalCompletedGame {
  gameNumber: number;
  scoreUser: number;
  scoreOpponent: number;
  winner: CanonicalPlayer | null;
  closingPointId: string;
  boundarySource: "automatic_score" | "owner_end_override";
}

export interface CanonicalPointState {
  pointId: string;
  timelineOrdinal: number;
  displayNumber: number;
  gameNumber: number;
  scoreUserBefore: number;
  scoreOpponentBefore: number;
  scoreUserAfter: number;
  scoreOpponentAfter: number;
  confirmedWinner: CanonicalPlayer | null;
  skipKind: "let" | "misrecorded" | "other" | null;
  resolvedServer: CanonicalPlayer | null;
  serverSource: "rotation" | "owner_override" | "unresolved";
  serveNumberInBlock: number | null;
  endsGame: boolean;
  gameBoundarySource: "automatic_score" | "owner_end_override" | null;
  resolvedGameWinner: CanonicalPlayer | null;
  allVisiblePointsAnsweredThroughHere: boolean;
}

export interface CanonicalMatchState {
  gamesUser: number;
  gamesOpponent: number;
  currentGameNumber: number;
  currentScoreUser: number;
  currentScoreOpponent: number;
  completedGames: CanonicalCompletedGame[];
  visiblePointCount: number;
  answeredPointCount: number;
  skippedPointCount: number;
  allVisiblePointsAnswered: boolean;
  firstServer: CanonicalPlayer | null;
  firstServerSource: "user" | null;
  ordering: "source_time" | "legacy_idx";
}

export interface CanonicalProjection {
  points: CanonicalPointState[];
  match: CanonicalMatchState;
}

function otherPlayer(player: CanonicalPlayer): CanonicalPlayer {
  return player === "user" ? "opponent" : "user";
}

function isAutomaticGameWinner(
  user: number,
  opponent: number
): CanonicalPlayer | null {
  if (Math.max(user, opponent) < 11 || Math.abs(user - opponent) < 2) {
    return null;
  }
  return user > opponent ? "user" : "opponent";
}

export function orderCanonicalPoints(
  points: CanonicalPointInput[]
): CanonicalPointInput[] {
  const active = points.filter((point) => !point.deleted);
  const hasCompleteSourceTime = active.every((point) => point.t0 !== null);

  return [...active].sort((left, right) => {
    if (hasCompleteSourceTime) {
      const timeDelta = Number(left.t0) - Number(right.t0);
      if (timeDelta !== 0) return timeDelta;
    }
    const indexDelta = left.idx - right.idx;
    return indexDelta !== 0 ? indexDelta : left.id.localeCompare(right.id);
  });
}

export function projectCanonicalScore(
  input: CanonicalMatchInput
): CanonicalProjection {
  const ordered = orderCanonicalPoints(input.points);
  const canonicalFirstServer =
    input.firstServerSource === "user" ? input.firstServer : null;
  const ordering = ordered.every((point) => point.t0 !== null)
    ? "source_time"
    : "legacy_idx";

  let scoreUser = 0;
  let scoreOpponent = 0;
  let gamesUser = 0;
  let gamesOpponent = 0;
  let gameNumber = 1;
  let holdGameOpen = false;
  let answeredThrough = true;
  let answeredPointCount = 0;
  let skippedPointCount = 0;

  let currentServer = canonicalFirstServer;
  let gameFirstServer = canonicalFirstServer;
  let servesInBlock = 0;

  const completedGames: CanonicalCompletedGame[] = [];
  const states: CanonicalPointState[] = [];

  for (const [index, point] of ordered.entries()) {
    const skipped = point.isLet === true;
    const winner = skipped ? null : (point.confirmedWinner ?? null);
    const answered = skipped || winner !== null;
    answeredThrough = answeredThrough && answered;
    if (skipped) skippedPointCount += 1;
    if (winner !== null) answeredPointCount += 1;

    if (point.serverOverride) {
      if (currentServer === null || point.serverOverride !== currentServer) {
        if (currentServer !== null && gameFirstServer !== null) {
          gameFirstServer = otherPlayer(gameFirstServer);
        }
        servesInBlock = 0;
      }
      currentServer = point.serverOverride;
      if (gameFirstServer === null) gameFirstServer = currentServer;
    }

    const resolvedServer = currentServer;
    const serveNumberInBlock =
      resolvedServer === null ? null : servesInBlock + 1;
    const scoreUserBefore = scoreUser;
    const scoreOpponentBefore = scoreOpponent;

    if (winner === "user") scoreUser += 1;
    else if (winner === "opponent") scoreOpponent += 1;

    let endsGame = false;
    let gameBoundarySource: CanonicalPointState["gameBoundarySource"] = null;
    if (point.gameEndOverride === "end") {
      endsGame = true;
      gameBoundarySource = "owner_end_override";
    } else if (point.gameEndOverride === "continue") {
      holdGameOpen = true;
    } else if (!holdGameOpen && winner !== null) {
      endsGame = isAutomaticGameWinner(scoreUser, scoreOpponent) !== null;
      if (endsGame) gameBoundarySource = "automatic_score";
    }

    const automaticWinner = isAutomaticGameWinner(scoreUser, scoreOpponent);
    const resolvedGameWinner = endsGame
      ? (point.gameWinnerOverride ?? automaticWinner)
      : null;

    states.push({
      pointId: point.id,
      timelineOrdinal: index,
      displayNumber: index + 1,
      gameNumber,
      scoreUserBefore,
      scoreOpponentBefore,
      scoreUserAfter: scoreUser,
      scoreOpponentAfter: scoreOpponent,
      confirmedWinner: winner,
      skipKind: skipped
        ? point.confirmedHow === "misrecorded" || point.confirmedHow === "other"
          ? point.confirmedHow
          : "let"
        : null,
      resolvedServer,
      serverSource: point.serverOverride
        ? "owner_override"
        : resolvedServer
          ? "rotation"
          : "unresolved",
      serveNumberInBlock,
      endsGame,
      gameBoundarySource,
      resolvedGameWinner,
      allVisiblePointsAnsweredThroughHere: answeredThrough,
    });

    if (!skipped) {
      servesInBlock += 1;
      const isDeuce = scoreUser >= 10 && scoreOpponent >= 10;
      if (
        currentServer !== null &&
        servesInBlock >= (isDeuce ? 1 : 2)
      ) {
        currentServer = otherPlayer(currentServer);
        servesInBlock = 0;
      }
    }

    if (endsGame) {
      completedGames.push({
        gameNumber,
        scoreUser,
        scoreOpponent,
        winner: resolvedGameWinner,
        closingPointId: point.id,
        boundarySource: gameBoundarySource!,
      });
      if (resolvedGameWinner === "user") gamesUser += 1;
      else if (resolvedGameWinner === "opponent") gamesOpponent += 1;

      scoreUser = 0;
      scoreOpponent = 0;
      gameNumber += 1;
      holdGameOpen = false;
      servesInBlock = 0;
      if (gameFirstServer !== null) {
        gameFirstServer = otherPlayer(gameFirstServer);
        currentServer = gameFirstServer;
      }
    }
  }

  return {
    points: states,
    match: {
      gamesUser,
      gamesOpponent,
      currentGameNumber: gameNumber,
      currentScoreUser: scoreUser,
      currentScoreOpponent: scoreOpponent,
      completedGames,
      visiblePointCount: ordered.length,
      answeredPointCount,
      skippedPointCount,
      allVisiblePointsAnswered: ordered.length > 0 && answeredThrough,
      firstServer: canonicalFirstServer,
      firstServerSource: canonicalFirstServer === null ? null : "user",
      ordering,
    },
  };
}

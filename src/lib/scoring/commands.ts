import type {
  CanonicalCompletedGame,
  CanonicalMatchState,
  CanonicalPlayer,
  CanonicalPointState,
} from "./canonical.ts";

export const canonicalScoreCommandRpcs = {
  pointOutcome: "set_point_outcome_v2",
  firstServer: "set_first_server_v2",
  serverOverride: "set_server_override_v2",
  gameBoundary: "set_game_boundary_v2",
  pointVisibility: "set_point_visibility_v2",
  splitPoint: "split_point_v2",
  unsplitPoint: "unsplit_point_v2",
  mergePoints: "merge_points_v2",
  adjustPoint: "adjust_point_v2",
  insertPoint: "insert_point_v2",
  resetMatchScore: "reset_match_score_v2",
} as const;

export type CanonicalPointOutcome =
  | CanonicalPlayer
  | "let"
  | "misrecorded"
  | "other"
  | "clear";

export function isCanonicalPointOutcome(
  value: unknown
): value is CanonicalPointOutcome {
  return (
    value === "user" ||
    value === "opponent" ||
    value === "let" ||
    value === "misrecorded" ||
    value === "other" ||
    value === "clear"
  );
}

export interface CanonicalCommandIdentity {
  matchId: string;
  requestId: string;
  expectedRevision: number;
}

export interface SetPointOutcomeCommand extends CanonicalCommandIdentity {
  pointId: string;
  outcome: CanonicalPointOutcome;
  confirmedHow?: string | null;
  scoredAtCutS?: number | null;
}

export interface SetFirstServerCommand extends CanonicalCommandIdentity {
  firstServer: CanonicalPlayer | null;
}

export interface SetServerOverrideCommand extends CanonicalCommandIdentity {
  pointId: string;
  server: CanonicalPlayer | null;
}

export interface SetGameBoundaryCommand extends CanonicalCommandIdentity {
  pointId: string;
  boundary: "end" | "continue" | null;
  gameWinner: CanonicalPlayer | null;
  previousPointId?: string | null;
}

export interface SetPointVisibilityCommand extends CanonicalCommandIdentity {
  pointId: string;
  visible: boolean;
}

export interface SplitPointCommand extends CanonicalCommandIdentity {
  parentPointId: string;
  splitTimes: number[];
  childCutT0s: Array<number | null>;
  outcomes: CanonicalPointOutcome[];
}

export interface UnsplitPointCommand extends CanonicalCommandIdentity {
  splitRequestId: string;
}

export interface MergePointsCommand extends CanonicalCommandIdentity {
  pointIds: string[];
  outcome: CanonicalPointOutcome;
}

export interface AdjustPointCommand extends CanonicalCommandIdentity {
  pointId: string;
  t0: number;
  t1: number;
  tightStart: boolean;
  tightEnd: boolean;
  scoredAtCutS: number | null;
  rallyEndCutS: number | null;
}

export interface InsertPointCommand extends CanonicalCommandIdentity {
  previousPointId: string | null;
  nextPointId: string | null;
  t0: number;
  t1: number;
  cutT0: number | null;
  outcome: CanonicalPointOutcome;
}

export interface ResetMatchScoreCommand extends CanonicalCommandIdentity {
  pointIds: string[];
  pinEndPointIds: string[];
  clearBoundaries: boolean;
}

export interface CanonicalSnapshotPoint extends CanonicalPointState {
  revision: number;
}

export interface CanonicalScoreSnapshot {
  matchId: string;
  revision: number;
  status: "current" | "empty";
  match: CanonicalMatchState;
  points: CanonicalSnapshotPoint[];
}

export type CanonicalCommandResult =
  | {
      ok: true;
      requestId: string;
      revision: number;
      snapshot: CanonicalScoreSnapshot;
      payload: unknown;
    }
  | {
      ok: false;
      code: "score_conflict";
      revision: number;
      snapshot: CanonicalScoreSnapshot;
    }
  | {
      ok: false;
      code: "not_enabled" | "not_owner" | "not_found" | "invalid_input";
    };

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isInteger(value) && Number(value) >= minimum;
}

function nullablePlayer(value: unknown): value is CanonicalPlayer | null {
  return value === null || value === "user" || value === "opponent";
}

function completedGame(value: unknown): CanonicalCompletedGame | null {
  const row = object(value);
  if (
    !row ||
    !integer(row.gameNumber, 1) ||
    !integer(row.scoreUser) ||
    !integer(row.scoreOpponent) ||
    !nullablePlayer(row.winner) ||
    typeof row.closingPointId !== "string" ||
    (row.boundarySource !== "automatic_score" &&
      row.boundarySource !== "owner_end_override")
  ) {
    return null;
  }
  return row as unknown as CanonicalCompletedGame;
}

function matchState(value: unknown): CanonicalMatchState | null {
  const row = object(value);
  if (!row || !Array.isArray(row.completedGames)) return null;
  const games = row.completedGames.map(completedGame);
  if (
    games.some((game) => game === null) ||
    !integer(row.gamesUser) ||
    !integer(row.gamesOpponent) ||
    !integer(row.currentGameNumber, 1) ||
    !integer(row.currentScoreUser) ||
    !integer(row.currentScoreOpponent) ||
    !integer(row.visiblePointCount) ||
    !integer(row.answeredPointCount) ||
    !integer(row.skippedPointCount) ||
    typeof row.allVisiblePointsAnswered !== "boolean" ||
    !nullablePlayer(row.firstServer) ||
    (row.firstServerSource !== null && row.firstServerSource !== "user") ||
    (row.ordering !== "source_time" && row.ordering !== "legacy_idx")
  ) {
    return null;
  }
  return { ...row, completedGames: games } as CanonicalMatchState;
}

function pointState(value: unknown, revision: number): CanonicalSnapshotPoint | null {
  const row = object(value);
  if (
    !row ||
    row.revision !== revision ||
    typeof row.pointId !== "string" ||
    !integer(row.timelineOrdinal) ||
    !integer(row.displayNumber, 1) ||
    !integer(row.gameNumber, 1) ||
    !integer(row.scoreUserBefore) ||
    !integer(row.scoreOpponentBefore) ||
    !integer(row.scoreUserAfter) ||
    !integer(row.scoreOpponentAfter) ||
    !nullablePlayer(row.confirmedWinner) ||
    (row.skipKind !== null &&
      row.skipKind !== "let" &&
      row.skipKind !== "misrecorded" &&
      row.skipKind !== "other") ||
    !nullablePlayer(row.resolvedServer) ||
    (row.serverSource !== "rotation" &&
      row.serverSource !== "owner_override" &&
      row.serverSource !== "unresolved") ||
    (row.serveNumberInBlock !== null &&
      row.serveNumberInBlock !== 1 &&
      row.serveNumberInBlock !== 2) ||
    typeof row.endsGame !== "boolean" ||
    (row.gameBoundarySource !== null &&
      row.gameBoundarySource !== "automatic_score" &&
      row.gameBoundarySource !== "owner_end_override") ||
    !nullablePlayer(row.resolvedGameWinner) ||
    typeof row.allVisiblePointsAnsweredThroughHere !== "boolean"
  ) {
    return null;
  }
  return row as unknown as CanonicalSnapshotPoint;
}

function snapshot(value: unknown): CanonicalScoreSnapshot | null {
  const row = object(value);
  if (
    !row ||
    typeof row.matchId !== "string" ||
    !integer(row.revision) ||
    (row.status !== "current" && row.status !== "empty") ||
    !Array.isArray(row.points)
  ) {
    return null;
  }
  const match = matchState(row.match);
  const points = row.points.map((point) => pointState(point, row.revision as number));
  if (!match || points.some((point) => point === null)) return null;
  return {
    matchId: row.matchId,
    revision: row.revision,
    status: row.status,
    match,
    points,
  } as CanonicalScoreSnapshot;
}

export function parseCanonicalCommandResult(
  value: unknown
): CanonicalCommandResult | null {
  const row = object(value);
  if (!row || typeof row.ok !== "boolean") return null;

  if (row.ok) {
    const parsedSnapshot = snapshot(row.snapshot);
    if (
      typeof row.requestId !== "string" ||
      !integer(row.revision) ||
      !parsedSnapshot ||
      parsedSnapshot.revision !== row.revision
    ) {
      return null;
    }
    return {
      ok: true,
      requestId: row.requestId,
      revision: row.revision,
      snapshot: parsedSnapshot,
      payload: row.payload,
    };
  }

  if (row.code === "score_conflict") {
    const parsedSnapshot = snapshot(row.snapshot);
    if (
      !integer(row.revision) ||
      !parsedSnapshot ||
      parsedSnapshot.revision !== row.revision
    ) {
      return null;
    }
    return {
      ok: false,
      code: "score_conflict",
      revision: row.revision,
      snapshot: parsedSnapshot,
    };
  }

  if (
    row.code === "not_enabled" ||
    row.code === "not_owner" ||
    row.code === "not_found" ||
    row.code === "invalid_input"
  ) {
    return { ok: false, code: row.code };
  }
  return null;
}

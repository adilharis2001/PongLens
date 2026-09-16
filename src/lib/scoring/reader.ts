import {
  parseCanonicalScoreSummary,
  parseCanonicalScoreSnapshot,
  type CanonicalScoreSummary,
  type CanonicalScoreSnapshot,
} from "./commands.ts";
import {
  projectCanonicalScore,
  type CanonicalFirstServerSource,
  type CanonicalGameEndOverride,
  type CanonicalPlayer,
  type CanonicalProjection,
} from "./canonical.ts";
import { compareCanonicalProjection } from "./client.ts";

type ReaderRpcResponse = { data: unknown; error: unknown };

export type CanonicalScoreReadExecution =
  | { kind: "canonical"; snapshot: CanonicalScoreSnapshot }
  | {
      kind: "legacy";
      reason:
        | "not_enabled"
        | "not_found"
        | "unavailable"
        | "transport_error"
        | "invalid_response"
        | "revision_changed";
    };

export type CanonicalScoreSummariesReadExecution =
  | { kind: "canonical"; summaries: CanonicalScoreSummary[] }
  | {
      kind: "legacy";
      reason:
        | "not_enabled"
        | "invalid_input"
        | "unavailable"
        | "transport_error"
        | "invalid_response"
        | "revision_changed";
    };

export type CanonicalScoreReaderDiagnostic =
  | ({ kind: "parity" } & Omit<
      ReturnType<typeof compareCanonicalProjection>,
      "matchId"
    >)
  | {
      kind: "fallback";
      reason: Exclude<
        Extract<CanonicalScoreReadExecution, { kind: "legacy" }>['reason'],
        "not_enabled"
      >;
    };

export interface LegacyScoreChip {
  you: number;
  them: number;
  complete: boolean;
}

export type CanonicalScoreSummariesDiagnostic =
  | {
      kind: "parity";
      requestedCount: number;
      returnedCount: number;
      missingCount: number;
      comparedCount: number;
      mismatchedCount: number;
    }
  | {
      kind: "fallback";
      reason: Exclude<
        Extract<CanonicalScoreSummariesReadExecution, { kind: "legacy" }>['reason'],
        "not_enabled"
      >;
    };

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export interface LegacyScoreSourceRow {
  id: string;
  idx: number;
  t0: number | null;
  deleted: boolean;
  is_let: boolean;
  confirmed_how: string | null;
  confirmed_winner: CanonicalPlayer | null;
  server_override: CanonicalPlayer | null;
  game_end_override: CanonicalGameEndOverride;
  game_winner_override: CanonicalPlayer | null;
}

/**
 * One adapter from established database row names into the frozen legacy
 * projection oracle. Owner and admin shadows share it so the comparison
 * itself cannot drift between surfaces while readers remain dormant.
 */
export function projectLegacyScoreRows(input: {
  firstServer: CanonicalPlayer | null;
  firstServerSource: CanonicalFirstServerSource;
  points: LegacyScoreSourceRow[];
}): CanonicalProjection {
  return projectCanonicalScore({
    firstServer: input.firstServer,
    firstServerSource: input.firstServerSource,
    points: input.points.map((point) => ({
      id: point.id,
      idx: point.idx,
      t0: point.t0,
      deleted: point.deleted,
      isLet: point.is_let,
      confirmedHow: point.confirmed_how,
      confirmedWinner: point.confirmed_winner,
      serverOverride: point.server_override,
      gameEndOverride: point.game_end_override,
      gameWinnerOverride: point.game_winner_override,
    })),
  });
}

/**
 * Loads one revision-pinned canonical score snapshot. Callers keep their
 * established legacy fold unless this returns `canonical`; errors are reduced
 * to stable rule codes so SQL or transport details never reach telemetry.
 */
export async function loadCanonicalScoreSnapshot(deps: {
  matchId: string;
  expectedRevision?: number;
  rpc: (
    name: "canonical_score_snapshot_v1",
    args: { p_match_id: string },
  ) => PromiseLike<ReaderRpcResponse>;
}): Promise<CanonicalScoreReadExecution> {
  let response: ReaderRpcResponse;
  try {
    response = await deps.rpc("canonical_score_snapshot_v1", {
      p_match_id: deps.matchId,
    });
  } catch {
    return { kind: "legacy", reason: "transport_error" };
  }
  if (response.error) {
    return { kind: "legacy", reason: "transport_error" };
  }

  const row = object(response.data);
  if (!row || typeof row.ok !== "boolean") {
    return { kind: "legacy", reason: "invalid_response" };
  }
  if (!row.ok) {
    if (
      row.code === "not_enabled" ||
      row.code === "not_found" ||
      row.code === "unavailable"
    ) {
      return { kind: "legacy", reason: row.code };
    }
    return { kind: "legacy", reason: "invalid_response" };
  }

  const snapshot = parseCanonicalScoreSnapshot(row.snapshot);
  if (!snapshot || snapshot.matchId !== deps.matchId) {
    return { kind: "legacy", reason: "invalid_response" };
  }
  if (
    deps.expectedRevision !== undefined &&
    snapshot.revision !== deps.expectedRevision
  ) {
    return { kind: "legacy", reason: "revision_changed" };
  }
  return { kind: "canonical", snapshot };
}

/**
 * Loads at most 250 revision-pinned match summaries in one read. The server
 * deliberately omits inaccessible, missing and stale matches; the client
 * rejects duplicates and rows it did not request so a malformed response can
 * never be mistaken for a trustworthy partial batch.
 */
export async function loadCanonicalScoreSummaries(deps: {
  matchIds: string[];
  expectedRevisions?: ReadonlyMap<string, number>;
  rpc: (
    name: "canonical_score_summaries_v1",
    args: { p_match_ids: string[] },
  ) => PromiseLike<ReaderRpcResponse>;
}): Promise<CanonicalScoreSummariesReadExecution> {
  const matchIds = [...new Set(deps.matchIds)];
  if (
    deps.matchIds.length > 250 ||
    matchIds.some((matchId) => matchId.length === 0)
  ) {
    return { kind: "legacy", reason: "invalid_input" };
  }

  let response: ReaderRpcResponse;
  try {
    response = await deps.rpc("canonical_score_summaries_v1", {
      p_match_ids: matchIds,
    });
  } catch {
    return { kind: "legacy", reason: "transport_error" };
  }
  if (response.error) {
    return { kind: "legacy", reason: "transport_error" };
  }

  const row = object(response.data);
  if (!row || typeof row.ok !== "boolean") {
    return { kind: "legacy", reason: "invalid_response" };
  }
  if (!row.ok) {
    if (
      row.code === "not_enabled" ||
      row.code === "invalid_input" ||
      row.code === "unavailable"
    ) {
      return { kind: "legacy", reason: row.code };
    }
    return { kind: "legacy", reason: "invalid_response" };
  }
  if (!Array.isArray(row.summaries)) {
    return { kind: "legacy", reason: "invalid_response" };
  }

  const requested = new Set(matchIds);
  const seen = new Set<string>();
  const summaries: CanonicalScoreSummary[] = [];
  for (const value of row.summaries) {
    const summary = parseCanonicalScoreSummary(value);
    if (
      !summary ||
      !requested.has(summary.matchId) ||
      seen.has(summary.matchId)
    ) {
      return { kind: "legacy", reason: "invalid_response" };
    }
    const expectedRevision = deps.expectedRevisions?.get(summary.matchId);
    if (
      expectedRevision !== undefined &&
      summary.revision !== expectedRevision
    ) {
      return { kind: "legacy", reason: "revision_changed" };
    }
    seen.add(summary.matchId);
    summaries.push(summary);
  }

  return { kind: "canonical", summaries };
}

/**
 * Sanitized shadow evidence only. A disabled reader is expected and silent;
 * every other fallback emits one stable code, and parity contains aggregate
 * counts rather than point ids or snapshot payloads.
 */
export function canonicalScoreReaderDiagnostic(
  execution: CanonicalScoreReadExecution,
  legacy: CanonicalProjection,
): CanonicalScoreReaderDiagnostic | null {
  if (execution.kind === "canonical") {
    const parity = compareCanonicalProjection(execution.snapshot, legacy);
    return {
      kind: "parity",
      revision: parity.revision,
      matches: parity.matches,
      mismatchedMatchFields: parity.mismatchedMatchFields,
      mismatchedPoints: parity.mismatchedPoints,
      canonicalPointCount: parity.canonicalPointCount,
      legacyPointCount: parity.legacyPointCount,
    };
  }
  if (execution.reason === "not_enabled") return null;
  return { kind: "fallback", reason: execution.reason };
}

/** Aggregate-only library shadow evidence. A missing summary is counted but
 * never identified; it may represent stale state and must not trigger repair. */
export function canonicalScoreSummariesDiagnostic(
  execution: CanonicalScoreSummariesReadExecution,
  legacyByMatch: ReadonlyMap<string, LegacyScoreChip>,
  requestedCount: number,
): CanonicalScoreSummariesDiagnostic | null {
  if (execution.kind === "legacy") {
    if (execution.reason === "not_enabled") return null;
    return { kind: "fallback", reason: execution.reason };
  }

  let mismatchedCount = 0;
  for (const summary of execution.summaries) {
    const legacy = legacyByMatch.get(summary.matchId);
    const canonical = summary.match.answeredPointCount > 0
      ? {
          you: summary.match.gamesUser,
          them: summary.match.gamesOpponent,
          complete:
            summary.match.allVisiblePointsAnswered &&
            summary.match.completedGames.length > 0,
        }
      : undefined;
    if (
      canonical?.you !== legacy?.you ||
      canonical?.them !== legacy?.them ||
      canonical?.complete !== legacy?.complete
    ) {
      mismatchedCount += 1;
    }
  }

  return {
    kind: "parity",
    requestedCount,
    returnedCount: execution.summaries.length,
    missingCount: Math.max(0, requestedCount - execution.summaries.length),
    comparedCount: execution.summaries.length,
    mismatchedCount,
  };
}

/** One identifier-free result for libraries of any size. The underlying RPC
 * stays narrowly bounded; callers do not have to reimplement chunk merging. */
export async function loadCanonicalScoreSummaryDiagnostic(deps: {
  matchIds: string[];
  expectedRevisions?: ReadonlyMap<string, number>;
  legacyByMatch: ReadonlyMap<string, LegacyScoreChip>;
  rpc: (
    name: "canonical_score_summaries_v1",
    args: { p_match_ids: string[] },
  ) => PromiseLike<ReaderRpcResponse>;
}): Promise<CanonicalScoreSummariesDiagnostic | null> {
  const matchIds = [...new Set(deps.matchIds)];
  const aggregate: Extract<CanonicalScoreSummariesDiagnostic, { kind: "parity" }> = {
    kind: "parity",
    requestedCount: 0,
    returnedCount: 0,
    missingCount: 0,
    comparedCount: 0,
    mismatchedCount: 0,
  };

  for (let offset = 0; offset < matchIds.length; offset += 250) {
    const chunk = matchIds.slice(offset, offset + 250);
    const execution = await loadCanonicalScoreSummaries({
      matchIds: chunk,
      expectedRevisions: deps.expectedRevisions,
      rpc: deps.rpc,
    });
    const diagnostic = canonicalScoreSummariesDiagnostic(
      execution,
      deps.legacyByMatch,
      chunk.length,
    );
    if (!diagnostic || diagnostic.kind === "fallback") return diagnostic;
    aggregate.requestedCount += diagnostic.requestedCount;
    aggregate.returnedCount += diagnostic.returnedCount;
    aggregate.missingCount += diagnostic.missingCount;
    aggregate.comparedCount += diagnostic.comparedCount;
    aggregate.mismatchedCount += diagnostic.mismatchedCount;
  }

  return aggregate;
}

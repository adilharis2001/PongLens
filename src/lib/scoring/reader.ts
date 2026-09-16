import {
  parseCanonicalScoreSnapshot,
  type CanonicalScoreSnapshot,
} from "./commands.ts";
import type { CanonicalProjection } from "./canonical.ts";
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

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
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
  ) => Promise<ReaderRpcResponse>;
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

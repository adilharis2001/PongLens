import type { CanonicalProjection } from "./canonical.ts";
import {
  canonicalScoreCommandRpcs,
  parseCanonicalCommandResult,
  type CanonicalCommandResult,
  type CanonicalScoreSnapshot,
} from "./commands.ts";

export type CanonicalScoreCommandRpc =
  (typeof canonicalScoreCommandRpcs)[keyof typeof canonicalScoreCommandRpcs];

type RpcResponse = { data: unknown; error: unknown };

export interface CanonicalParityDiagnostic {
  matchId: string;
  revision: number;
  matches: boolean;
  mismatchedMatchFields: number;
  mismatchedPoints: number;
  canonicalPointCount: number;
  legacyPointCount: number;
}

export type CanonicalCommandExecution<T> =
  | { kind: "canonical"; result: Extract<CanonicalCommandResult, { ok: true }> }
  | { kind: "legacy"; value: T }
  | {
      kind: "conflict";
      revision: number;
      snapshot: CanonicalScoreSnapshot;
    }
  | {
      kind: "rejected";
      code: "not_owner" | "not_found" | "invalid_input";
    }
  | { kind: "transport_error"; error: unknown };

export interface CanonicalCommandInvocation<T> {
  rpc: CanonicalScoreCommandRpc;
  /** Supabase RPC arguments other than p_request_id, which this client owns. */
  args: Record<string, unknown>;
  /** The exact pre-rollout write. Used only when rollout is off/not enabled. */
  legacy: () => Promise<T>;
  /** Read after the optimistic local fold; used only for shadow parity. */
  legacyProjection?: () => CanonicalProjection;
  /** Reconcile score state after a stale revision; never mutates structure. */
  onConflict?: (snapshot: CanonicalScoreSnapshot) => void;
}

export class CanonicalScoreCommandClient {
  private readonly enabled: boolean;
  private readonly rpc: (
    name: CanonicalScoreCommandRpc,
    args: Record<string, unknown>,
  ) => Promise<RpcResponse>;
  private readonly requestId: () => string;
  private readonly onParity?: (diagnostic: CanonicalParityDiagnostic) => void;

  constructor(deps: {
    enabled: boolean;
    rpc: (
      name: CanonicalScoreCommandRpc,
      args: Record<string, unknown>,
    ) => Promise<RpcResponse>;
    requestId?: () => string;
    onParity?: (diagnostic: CanonicalParityDiagnostic) => void;
  }) {
    this.enabled = deps.enabled;
    this.rpc = deps.rpc;
    this.requestId = deps.requestId ?? (() => crypto.randomUUID());
    this.onParity = deps.onParity;
  }

  async execute<T>(
    invocation: CanonicalCommandInvocation<T>,
  ): Promise<CanonicalCommandExecution<T>> {
    if (!this.enabled) {
      return { kind: "legacy", value: await invocation.legacy() };
    }

    // Created once, outside the retry loop. If the first response is lost,
    // the server's request ledger makes the second delivery a read, not a
    // second mutation.
    const requestId = this.requestId();
    const args = { ...invocation.args, p_request_id: requestId };
    let response: RpcResponse | null = null;
    let transportError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await this.rpc(invocation.rpc, args);
        if (!response.error) break;
        transportError = response.error;
      } catch (error) {
        response = null;
        transportError = error;
      }
    }

    // Never fall back after an ambiguous transport failure: the canonical
    // transaction may have committed even though its response was lost.
    // A direct legacy write here could apply the user's action twice.
    if (!response || response.error) {
      return { kind: "transport_error", error: transportError };
    }

    const result = parseCanonicalCommandResult(response.data);
    if (!result) {
      return {
        kind: "transport_error",
        error: new Error("Invalid canonical score command response"),
      };
    }

    if (result.ok) {
      if (invocation.legacyProjection && this.onParity) {
        this.onParity(
          compareCanonicalProjection(
            result.snapshot,
            invocation.legacyProjection(),
          ),
        );
      }
      return { kind: "canonical", result };
    }

    if (result.code === "not_enabled") {
      return { kind: "legacy", value: await invocation.legacy() };
    }
    if (result.code === "score_conflict") {
      invocation.onConflict?.(result.snapshot);
      return {
        kind: "conflict",
        revision: result.revision,
        snapshot: result.snapshot,
      };
    }
    return { kind: "rejected", code: result.code };
  }
}

export function compareCanonicalProjection(
  canonical: CanonicalScoreSnapshot,
  legacy: CanonicalProjection,
): CanonicalParityDiagnostic {
  const matchKeys = Object.keys(canonical.match) as Array<
    keyof typeof canonical.match
  >;
  const mismatchedMatchFields = matchKeys.filter(
    (key) => !sameJson(canonical.match[key], legacy.match[key]),
  ).length;

  const canonicalById = new Map(
    canonical.points.map((point) => [
      point.pointId,
      Object.fromEntries(
        Object.entries(point).filter(([key]) => key !== "revision"),
      ),
    ]),
  );
  const legacyById = new Map(
    legacy.points.map((point) => [point.pointId, point]),
  );
  const pointIds = new Set([...canonicalById.keys(), ...legacyById.keys()]);
  let mismatchedPoints = 0;
  for (const pointId of pointIds) {
    if (!sameJson(canonicalById.get(pointId), legacyById.get(pointId))) {
      mismatchedPoints += 1;
    }
  }

  return {
    matchId: canonical.matchId,
    revision: canonical.revision,
    matches: mismatchedMatchFields === 0 && mismatchedPoints === 0,
    mismatchedMatchFields,
    mismatchedPoints,
    canonicalPointCount: canonical.points.length,
    legacyPointCount: legacy.points.length,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

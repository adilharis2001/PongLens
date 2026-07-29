import type { MatchPlacementStatus } from "../types.ts";

export type PlacementRetryAction =
  | "enqueue"
  | "expired"
  | "used"
  | "already_retrying"
  | "unavailable";

export function placementRetryAction(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementRetryAction {
  if (status === "retrying") return "already_retrying";
  if (status !== "retry_available") return "unavailable";
  if (retryCount !== 0) return "used";
  if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return "enqueue";
}

export function placementRetryError(error: {
  code?: string;
  message?: string;
}): { status: number; code: string } {
  if (error.code === "P0002") {
    return { status: 404, code: "match_not_found" };
  }
  if (error.code === "23514") {
    return { status: 409, code: "retry_already_used" };
  }
  if (error.code === "P0001") {
    if ((error.message ?? "").includes("already queued")) {
      return { status: 409, code: "already_retrying" };
    }
    return { status: 409, code: "retry_unavailable" };
  }
  if (error.code === "42501") {
    return { status: 403, code: "not_owner" };
  }
  return { status: 500, code: "queue_failed" };
}

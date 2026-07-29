import type { MatchPlacementStatus } from "../types.ts";

export type PlacementRetryAction =
  | "enqueue"
  | "expired"
  | "used"
  | "already_retrying"
  | "unavailable";

export interface PlacementRetryView {
  tone: "warning" | "progress" | "muted";
  title: string;
  body: string;
  action: string | null;
  poll: boolean;
}

export function placementRetryView(
  status: MatchPlacementStatus,
  retryCount: number,
  expiresAt: string | null,
  now = new Date(),
): PlacementRetryView | null {
  if (
    status === "ready"
    || status === "not_requested"
    || status === "processing"
  ) {
    return null;
  }

  const expired =
    status === "retry_available"
    && (!expiresAt || new Date(expiresAt).getTime() <= now.getTime());
  if (expired) {
    return {
      tone: "muted",
      title: "Placement retry is no longer available",
      body:
        "The original recording has passed its processing-retention window. "
        + "Your points, score, clips, and notes are still available.",
      action: null,
      poll: false,
    };
  }

  if (status === "retry_available" && retryCount === 0) {
    return {
      tone: "warning",
      title: "Placement maps need another try",
      body:
        "Your match is ready, but we couldn't map the table reliably enough "
        + "to generate placement maps. The stronger retry is available once.",
      action: "Try placement again",
      poll: false,
    };
  }

  if (status === "retrying") {
    return {
      tone: "progress",
      title: "Generating placement maps…",
      body:
        "We're trying a stronger table-calibration method. You can leave "
        + "this page; we'll email you when it finishes.",
      action: null,
      poll: true,
    };
  }

  if (status === "final_failed" || retryCount > 0) {
    return {
      tone: "muted",
      title: "Placement maps couldn't be generated",
      body:
        "We tried again, but couldn't generate reliable placement maps from "
        + "this recording. Your points, score, clips, and notes are still "
        + "available.",
      action: null,
      poll: false,
    };
  }

  return null;
}

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
